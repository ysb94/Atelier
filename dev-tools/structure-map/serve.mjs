import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build, root, toolDir, outputFile } from './build.mjs'
import { sourceFiles } from './analyze.mjs'

export function inputFingerprint() {
  const hash = crypto.createHash('sha256')
  const files = [...sourceFiles(root), ...['domains.json', 'viewer.html', 'viewer.css', 'viewer.js', 'analyze.mjs', 'labels.mjs', 'build.mjs'].map(f => path.relative(root, path.join(toolDir, f)))].sort()
  for (const file of files) hash.update(file).update(fs.readFileSync(path.join(root, file)))
  return hash.digest('hex')
}

export function startServer(port = 4318, watch = true) {
  const clients = new Set()
  let signature = inputFingerprint()
  let current
  let refreshError = null
  let lastFailedSignature = null
  try { current = build(false) }
  catch (error) {
    refreshError = String(error)
    lastFailedSignature = signature
    console.warn('[structure-map] 첫 분석 실패; 저장된 구조도 유지 후 코드 수정 감시', error)
    try {
      const html = fs.readFileSync(outputFile, 'utf8')
      const embedded = html.match(/<script id="structure-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
      if (!embedded) throw new Error('저장된 구조도 데이터 없음')
      current = JSON.parse(embedded)
      Object.defineProperty(current, 'html', { value: html })
    } catch (snapshotError) {
      console.warn('[structure-map] 저장된 구조도 없음; 분석 대기 화면 사용', snapshotError.message)
      const message = refreshError.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      current = { fingerprint: 'unavailable', html: `<!doctype html><meta charset="utf-8"><title>Atelier 개발 구조도</title><h1>코드 수정 후 구조도를 자동 생성합니다.</h1><p>첫 분석에 실패했습니다. 코드 수정 후 이 화면이 자동 갱신됩니다. 자세한 내용은 서버 콘솔을 확인하세요.</p><pre>${message}</pre><script>new EventSource('/events').addEventListener('updated',()=>location.reload())</script>` }
    }
  }
  function regenerate() {
    try {
      const observed = inputFingerprint()
      const next = build(false)
      current = next
      signature = observed
      refreshError = null
      lastFailedSignature = null
      for (const client of clients) client.write(`event: updated\ndata: ${JSON.stringify({ fingerprint: current.fingerprint })}\n\n`)
      return true
    } catch (error) {
      refreshError = String(error)
      console.warn('[structure-map] 갱신 실패; 직전 구조도 유지', error)
      for (const client of clients) client.write(`event: build-error\ndata: ${JSON.stringify({ message: refreshError })}\n\n`)
      return false
    }
  }
  const server = http.createServer((request, response) => {
    // A local browser may read the viewer; cross-origin pages cannot request a rebuild.
    const actualPort = server.address()?.port
    if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(request.headers.host)) {
      response.writeHead(403).end('Host rejected')
      return
    }
    const expectedOrigin = `http://${request.headers.host}`
    if (request.headers.origin && request.headers.origin !== expectedOrigin) {
      response.writeHead(403).end('Origin rejected')
      return
    }
    const address = request.url?.split('?')[0]
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (request.method === 'GET' && address === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ tool: 'atelier-structure-map', root, watch }))
    } else if (request.method === 'GET' && (address === '/' || address === '/atelier-structure.html')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(current.html)
    } else if (request.method === 'GET' && address === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
      response.write(`event: ready\ndata: ${JSON.stringify({ fingerprint: current.fingerprint, watch, error: refreshError })}\n\n`)
      clients.add(response)
      request.on('close', () => clients.delete(response))
    } else if (request.method === 'POST' && address === '/rebuild' && request.headers['x-structure-map'] === 'local-viewer') {
      const ok = regenerate()
      response.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok, fingerprint: current.fingerprint }))
    } else response.writeHead(404).end('Not found')
  })
  const interval = watch ? setInterval(() => {
    try {
      const observed = inputFingerprint()
      if (observed !== signature && observed !== lastFailedSignature && !regenerate()) lastFailedSignature = observed
    }
    catch (error) { console.warn('[structure-map] 변경 감지 실패', error) }
  }, 2000) : null
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n') }, 20000)
  server.on('close', () => {
    if (interval) clearInterval(interval)
    clearInterval(heartbeat)
    for (const client of clients) client.end()
  })
  server.listen(port, '127.0.0.1', () => console.info(`[structure-map] http://127.0.0.1:${server.address().port} ${watch ? '(코드 변경 감시 중)' : ''}`))
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.find(value => value.startsWith('--port='))
  const port = Number(portArg?.split('=')[1] ?? 4318)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('포트는 1~65535 정수여야 합니다.')
  const server = startServer(port, !process.argv.includes('--no-watch'))
  server.on('error', error => { console.error('[structure-map] 로컬 서버 시작 실패', error); server.close(); process.exitCode = 1 })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close() })
}
