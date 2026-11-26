import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { build } from 'esbuild'
import type { Plugin } from 'vite'

const downloadPath = /^\/__atelier-spin360\/job\/([a-z0-9-]{8,64})\/model-360\.html$/
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const viewerHeader = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:">
  <title>상품 360도 보기</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #171717; background: #fff; font: 14px system-ui, sans-serif; }
    main { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 8px; height: 100dvh; padding: 8px; }
    .stage-frame { position: relative; min-height: 0; overflow: hidden; border: 1px solid #ddd; border-radius: 8px; }
    #stage { width: 100%; height: 100%; }
    #status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 12px; text-align: center; pointer-events: none; }
    #status:empty { display: none; }
    .controls { display: flex; align-items: center; gap: 10px; }
    input { flex: 1; min-width: 0; }
    button { padding: 6px 12px; border: 1px solid #aaa; border-radius: 5px; background: #fff; color: inherit; font: inherit; }
  </style>
</head>
<body>
  <main aria-label="상품 360도 보기">
    <div class="stage-frame">
      <div id="stage"></div><p id="status" role="status">360 모델을 불러오는 중입니다.</p>
    </div>
    <div class="controls">
      <input id="angle" type="range" min="0" max="360" step="0.1" value="0" aria-label="3D 회전 각도" disabled>
      <button id="play" type="button" disabled>자동 회전</button>
    </div>
  </main>
  <div id="model" hidden>`

async function* viewerHtml(model: Readable, viewerScript: string) {
  yield viewerHeader
  for await (const chunk of model) {
    const bytes: Buffer = chunk
    // Bound each text node so the browser can parse and decode large models in pieces.
    const partSize = 48 * 1024
    for (let start = 0; start < bytes.length; start += partSize) {
      const base64 = bytes.subarray(start, start + partSize).toString('base64')
      yield `<script type="application/octet-stream">${base64}</script>`
    }
  }
  yield `</div><script>${viewerScript}</script></body></html>`
}

export function spinHtmlDownloadPlugin(service: string): Plugin {
  let bundle: Promise<string> | undefined
  return {
    name: 'atelier-spin-html-download',
    apply: 'serve',
    configureServer(server) {
      function viewerBundle() {
        bundle ??= build({
          entryPoints: [path.join(server.config.root, 'scripts/tripo360/download-viewer.ts')],
          bundle: true, write: false, minify: true, legalComments: 'eof', platform: 'browser', format: 'iife',
        }).then(result => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'))
          .catch((error: unknown) => { bundle = undefined; throw error })
        return bundle
      }

      server.middlewares.use(async (request, response, next) => {
        const id = downloadPath.exec(request.url?.split('?')[0] ?? '')?.[1]
        if (!id) return next()
        const { host, origin } = request.headers
        if (request.method !== 'GET' || !loopbackAddresses.has(request.socket.remoteAddress ?? '') ||
            !host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) ||
            (origin && origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') {
          response.writeHead(403).end('Forbidden')
          return
        }
        const controller = new AbortController()
        const cancel = () => controller.abort()
        response.once('close', cancel)
        try {
          const script = await viewerBundle()
          const model = await fetch(`${service}/job/${id}/model.glb`, { signal: controller.signal, redirect: 'error' })
          if (!model.ok || !model.body || model.headers.get('content-type') !== 'model/gltf-binary') {
            await model.body?.cancel()
            throw new Error('저장된 GLB를 읽을 수 없습니다.')
          }
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': 'attachment; filename="model-360.html"',
            'Cache-Control': 'no-store',
          })
          await pipeline(Readable.from(viewerHtml(Readable.fromWeb(model.body), script)), response)
        } catch (error) {
          if (controller.signal.aborted) return
          console.warn('[spin360] HTML 다운로드 실패', { id, name: error instanceof Error ? error.name : 'unknown' })
          if (response.headersSent) response.destroy()
          else response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }).end('360 HTML을 만들 수 없습니다. 제작 서버 또는 저장된 모델을 확인해 주세요.')
        } finally {
          response.off('close', cancel)
        }
      })
    },
  }
}
