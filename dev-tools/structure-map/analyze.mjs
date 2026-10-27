import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { describeFile } from './labels.mjs'

const slash = value => value.replaceAll('\\', '/')
const codePattern = /\.(?:[cm]?[jt]sx?)$/
const ignoredPattern = /(?:\.verify|\.test|\.spec|\.d)\.[cm]?[jt]sx?$/
export function sourceFiles(root) {
  const result = []
  function walk(relative) {
    const absolute = path.join(root, relative)
    if (!fs.existsSync(absolute)) return
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = slash(path.join(relative, entry.name))
      if (entry.isDirectory() && !['node_modules', 'generated', '.git'].includes(entry.name)) walk(child)
      else if (entry.isFile() && codePattern.test(child) && !ignoredPattern.test(child)) result.push(child)
    }
  }
  walk('src')
  walk('supabase/functions')
  return result.sort()
}

const visit = (node, fn) => { fn(node); ts.forEachChild(node, child => visit(child, fn)) }
const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
const property = (node, key) => node?.properties?.find(p => p.name?.getText().replace(/^['"]|['"]$/g, '') === key)
const exported = node => node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)

function assignDomain(file, domains) {
  const parts = file.split('/')
  if (file.startsWith('src/features/')) return domains.find(d => d.features.includes(parts[2]))?.id ?? 'other'
  if (file.startsWith('src/lib/supabase/')) {
    const base = path.basename(file).replace(/\.[^.]+$/, '')
    return domains.find(d => d.stores.some(prefix => base === prefix || base.startsWith(prefix)))?.id ?? 'other'
  }
  if (file.startsWith('src/lib/')) return domains.find(d => d.libs.includes(parts[2]))?.id ?? 'shell'
  if (file.startsWith('supabase/functions/_shared/')) return domains.find(d => d.shared?.some(prefix => parts[3].startsWith(prefix)))?.id ?? 'other'
  if (file.startsWith('supabase/functions/')) return domains.find(d => d.functions?.includes(parts[2]))?.id ?? 'other'
  return 'shell'
}

export function analyze(root, config) {
  const started = performance.now()
  const paths = sourceFiles(root)
  const pathSet = new Set(paths)
  const hash = crypto.createHash('sha256').update(JSON.stringify(config))
  const modules = new Map()
  const nodes = []
  const edges = []
  const edgeIndex = new Map()
  const unresolved = []
  const resources = new Map()
  const routes = []
  const nav = []
  const lineAt = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  function edge(from, to, kind, evidence) {
    const key = `${from}|${to}|${kind}`
    let record = edgeIndex.get(key)
    if (!record) {
      record = { from, to, kind, evidence: [] }
      edgeIndex.set(key, record)
      edges.push(record)
    }
    if (!record.evidence.some(e => JSON.stringify(e) === JSON.stringify(evidence))) record.evidence.push(evidence)
  }
  function resolve(from, specifier) {
    let base
    if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`
    else if (specifier.startsWith('.')) base = slash(path.join(path.dirname(from), specifier))
    else return null
    const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map(ext => base + ext)]
    const codeTarget = candidates.find(candidate => pathSet.has(candidate))
    if (codeTarget) return codeTarget
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile()) return candidate
    }
    unresolved.push({ file: from, specifier, kind: 'import' })
    return null
  }
  for (const file of paths) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    hash.update(file).update(source)
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    if (sf.parseDiagnostics.length) {
      const problem = sf.parseDiagnostics[0]
      const line = sf.getLineAndCharacterOfPosition(problem.start ?? 0).line + 1
      throw new Error(`${file}:${line} — ${ts.flattenDiagnosticMessageText(problem.messageText, ' ')}`)
    }
    const module = { sf, bindings: new Map(), constants: new Map(), declarations: new Map(), delegates: new Map() }
    modules.set(file, module)
    const layer = file.startsWith('supabase/functions/') ? 'server' : file.startsWith('src/lib/supabase/') ? 'store' : file.startsWith('src/features/') ? 'screen' : 'shared'
    nodes.push({ id: file, path: file, label: path.basename(file), kind: 'file', layer, domain: assignDomain(file, config.domains), lines: source.split('\n').length, exports: [], packages: [] })
    const record = nodes.at(-1)
    visit(sf, node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) module.constants.set(node.name.text, node.initializer)
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
        module.declarations.set(node.name.text, node)
        if (exported(node)) record.exports.push({ name: node.name.text, line: lineAt(sf, node) })
      }
      if (ts.isVariableStatement(node) && exported(node)) {
        for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) {
          module.declarations.set(d.name.text, d.initializer ?? d)
          record.exports.push({ name: d.name.text, line: lineAt(sf, d) })
        }
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = literal(node.moduleSpecifier)
        if (!specifier) return
        const target = resolve(file, specifier)
        const bindings = []
        let typeOnly = !!node.isTypeOnly
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause
          typeOnly = !!clause?.isTypeOnly
          if (clause?.name) bindings.push({ local: clause.name.text, name: 'default', type: typeOnly })
          const named = clause?.namedBindings
          if (named && ts.isNamespaceImport(named)) bindings.push({ local: named.name.text, name: '*', type: typeOnly })
          if (named && ts.isNamedImports(named)) for (const el of named.elements) bindings.push({ local: el.name.text, name: el.propertyName?.text ?? el.name.text, type: typeOnly || el.isTypeOnly })
          if (bindings.length) typeOnly = bindings.every(b => b.type)
          for (const b of bindings) module.bindings.set(b.local, { ...b, target, line: lineAt(sf, node) })
        } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            if (!typeOnly && !el.isTypeOnly && target) module.delegates.set(el.name.text, [{ target, symbol: el.propertyName?.text ?? el.name.text, line: lineAt(sf, el) }])
          }
          typeOnly ||= node.exportClause.elements.every(el => el.isTypeOnly)
        }
        if (target && pathSet.has(target)) edge(file, target, typeOnly ? 'type' : 'import', { file, line: lineAt(sf, node), symbols: bindings.map(b => b.name).join(', '), specifier })
        else if (!target && !specifier.startsWith('.') && !specifier.startsWith('@/')) record.packages.push(specifier)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = literal(node.arguments[0])
        if (specifier) {
          const target = resolve(file, specifier)
          if (target && pathSet.has(target)) edge(file, target, 'dynamic', { file, line: lineAt(sf, node), specifier })
        } else unresolved.push({ file, line: lineAt(sf, node), kind: 'dynamic-import' })
      }
      if (ts.isNewExpression(node) && node.expression.getText(sf) === 'Worker') {
        const url = node.arguments?.[0]
        if (url && ts.isNewExpression(url) && url.expression.getText(sf) === 'URL') {
          const specifier = literal(url.arguments?.[0])
          if (specifier) {
            const target = resolve(file, specifier)
            if (target && pathSet.has(target)) edge(file, target, 'worker', { file, line: lineAt(sf, node), specifier })
          } else unresolved.push({ file, line: lineAt(sf, node), kind: 'worker' })
        }
      }
    })
    record.packages = [...new Set(record.packages)].sort()
  }
  // Only project paths are exported. Source text, environment files and credentials are never embedded.
  for (const [file, module] of modules) {
    const { sf } = module
    function stringValue(node, seen = new Set()) {
      const direct = literal(node)
      if (direct !== null) return direct
      if (node && ts.isIdentifier(node) && !seen.has(node.text)) {
        seen.add(node.text)
        return stringValue(module.constants.get(node.text), seen)
      }
      return null
    }
    for (const item of nodes.find(n => n.id === file).exports) {
      const declaration = module.declarations.get(item.name)
      if (!declaration) continue
      const delegated = []
      visit(declaration.body ?? declaration, node => {
        // Namespace calls in the public API are a narrower link than all imports of the barrel.
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
          const binding = module.bindings.get(node.expression.expression.text)
          if (binding?.target && !binding.type) delegated.push({ target: binding.target, symbol: node.expression.name.text, line: lineAt(sf, node) })
        }
      })
      if (delegated.length) module.delegates.set(item.name, delegated)
    }
    visit(sf, node => {
      if (ts.isObjectLiteralExpression(node) && file.endsWith('company-workspace-nav.ts')) {
        const to = literal(property(node, 'to')?.initializer)
        const label = literal(property(node, 'label')?.initializer)
        if (to && label) {
          let parent = node.parent
          let group = '상단 · 기타'
          while (parent) {
            if (ts.isObjectLiteralExpression(parent)) group = literal(property(parent, 'title')?.initializer) ?? group
            parent = parent.parent
          }
          nav.push({ to, label, group, file, line: lineAt(sf, node) })
        }
      }
      if (!ts.isCallExpression(node)) return
      const directRpc = ts.isIdentifier(node.expression) && node.expression.text === 'rpc'
      if (!directRpc && !ts.isPropertyAccessExpression(node.expression)) return
      const method = directRpc ? 'rpc' : node.expression.name.text
      const receiver = directRpc ? '' : node.expression.expression.getText(sf)
      let kind
      if (method === 'rpc') kind = 'rpc'
      if (method === 'invoke' && /functions/.test(receiver)) kind = 'function'
      if (method === 'from' && /(?:supabase|Supabase|\bsb\b|\bclient\b|\badmin\b|storage)/.test(receiver)) kind = /storage/.test(receiver) ? 'storage' : 'table'
      if (!kind) return
      const name = stringValue(node.arguments[0])
      if (!name) { unresolved.push({ file, line: lineAt(sf, node), kind }); return }
      const id = `${kind}:${name}`
      if (!resources.has(id)) resources.set(id, { id, label: name, kind, domain: null, layer: 'resource' })
      edge(file, id, kind, { file, line: lineAt(sf, node), method })
      if (kind === 'function') {
        const target = `supabase/functions/${name}/index.ts`
        if (modules.has(target)) edge(id, target, 'implementation', { file: target, line: 1 })
      }
    })
  }
  // Trace named calls through the existing API facade without implying use of its other stores.
  for (const [file, module] of modules) for (const binding of module.bindings.values()) {
    if (binding.target !== 'src/lib/api/index.ts' || binding.type) continue
    for (const delegated of modules.get(binding.target)?.delegates.get(binding.name) ?? []) {
      edge(file, delegated.target, 'api', { file, line: binding.line, symbol: binding.name, via: binding.target, viaLine: delegated.line, targetSymbol: delegated.symbol })
    }
  }
  // Resolve local JSX wrappers and lazy components to source modules.
  function componentFiles(file, name, seen = new Set()) {
    const key = `${file}:${name}`
    if (seen.has(key)) return []
    seen.add(key)
    const module = modules.get(file)
    const imported = module.bindings.get(name)
    if (imported?.target) return [imported.target]
    const local = module.declarations.get(name) ?? module.constants.get(name)
    const found = []
    if (local) visit(local, node => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && literal(node.arguments[0])) {
        const target = resolve(file, literal(node.arguments[0]))
        if (target) found.push(target)
      }
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() !== name) found.push(...componentFiles(file, node.tagName.getText(), seen))
    })
    return [...new Set(found)]
  }
  for (const file of ['src/components/layout/company-routes.tsx', 'src/App.tsx']) {
    const module = modules.get(file)
    if (!module) continue
    visit(module.sf, node => {
      if (!(ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) || node.tagName.getText() !== 'Route') return
      const attr = name => node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText() === name)
      const rawPath = literal(attr('path')?.initializer)
      if (rawPath === null && !attr('index')) return
      let prefix = ''
      let parent = node.parent
      while (parent) {
        if (ts.isJsxElement(parent) && parent.openingElement !== node && parent.openingElement.tagName.getText() === 'Route') {
          const p = parent.openingElement.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText() === 'path')
          const text = literal(p?.initializer)
          if (text && !text.includes('*')) prefix = `${text}/${prefix}`
        }
        parent = parent.parent
      }
      const routePath = `/${prefix}${rawPath ?? ''}`.replaceAll(/\/{2,}/g, '/')
      const element = attr('element')?.initializer
      let redirect = null
      const components = []
      if (element) visit(element, child => {
        if (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) {
          const name = child.tagName.getText()
          if (['Navigate', 'RedirectTo'].includes(name)) {
            const to = child.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText() === 'to')
            redirect = literal(to?.initializer) ?? '(동적 리다이렉트)'
          } else components.push(name)
        }
      })
      const targets = [...new Set(components.flatMap(c => componentFiles(file, c)))].filter(f => f.startsWith('src/features/'))
      const labels = nav.filter(n => {
        const pattern = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, '[^/]+')
        return new RegExp(`^${pattern}$`).test(n.to)
      })
      routes.push({ path: routePath, components, targets, redirect, labels: labels.map(n => `${n.group} · ${n.label}`), file, line: lineAt(module.sf, node) })
    })
  }
  for (const node of resources.values()) {
    const counts = new Map()
    for (const e of edges.filter(e => e.to === node.id)) {
      const domain = nodes.find(n => n.id === e.from)?.domain ?? 'other'
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
    node.domain = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
  }
  for (const node of nodes) Object.assign(node, describeFile(node, modules.get(node.id).sf, {
    routes, nav, domain: config.domains.find(d => d.id === node.domain),
  }))
  const allNodes = [...nodes, ...resources.values()]
  const nodeById = new Map(allNodes.map(n => [n.id, n]))
  const groupEdges = new Map()
  for (const e of edges) {
    const from = nodeById.get(e.from)?.domain
    const to = nodeById.get(e.to)?.domain
    if (!from || !to || from === to || e.kind === 'type') continue
    const key = `${from}|${to}`
    if (!groupEdges.has(key)) groupEdges.set(key, { from, to, edgeCount: 0, kinds: new Set() })
    const g = groupEdges.get(key)
    g.edgeCount++
    g.kinds.add(e.kind)
  }
  return {
    version: 1, generatedAt: new Date().toISOString(), root: slash(root), fingerprint: hash.digest('hex'),
    domains: config.domains, nodes: allNodes, edges, routes, nav, unresolved,
    domainEdges: [...groupEdges.values()].map(e => ({ ...e, kinds: [...e.kinds] })),
    stats: { files: nodes.length, resources: resources.size, edges: edges.length, routes: routes.length, analysisMs: Math.round(performance.now() - started) },
  }
}
