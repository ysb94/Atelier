import ts from 'typescript'
import { digest } from './workspace.mjs'
import { EnvironmentError } from './errors.mjs'

export const SOURCE_LIMITS = Object.freeze({ totalChars: 60000, fileChars: 12000, maxFiles: 20, maxRequests: 12 })

export function sourceRequest(raw) {
  const value = String(raw ?? '').trim().replaceAll('\\', '/')
  const match = value.match(/^(.*?)#L(\d+)(?:-L?(\d+))?$/)
  if (!match) return { path: value, range: null }
  const range = [Number(match[2]), Number(match[3] ?? match[2])]
  if (range[0] < 1 || range[1] < range[0]) throw new EnvironmentError(`소스 줄 범위가 올바르지 않습니다: ${value}`, { retry: false, code: 'source_range' })
  return { path: match[1], range }
}

function merged(ranges, lines) {
  const result = []
  for (const [start, end] of ranges.map(([a, b]) => [Math.max(1, a), Math.min(lines, b)]).filter(([a,b]) => a <= b).sort((a,b) => a[0]-b[0])) {
    const prev = result.at(-1)
    if (prev && start <= prev[1] + 1) prev[1] = Math.max(prev[1], end)
    else result.push([start, end])
  }
  return result
}

export function diffRanges(diff) {
  return [...String(diff ?? '').matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
    .map(match => { const start = Number(match[1]); return [Math.max(1, start - 25), start + Math.max(1, Number(match[2] ?? 1)) + 25] })
}

// Excerpts are explicitly incomplete evidence, with exact line ranges and a hash
// of the FULL file. Never label omitted code as reviewed or silently truncate it.
export function sourceSlice(file, content, { ranges = [], query = '', maxChars = SOURCE_LIMITS.fileChars } = {}) {
  const sha256 = content === null ? null : digest(content)
  if (content === null) return { path: file, sha256, content: null, complete: true }
  if (/(^|\/)AGENTS\.md$/.test(file) && content.length > maxChars) throw new EnvironmentError(`작업 지침 전체가 입력 한도를 넘었습니다: ${file}. 지침을 생략하지 않습니다.`, {retry:false,code:'source_budget'})
  const lines = content.split('\n'), totalLines = lines.length
  if (content.length <= maxChars && !ranges.length) return { path: file, sha256, content, complete: true, totalLines }
  if (ranges.some(([a,b]) => a > totalLines || b > totalLines)) throw new EnvironmentError(`소스 줄 범위가 파일을 벗어났습니다: ${file} (1~${totalLines})`, { retry: false, code: 'source_range' })
  const outline = [], imports = [], declarations = []
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
    const line = offset => ast.getLineAndCharacterOfPosition(offset).line + 1
    const visit = node => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) imports.push([line(node.getStart(ast)), line(node.end)])
      const named = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
        || ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      if (named && node.name) {
        const name = node.name.getText(ast), start = line(node.getStart(ast)), end = line(node.end)
        declarations.push({ name, start, end })
        if (outline.length < 120) outline.push({ name, start, end })
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const picked = []
  const size = selection => merged(selection, totalLines).reduce((sum, [a,b]) => sum + lines.slice(a-1,b).join('\n').length, 0)
  // Explicitly requested ranges and changed hunks are mandatory. Oversized
  // mandatory evidence stops before the model call instead of hiding changes.
  if (size(ranges) > maxChars) throw new EnvironmentError(`필수 소스 구간이 입력 한도를 넘었습니다: ${file}. 더 작은 줄 범위나 작업 범위가 필요합니다.`, { retry: false, code: 'source_budget' })
  picked.push(...ranges)
  const add = candidate => { if (size([...picked, candidate]) <= maxChars) picked.push(candidate) }
  for (const range of imports) add(range)
  // Include whole containing functions when they fit; otherwise retain exact
  // changed ranges and expose the enclosing function's full range in outline.
  for (const [a,b] of ranges) {
    const enclosing = declarations.filter(d => d.start <= a && d.end >= b).sort((x,y) => (x.end-x.start)-(y.end-y.start))[0]
    if (enclosing) add([enclosing.start, enclosing.end])
  }
  add([1, Math.min(70, totalLines)])
  const terms = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [])]
    .filter(word => !['있어야','그리고','지금은','실제','데이터','작업','확인','요청','해야한다','있습니다'].includes(word)).slice(0,80)
  const hits = lines.map((text,i) => ({ line: i+1, score: terms.reduce((n,word) => n + (text.toLowerCase().includes(word) ? 1 : 0),0) }))
    .filter(hit => hit.score).sort((a,b) => b.score-a.score || a.line-b.line)
  for (const hit of hits.slice(0,12)) add([Math.max(1,hit.line-14), Math.min(totalLines,hit.line+24)])
  const selected = merged(picked, totalLines)
  const complete = selected.length === 1 && selected[0][0] === 1 && selected[0][1] === totalLines
  if (complete) return { path:file, sha256, content, complete:true, totalLines }
  return { path:file, sha256, complete:false, totalLines, outline, outlineOmitted:Math.max(0,declarations.length-outline.length),
    excerpts:selected.map(([start,end]) => ({start,end,content:lines.slice(start-1,end).join('\n')})),
    requestHint:`필요한 미제공 구간은 ${file}#L시작-L끝 형식으로 요청. 파일 전체를 읽었다고 가정하지 마세요.` }
}

export const sourceChars = item => item.content?.length ?? (item.excerpts ?? []).reduce((n,part) => n + part.content.length,0)

// Structural timestamps are not evidence changes and must not defeat caching.
export function stableContext(value) {
  if (Array.isArray(value)) return value.map(stableContext)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['capturedAt','generatedAt'].includes(key)).map(([key,item]) => [key,stableContext(item)]))
  return value
}
