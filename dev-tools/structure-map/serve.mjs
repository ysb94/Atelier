import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build, root, toolDir, indexFile } from './build.mjs'
import { sourceFiles } from './analyze.mjs'

export function inputFingerprint() {
  const hash = crypto.createHash('sha256')
  const files = [...sourceFiles(root), ...['domains.json', 'analyze.mjs', 'labels.mjs', 'build.mjs'].map(f => path.relative(root, path.join(toolDir, f)))].sort()
  for (const file of files) hash.update(file).update(fs.readFileSync(path.join(root, file)))
  return hash.digest('hex')
}

export function startServer(port = 4318, watch = true) {
  let signature = inputFingerprint()
  let current
  let refreshError = null
  let lastFailedSignature = null
  try {
    current = build(true)
  } catch (error) {
    refreshError = String(error)
    lastFailedSignature = signature
    console.warn('[structure-map] 첫 분석 실패; 기존 AI 목차 유지 후 코드 수정 감시', error)
    try {
      const aiIndex = fs.readFileSync(indexFile, 'utf8')
      current = { fingerprint: 'cached', aiIndex }
    } catch {
      current = { fingerprint: 'unavailable', aiIndex: `# Atelier AI Code Index (unavailable)\n\n${refreshError}\n` }
    }
  }

  function regenerate() {
    try {
      const observed = inputFingerprint()
      const next = build(true)
      current = next
      signature = observed
      refreshError = null
      lastFailedSignature = null
      return true
    } catch (error) {
      refreshError = String(error)
      console.warn('[structure-map] 갱신 실패; 직전 AI 목차 유지', error)
      return false
    }
  }

  const server = http.createServer((request, response) => {
    const actualPort = server.address()?.port
    if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(request.headers.host)) {
      response.writeHead(403).end('Host rejected')
      return
    }
    const address = request.url?.split('?')[0]
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (request.method === 'GET' && address === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ tool: 'atelier-structure-map', mode: 'ai-index', root, watch, fingerprint: current.fingerprint, error: refreshError }))
    } else if (request.method === 'GET' && (address === '/' || address === '/ai-index.md')) {
      response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
      response.end(current.aiIndex)
    } else if (request.method === 'POST' && address === '/rebuild') {
      const ok = regenerate()
      response.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok, fingerprint: current.fingerprint, error: refreshError }))
    } else {
      response.writeHead(404).end('Not found')
    }
  })

  const interval = watch ? setInterval(() => {
    try {
      const observed = inputFingerprint()
      if (observed !== signature && observed !== lastFailedSignature && !regenerate()) lastFailedSignature = observed
    } catch (error) {
      console.warn('[structure-map] 변경 감지 실패', error)
    }
  }, 2000) : null

  server.on('close', () => {
    if (interval) clearInterval(interval)
  })
  server.listen(port, '127.0.0.1', () => console.info(`[structure-map] AI 목차 자동 갱신 실행 중 (dev-tools/structure-map/generated/ai-index.md)`))
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.find(value => value.startsWith('--port='))
  const port = Number(portArg?.split('=')[1] ?? 4318)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('포트는 1~65535 정수여야 합니다.')
  const server = startServer(port, !process.argv.includes('--no-watch'))
  server.on('error', error => { console.error('[structure-map] 로컬 감시 서버 시작 실패', error); server.close(); process.exitCode = 1 })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close() })
}
