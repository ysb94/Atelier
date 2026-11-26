import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const contractsPath = 'docs/architecture/data-flows.json'
const dataDirectories = ['supabase/migrations', 'scripts/google-apps-script']
const codeFile = /\.(?:[cm]?[jt]sx?|gs)$/
const testFile = /\.(?:verify|test|spec|d)\.[cm]?[jt]sx?$/
const sort = (a, b) => a.localeCompare(b, 'en')

export function dataFiles(root) {
  return dataDirectories.flatMap(directory => {
    const absolute = path.join(root, directory)
    if (!fs.existsSync(absolute)) return []
    return fs.readdirSync(absolute, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(sql|gs)$/.test(entry.name))
      .map(entry => directory + '/' + entry.name)
  }).sort(sort)
}

export function parseContracts(text) {
  const records = JSON.parse(text)
  if (!Array.isArray(records)) throw new Error(contractsPath + ' 배열이 필요합니다.')
  const ids = new Set()
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(record.id) || ids.has(record.id)) {
      throw new Error('데이터 연결 기록 ID가 비어 있거나 중복됐습니다.')
    }
    ids.add(record.id)
    for (const key of ['label', 'origin', 'write', 'propagation', 'copies', 'reason']) {
      if (typeof record[key] !== 'string' || !record[key].trim()) throw new Error(record.id + ': ' + key + ' 필드가 필요합니다.')
    }
    for (const key of ['resources', 'evidence']) {
      if (!Array.isArray(record[key]) || !record[key].length || record[key].some(value => typeof value !== 'string' || !value.trim())) {
        throw new Error(record.id + ': ' + key + ' 근거가 필요합니다.')
      }
    }
  }
  return records
}

export function readContracts(root) {
  const records = parseContracts(fs.readFileSync(path.join(root, contractsPath), 'utf8'))
  for (const record of records) for (const file of record.evidence) {
    const relative = file.split('/')
    if (path.isAbsolute(file) || file.includes('\\') || relative.some(part => !part || part.startsWith('.')) ||
        file.startsWith('docs/backups/') || !fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(record.id + ': 근거 파일 경로를 확인하세요. ' + file)
    }
  }
  return records
}

