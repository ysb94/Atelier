import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(toolDir, '../..')
const normalized = value => path.resolve(value).replaceAll('\\', '/').toLowerCase()

async function existingViewer(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return false
    const data = await response.json()
    return data.tool === 'atelier-structure-map' && data.watch === true && normalized(data.root) === normalized(root)
  } catch (error) {
    // A missing server is normal at startup. Other probe failures remain visible.
    if (!['ECONNREFUSED', 'UND_ERR_SOCKET'].includes(error.cause?.code) && error.name !== 'TimeoutError') console.warn('[dev] 구조도 서버 확인 실패', error.message)
    return false
  }
}

async function existingManager(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return false
    const data = await response.json()
    return data.tool === 'atelier-ai-workflow' && data.watch === true && normalized(data.root) === normalized(root)
  } catch (error) {
    if (!['ECONNREFUSED', 'UND_ERR_SOCKET'].includes(error.cause?.code) && error.name !== 'TimeoutError') console.warn('[dev] 자동화 관리자 확인 실패', error.message)
    return false
  }
}

export async function startDevelopment(viteArgs = [], structurePort = Number(process.env.ATELIER_STRUCTURE_PORT ?? 4318)) {
  if (!Number.isInteger(structurePort) || structurePort < 1 || structurePort > 65535) throw new Error('ATELIER_STRUCTURE_PORT는 1~65535 정수여야 합니다.')
  const children = new Set()
  let stopping = false
  function stop() {
    if (stopping) return
    stopping = true
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  }
  function launch(script, args, required, label = '구조도') {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', windowsHide: true })
    children.add(child)
    child.once('error', error => { console.error(`[dev] ${required ? 'Atelier' : label} 시작 실패`, error); if (required) { process.exitCode = 1; stop() } })
    child.once('exit', (code, signal) => {
      children.delete(child)
      if (stopping) return
      if (required) { process.exitCode = code ?? (signal ? 1 : 0); stop() }
      else console.warn(`[dev] ${label}가 종료되었습니다. Atelier 개발 서버는 계속 실행합니다.`, { code, signal })
    })
    return child
  }
  // Keep analysis in a separate process so rebuilding the map cannot stall Vite.
  const viteCli = path.join(path.dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin/vite.js')
  const vite = launch(viteCli, viteArgs, true)
  const url = `http://127.0.0.1:${structurePort}/`
  let structure = null
  if (await existingViewer(structurePort)) console.info(`[dev] 기존 개발 구조도 사용: ${url}`)
  else if (!stopping) structure = launch(path.join(toolDir, 'serve.mjs'), [`--port=${structurePort}`], false)
  console.info(`[dev] 개발 구조도: ${url} · 전체 총람에서 모든 기능·파일 확인`)
  let automation = null
  try {
    const { settings } = await import('../ai-workflow/settings.mjs')
    const automationPort = settings().port
    if (await existingManager(automationPort)) console.info(`[dev] 기존 자동화 관리자 사용: http://127.0.0.1:${automationPort}/health`)
    else if (!stopping) automation = launch(path.resolve(toolDir, '../ai-workflow/serve.mjs'), [], false, '자동화 관리자')
  } catch (error) { console.warn('[dev] 자동화 설정 확인 실패. Atelier 개발 서버는 계속 실행합니다.', error.message) }
  return { vite, structure, automation, stop, url }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let development
  let interrupted = false
  const stop = () => { interrupted = true; development?.stop() }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop)
  process.on('exit', () => development?.stop())
  try { development = await startDevelopment(process.argv.slice(2)); if (interrupted) development.stop() }
  catch (error) { console.error('[dev] 개발 서버 시작 실패', error); process.exitCode = 1 }
}
