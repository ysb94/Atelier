import fs from 'node:fs'
import path from 'node:path'

// Node cannot spawn npm's Windows .cmd launchers with shell:false. Resolve
// standard Node launchers to their JS entry instead of interpolating a shell.
export function cliCommand(command, args = [], { env = process.env, cwd = process.cwd() } = {}) {
  if (process.platform !== 'win32') return { command, args }
  const explicit = path.isAbsolute(command) || /[\\/]/.test(command)
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
  const directories = explicit ? [''] : searchPath.split(path.delimiter).filter(Boolean).map(value => value.replace(/^"|"$/g, ''))
  const names = path.extname(command) ? [command] : [command + '.exe', command + '.com', command + '.cmd', command + '.bat']
  let executable
  for (const dir of directories) {
    for (const name of names) {
      const candidate = explicit ? path.resolve(cwd, name) : path.join(dir, name)
      try { if (fs.statSync(candidate).isFile()) { executable = candidate; break } } catch { /* Continue PATH lookup. */ }
    }
    if (executable) break
  }
  if (!executable) return { command, args }
  if (!/\.(?:cmd|bat)$/i.test(executable)) return { command: executable, args }
  const source = fs.readFileSync(executable, 'utf8')
  const entry = source.match(/"%_prog%"\s+"(?:%dp0%|%~dp0)[\\/]*([^"\r\n]+\.(?:js|cjs|mjs))"\s+%\*/i)?.[1]
  const script = entry && path.resolve(path.dirname(executable), entry)
  if (!script || !fs.existsSync(script)) {
    const error = new Error('Windows CLI 실행기는 표준 npm Node 실행 파일 또는 .exe 경로여야 합니다. ATELIER_CODEX_BIN 또는 ATELIER_GH_BIN 설정을 확인하세요.')
    error.code = 'ENOEXEC'
    throw error
  }
  return { command: process.execPath, args: [script, ...args] }
}
