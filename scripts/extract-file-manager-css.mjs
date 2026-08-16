import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const html = fs.readFileSync(
  path.join(root, 'File_Manager_260626_2.html'),
  'utf8',
)
const start = html.indexOf('<style>')
const end = html.indexOf('</style>')
if (start < 0 || end < 0) throw new Error('style block missing')
let css = html.slice(start + '<style>'.length, end)

css = css
  .replace(/\*\s*\{[\s\S]*?\}/, '')
  .replace(/:root\s*\{([\s\S]*?)\}/, (_, body) => `.design-file-manager {${body}}`)
  .replace(/html\s*,\s*body\s*\{[\s\S]*?\}/, '')
  .replace(/\bbody\s*\{[\s\S]*?\}/, '')
  .replace(/button\s*,\s*input\s*,\s*select\s*,\s*textarea\s*\{[\s\S]*?\}/, '')
  .replace(/\bbutton\s*\{[\s\S]*?\}/, '')
  .replace(/\bbutton:hover\s*\{[\s\S]*?\}/, '')
  .replace(/body\.app-busy\s*\{[\s\S]*?\}/, '')
  .replace(/100vh/g, '100%')

/**
 * Prefix class/id/element selectors with .design-file-manager.
 * Leaves @keyframes / @media headers alone; prefixes rules inside @media.
 */
function prefixRuleSelectors(selectorList) {
  return selectorList
    .split(',')
    .map((raw) => {
      const sel = raw.trim()
      if (!sel) return sel
      if (sel.startsWith('.design-file-manager')) return sel
      if (sel.startsWith('@')) return sel
      return `.design-file-manager ${sel}`
    })
    .join(', ')
}

function prefixCss(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    if (source.startsWith('@keyframes', i)) {
      const brace = source.indexOf('{', i)
      let depth = 0
      let j = brace
      for (; j < source.length; j++) {
        if (source[j] === '{') depth++
        else if (source[j] === '}') {
          depth--
          if (depth === 0) {
            j++
            break
          }
        }
      }
      out += source.slice(i, j)
      i = j
      continue
    }
    if (source.startsWith('@media', i)) {
      const brace = source.indexOf('{', i)
      out += source.slice(i, brace + 1)
      i = brace + 1
      let depth = 1
      let bodyStart = i
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++
        else if (source[i] === '}') depth--
        i++
      }
      const body = source.slice(bodyStart, i - 1)
      out += prefixCss(body)
      out += '}'
      continue
    }

    const nextBrace = source.indexOf('{', i)
    if (nextBrace === -1) {
      out += source.slice(i)
      break
    }
    const selectors = source.slice(i, nextBrace)
    let depth = 0
    let j = nextBrace
    for (; j < source.length; j++) {
      if (source[j] === '{') depth++
      else if (source[j] === '}') {
        depth--
        if (depth === 0) {
          j++
          break
        }
      }
    }
    const block = source.slice(nextBrace, j)
    const trimmedSelectors = selectors.trim()
    if (!trimmedSelectors) {
      out += selectors + block
    } else {
      out += `\n${prefixRuleSelectors(trimmedSelectors)} ${block}`
    }
    i = j
  }
  return out
}

const header = `
.design-file-manager {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 13px;
  color: #222;
  background: #fff;
  box-sizing: border-box;
}
.design-file-manager *,
.design-file-manager *::before,
.design-file-manager *::after {
  box-sizing: border-box;
}
.design-file-manager button,
.design-file-manager input,
.design-file-manager select,
.design-file-manager textarea {
  font: inherit;
}
.design-file-manager button {
  border: 1px solid #d8d8d8;
  background: #fff;
  cursor: pointer;
}
.design-file-manager button:hover {
  background: #f2f2f2;
}
.design-file-manager.app-busy {
  overflow: hidden;
}
`

const scoped = `${header}\n${prefixCss(css)}\n`
const publicOut = path.join(root, 'public/design-file-manager.css')
const srcOut = path.join(
  root,
  'src/features/design/file-manager/file-manager.css',
)
fs.mkdirSync(path.dirname(publicOut), { recursive: true })
fs.writeFileSync(publicOut, scoped)
// Keep a tiny stub so the import path still exists but Tailwind only sees trivial CSS.
fs.writeFileSync(
  srcOut,
  '/* Styles load from /design-file-manager.css to avoid Tailwind parsing the large sheet. */\n',
)
console.log('wrote', publicOut, scoped.length)