const ignoredSql = /--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'/g
const maskSql = source => source.replace(ignoredSql, part => part.replace(/[^\r\n]/g, ' '))
const identifier = '(?:"[a-z_][\\w$]*"|[a-z_][\\w$]*)'
const qualified = '(' + identifier + '(?:\\s*\\.\\s*' + identifier + ')?)'
const normalizeName = raw => raw.replace(/[\s"]/g, '').toLowerCase()
const qualifiedName = raw => {
  const name = normalizeName(raw)
  return name.includes('.') ? name : 'public.' + name
}
const columnName = new RegExp('^' + identifier + '\\s+', 'i')

function columnsInDefinition(sql, start) {
  const columns = []
  let depth = 0
  let fieldStart = start
  for (let i = start; i < sql.length; i++) {
    const char = sql[i]
    if (depth === 0 && (char === ',' || char === ')')) {
      const field = sql.slice(fieldStart, i).trimStart()
      const name = field.match(columnName)?.[0].trim()
      if (name && !/^(constraint|primary|foreign|unique|check|exclude|like)$/i.test(name)) columns.push(normalizeName(name))
      fieldStart = i + 1
      if (char === ')') break
    }
    if (char === '(') depth++
    if (char === ')') depth--
  }
  return columns
}

// These are lexical migration references, including historical definitions and
// static function bodies. Dynamic SQL and the deployed schema need source review.
export function sqlConnections(source) {
  const sql = maskSql(source)
  const findings = []
  const functionBodies = []
  const add = (kind, raw, operation, index, columns = [], owner = undefined) => {
    findings.push({ resource: kind + ':' + qualifiedName(raw), operation, index, columns, owner })
  }
  const create = new RegExp('\\bcreate\\s+(?:or\\s+replace\\s+)?(?:unlogged\\s+|temporary\\s+|temp\\s+)?(table|(?:materialized\\s+)?view|function)\\s+(?:if\\s+not\\s+exists\\s+)?' + qualified, 'gi')
  for (const match of sql.matchAll(create)) {
    const type = match[1].toLowerCase()
    const start = match.index + match[0].length
    const paren = sql.slice(start).match(/^\s*\(/)
    const columns = type === 'table' && paren ? columnsInDefinition(sql, start + paren[0].length) : []
    add(type === 'function' ? 'rpc' : 'table', match[2], '정의', match.index, columns)
    if (type !== 'function') continue
    const open = sql.slice(start).match(/^[^;]*?\bas\s+(\$(?:[a-z_][\w]*)?\$)/i)
    if (!open) continue
    const bodyStart = start + open[0].length
    const bodyEnd = sql.indexOf(open[1], bodyStart)
    if (bodyEnd >= 0) functionBodies.push({ start: bodyStart, end: bodyEnd, resource: 'rpc:' + qualifiedName(match[2]) })
  }
  const alter = new RegExp('\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?' + qualified + '([^;]*)', 'gi')
  const added = new RegExp('\\badd\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?(' + identifier + ')', 'gi')
  const renamed = new RegExp('\\brename\\s+column\\s+' + identifier + '\\s+to\\s+(' + identifier + ')', 'gi')
  for (const match of sql.matchAll(alter)) {
    const columns = [...match[2].matchAll(added), ...match[2].matchAll(renamed)].map(part => normalizeName(part[1]))
    add('table', match[1], '구조 변경', match.index, columns)
  }
  const relation = new RegExp('\\b(insert\\s+into|delete\\s+from|update|from|join|references|truncate(?:\\s+table)?)\\s+(?:only\\s+)?' + qualified + '(?![\\w$])', 'gi')
  for (const match of sql.matchAll(relation)) {
    const verb = match[1].toLowerCase()
    const name = normalizeName(match[2])
    const following = sql.slice(match.index + match[0].length).trimStart()
    if (/^(select|values|lateral|set|on|of|xmltable|unnest|jsonb_array_elements)$/.test(name) ||
        (/^(join|from)$/.test(verb) && following.startsWith('('))) continue
    const operation = /^(from|join)$/.test(verb) ? '조회' : verb === 'references' ? '참조' : '쓰기'
    const owner = functionBodies.findLast(body => body.start <= match.index && match.index < body.end)?.resource
    add('table', match[2], operation, match.index, [], owner)
  }
  return findings
}

const argumentText = node => node && ts.isStringLiteralLike(node) ? node.text : ''
const urlPrefix = node => node && ts.isTemplateExpression(node) ? node.head.text : argumentText(node)
const apiImport = (file, specifier) => {
  if (specifier.startsWith('@/')) return /^@\/lib\/(?:api(?:\/|$)|supabase\/)/.test(specifier)
  if (!specifier.startsWith('.')) return false
  const target = path.posix.join(path.posix.dirname(file), specifier)
  return /^src\/lib\/(?:api(?:\/|$)|supabase\/)/.test(target)
}

// Only locators go into the index. Argument values are compared in memory.
export function codeConnections(file, source, signatures = false) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.gs') ? ts.ScriptKind.JS : undefined)
  const printer = signatures ? ts.createPrinter({ removeComments: true }) : null
  const imports = new Map()
  const urls = new Map()
  const calls = []
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const variable of statement.declarationList.declarations) {
        const prefix = urlPrefix(variable.initializer)
        if (ts.isIdentifier(variable.name) && /^https?:\/\//i.test(prefix)) urls.set(variable.name.text, prefix)
      }
    }
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue
    const from = argumentText(statement.moduleSpecifier)
    if (!apiImport(file, from)) continue
    const clause = statement.importClause
    if (clause?.name) imports.set(clause.name.text, from)
    const bindings = clause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, from)
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if (!binding.isTypeOnly) imports.set(binding.name.text, from + '#' + (binding.propertyName ?? binding.name).text)
      }
    }
  }
  const add = (node, resource, operation) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    let expression = node
    while (expression.parent && ts.isPropertyAccessExpression(expression.parent) &&
           expression.parent.expression === expression && ts.isCallExpression(expression.parent.parent) &&
           expression.parent.parent.expression === expression.parent) expression = expression.parent.parent
    calls.push({ resource, operation, line, signature: printer?.printNode(ts.EmitHint.Expression, expression, sf) })
  }
  const walk = node => {
    if (ts.isCallExpression(node)) {
      const call = node.expression
      const method = ts.isPropertyAccessExpression(call) ? call.name.text : call.getText(sf)
      const receiver = ts.isPropertyAccessExpression(call) ? call.expression.getText(sf) : ''
      const key = argumentText(node.arguments[0])
      if ((method === 'fetch' && (!receiver || /^(?:globalThis|window|UrlFetchApp)$/.test(receiver))) ||
          (method === 'fetchAll' && receiver === 'UrlFetchApp')) {
        const url = node.arguments[0]
        const prefix = url && ts.isIdentifier(url) ? urls.get(url.text) : urlPrefix(url)
        const host = prefix?.match(/^https?:\/\/([a-z\d.-]+)(?:[:/?#]|$)/i)?.[1]
        add(node, 'external:' + (host?.toLowerCase() ?? (receiver === 'UrlFetchApp' ? 'apps-script-fetch' : 'dynamic')), 'HTTP')
      } else if (/\b(?:localStorage|sessionStorage|indexedDB|caches)$/.test(receiver) &&
                 /^(?:getItem|setItem|removeItem|clear|open|deleteDatabase|match|delete)$/.test(method)) {
        add(node, 'browser:' + receiver.split('.').at(-1), method)
      } else if (/^(?:SpreadsheetApp|DriveApp|ScriptApp|PropertiesService)$/.test(receiver)) {
        add(node, 'external:' + receiver, method)
      } else if (method === 'rpc' || method === 'invoke' && /functions/.test(receiver)) {
        if (key && /^[a-z_][\w-]*$/i.test(key)) add(node, (method === 'rpc' ? 'rpc:' : 'function:') + key, '호출')
        else add(node, 'connection:' + method, '동적 호출')
      } else if (method === 'from' && /(?:supabase|Supabase|\bsb\b|\bclient\b|\badmin\b|storage)/.test(receiver)) {
        if (key && /^[a-z_][\w-]*$/i.test(key)) add(node, (/storage/.test(receiver) ? 'storage:' : 'table:') + key, '접근')
        else add(node, 'connection:from', '동적 호출')
      } else if (imports.has(receiver || method)) {
        add(node, 'connection:' + imports.get(receiver || method), 'API 호출')
      } else if (/^(?:useQuery|useInfiniteQuery|useMutation|invalidateQueries|setQueryData)$/.test(method)) {
        add(node, 'connection:query-cache', '조회 또는 갱신')
      } else if (/^(?:supabase|getSupabase\(\)|client|admin)\.auth$/.test(receiver)) {
        add(node, 'service:supabase-auth', method)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return calls
}

function persistentFile(file) {
  return !testFile.test(file) && (file.endsWith('.sql') && file.startsWith('supabase/migrations/') ||
    codeFile.test(file) && /^(?:src\/lib\/(?:supabase|api)|supabase\/functions|scripts\/google-apps-script)\//.test(file))
}

export function changedConnections(file, previous, current) {
  if (previous === current || testFile.test(file)) return null
  if (file.endsWith('.sql')) {
    if (!persistentFile(file)) return null
    return new Set([...sqlConnections(previous), ...sqlConnections(current)].map(entry => entry.resource))
  }
  if (!codeFile.test(file)) return null
  if (previous.replace(/\r\n/g, '\n') === current.replace(/\r\n/g, '\n')) return null
  const before = codeConnections(file, previous, true)
  const after = codeConnections(file, current, true)
  const tokens = calls => calls.map(call => [call.resource, call.signature].join('|')).sort(sort)
  const beforeTokens = tokens(before)
  const afterTokens = tokens(after)
  const persistent = persistentFile(file)
  if (JSON.stringify(beforeTokens) === JSON.stringify(afterTokens)) {
    if (!persistent) return null
    const printer = ts.createPrinter({ removeComments: true })
    const normalize = source => printer.printFile(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false,
      file.endsWith('.gs') ? ts.ScriptKind.JS : undefined))
    if (normalize(previous) === normalize(current)) return null
    return new Set([...before, ...after].map(call => call.resource))
  }
  const beforeSet = new Set(beforeTokens)
  const afterSet = new Set(afterTokens)
  const changed = [...before.filter(call => !afterSet.has([call.resource, call.signature].join('|'))),
    ...after.filter(call => !beforeSet.has([call.resource, call.signature].join('|')))]
  return new Set(changed.map(call => call.resource))
}

function equivalentResource(left, right) {
  if (left === right) return true
  const defaultSchema = /^(table|rpc):public\./
  return left.replace(defaultSchema, '$1:') === right.replace(defaultSchema, '$1:')
}

export function uncoveredChanges(changes, previous, current) {
  const before = new Map(previous.map(record => [record.id, record]))
  const after = new Map(current.map(record => [record.id, record]))
  const updated = [...after.values()].filter(record => JSON.stringify(record) !== JSON.stringify(before.get(record.id)))
  const deleted = previous.filter(record => !after.has(record.id))
  return changes.filter(({ file, resources, removed }) => {
    const candidates = removed ? [...updated, ...deleted] : updated
    return !candidates.some(record => record.evidence.includes(file) ||
      record.resources.some(key => [...resources].some(resource => equivalentResource(resource, key))))
  })
}

export function makeDataIndex(root, structure, contracts, inputPaths = dataFiles(root)) {
  const inventory = new Map()
  const ensure = key => {
    if (!inventory.has(key)) inventory.set(key, { columns: new Set(), evidence: new Set(), notes: new Set() })
    return inventory.get(key)
  }
  const add = (key, locator) => ensure(key).evidence.add(locator)
  const sql = []
  for (const file of inputPaths.filter(file => file.endsWith('.sql'))) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    let newline = source.indexOf('\n')
    let line = 1
    for (const finding of sqlConnections(source).sort((a, b) => a.index - b.index)) {
      while (newline >= 0 && newline < finding.index) {
        line++
        newline = source.indexOf('\n', newline + 1)
      }
      sql.push({ ...finding, file, line })
    }
  }
  const declared = new Set(sql.filter(finding => finding.operation === '정의' || finding.operation === '구조 변경').map(finding => finding.resource))
  for (const { resource, operation, columns, file, line, owner } of sql) {
    if (!declared.has(resource) && !/^table:(?:auth|storage)\./.test(resource)) continue
    for (const column of columns) ensure(resource).columns.add(column)
    add(resource, operation + (owner ? ' [' + owner + ']' : '') + ' ' + file + ':' + line)
    if (owner) add(owner, operation + ' [' + resource + '] ' + file + ':' + line)
  }
  const canonical = key => {
    const [kind, name] = key.split(':')
    return ['table', 'rpc'].includes(kind) && declared.has(kind + ':public.' + name) ? kind + ':public.' + name : key
  }
  const domains = new Map(structure.nodes.filter(node => node.path).map(node => [node.path, node.domain]))
  for (const edge of structure.edges) {
    if (!['table', 'rpc', 'storage', 'function'].includes(edge.kind)) continue
    for (const place of edge.evidence) add(canonical(edge.to), '앱 호출 [' + (domains.get(edge.from) ?? 'other') + '] ' + edge.from + ':' + place.line)
  }
  for (const item of structure.unresolved.filter(item => ['table', 'rpc', 'storage', 'function'].includes(item.kind))) {
    add('connection:' + item.kind, '동적 이름 ' + item.file + ':' + item.line)
  }
  const integrations = [...domains.keys(), ...inputPaths.filter(file => file.endsWith('.gs'))]
  for (const file of integrations) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    if (!/\b(?:fetch|fetchAll|localStorage|sessionStorage|indexedDB|caches|SpreadsheetApp|DriveApp|ScriptApp|PropertiesService|auth)\b/.test(source)) continue
    for (const call of codeConnections(file, source)) {
      if (/^(external|browser|service):/.test(call.resource)) add(call.resource, call.operation + ' ' + file + ':' + call.line)
    }
  }
  for (const record of contracts) for (const key of record.resources) ensure(canonical(key)).notes.add(record.id)

  const lines = [
    '# Atelier 데이터 연결 목록', '',
    '업무 용어, 테이블·필드, RPC, 파일 경로로 검색한다. 기준과 별도 저장 이유는 업무 기록에서 확인한다.',
    '자동 목록은 저장소의 정적 근거다. 마이그레이션의 과거 열과 정의도 포함한다. 동적 경로와 운영 설정은 해당 코드 및 적용 상태와 대조한다.',
    '열이 검색에 잡히지 않으면 관련 테이블과 코드도 확인한다.',
    '', '## 확인한 업무 데이터 연결', '',
  ]
  for (const record of contracts) {
    lines.push('### ' + record.label + ' (' + record.id + ')', '', '- 기준 · ' + record.origin,
      '- 수정 · ' + record.write, '- 반영 · ' + record.propagation, '- 별도 저장 · ' + record.copies,
      '- 이유 · ' + record.reason, '- 검색 키 · ' + record.resources.join(', '),
      '- 근거 · ' + record.evidence.map(name => '[' + name + '](../../../' + name + ')').join(', '), '')
  }
  lines.push('## 자동 확인한 데이터 자원', '')
  for (const [name, item] of [...inventory].sort(([a], [b]) => sort(a, b))) {
    lines.push('### ' + name, '',
      item.notes.size ? '- 업무 기록 · ' + [...item.notes].join(', ') : '- 업무 기준 · 관련 소스 확인 필요')
    if (item.columns.size) lines.push('- 마이그레이션에서 발견한 열 · ' + [...item.columns].sort(sort).join(', '))
    for (const locator of [...item.evidence].sort(sort)) lines.push('- ' + locator)
    lines.push('')
  }
  return {
    markdown: lines.join('\n'),
    resources: inventory.size,
    contracts: contracts.length,
    migrations: inputPaths.filter(file => file.endsWith('.sql')).length,
  }
}
