import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'
import JSZip from 'jszip'
import { chromium } from 'playwright-core'

const root = process.cwd()
const actor = 'fixture-owner'
const asset = Buffer.from('local sample work order')
const digest = data => createHash('sha256').update(data).digest('hex')
const chunkSize = 6 * 1024 * 1024
const art = Buffer.alloc(chunkSize + 11, 71)
const file = { path: 'published/file', name: '작업지시서.ai', size: asset.length, sha256: digest(asset) }
const server = createServer((req, res) => {
  assert.equal(new URL(req.url, 'http://127.0.0.1').searchParams.get('download'), file.name)
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="fixture.ai"' })
  res.end(asset)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const { outputFiles: [bundle] } = await build({
  stdin: { sourcefile: 'fixture.tsx', loader: 'tsx', resolveDir: root, contents: `
    import { createRoot } from 'react-dom/client'
    import { useState } from 'react'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { SampleWorkOrderPackField } from '@/features/drafts/SampleWorkOrderPackField'
    import { useSamplePackDownload } from '@/features/drafts/useSamplePackDownload'
    import { getSupabase } from '@/lib/supabase/client'
    import { validateSelectedSampleFiles } from '@/lib/supabase/sample-work-order-packs'
    getSupabase().auth.getSession = async () => ({ data: { session: { user: { id: '${actor}' }, access_token: 'fixture' } }, error: null })
    function App() {
      const bulk = useSamplePackDownload()
      const [result, setResult] = useState('')
      function receive(id) {
        setResult('')
        void bulk.download(id, id).then(saved => setResult(saved ? '받기 완료' : '받기 취소'), error => setResult(error.message))
      }
      return <><SampleWorkOrderPackField label="1차 샘플" slot="first" draftId="fixture" onRegister={async () => setResult('등록 완료')} />
        <button onClick={() => receive('small')}>작은 첨부 전체 받기</button>
        <button onClick={() => receive('large')}>큰 첨부 전체 받기</button>
        <button onClick={() => receive('corrupt')}>잘못된 파일 받기</button>
        <output>{result}</output>{bulk.dialog}</>
    }
    window.checkAttachmentSize = (sizes) => {
      try { validateSelectedSampleFiles([], sizes.map(size => ({size, name:'시안.ai'}))); return true } catch { return false }
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>)
  ` },
  alias: { '@': path.join(root, 'src') }, bundle: true, write: false, format: 'esm', jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(origin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '"fixture-key"',
  },
  plugins: [{ name: 'fixture-auth', setup(build) {
    build.onResolve({ filter: /^@\/lib\/supabase\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
    build.onLoad({ filter: /^auth$/, namespace: 'fixture' }, () => ({
      contents: `export const useAuth = () => ({profile:{id:'${actor}'},session:{user:{id:'${actor}'}}})`,
    }))
  } }],
})

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ acceptDownloads: true })
  await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }) })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const requests = []
  let offset = 0, starts = 0, resumes = 0, interrupted = false, saved
  const draftPack = { id: 'draft-pack', revision: '1', published: false, notes: '', files: [] }
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    requests.push(`${req.method()} ${url.pathname}`)
    if (url.origin !== origin) return route.abort()
    const json = value => route.fulfill({ json: value })
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.text })
    if (url.pathname.endsWith('/get_sample_work_order_pack')) {
      const id = req.postDataJSON().p_id
      if (!id) return json(null)
      return json({ ...draftPack, published: true, id, files: [{ ...file, size: id === 'large' ? 200_000_000 : file.size, sha256: id === 'corrupt' ? '0'.repeat(64) : file.sha256 }] })
    }
    if (url.pathname.endsWith('/open_sample_work_order_pack')) return json(draftPack)
    if (url.pathname.endsWith('/save_sample_work_order_pack')) {
      saved = req.postDataJSON().p_files
      return json({ ...draftPack, files: saved })
    }
    if (url.pathname.startsWith('/storage/v1/upload/resumable')) {
      if (req.method() === 'POST') {
        starts++
        assert.equal(Number(req.headers()['upload-length']), art.length)
        return route.fulfill({ status: 201, headers: { location: origin + '/storage/v1/upload/resumable/session' } })
      }
      if (req.method() === 'HEAD') {
        resumes++
        return route.fulfill({ status: 200, headers: { 'upload-offset': String(offset), 'upload-length': String(art.length) } })
      }
      assert.equal(req.method(), 'PATCH')
      assert.equal(Number(req.headers()['upload-offset']), offset)
      if (offset && !interrupted) { interrupted = true; return route.fulfill({ status: 423 }) }
      offset += req.postDataBuffer().length
      return route.fulfill({ status: 204, headers: { 'upload-offset': String(offset) } })
    }
    if (url.pathname.endsWith('/object/sign/sample-work-orders/published/file')) {
      return json({ signedURL: '/object/signed-fixture?token=fixture' })
    }
    if (url.pathname.endsWith('/object/signed-fixture')) {
      return url.searchParams.has('download') ? route.continue() : route.fulfill({ body: asset })
    }
    return route.abort()
  })
  await page.goto(origin)
  assert.equal(await page.evaluate(() => window.checkAttachmentSize([10_000_000_000])), true)
  assert.equal(await page.evaluate(() => window.checkAttachmentSize([10_000_000_000, 1])), false)
  assert.equal(await page.evaluate(() => window.checkAttachmentSize(Array(11).fill(1))), true)
  await page.getByLabel('1차 샘플 작업지시서 파일', { exact: true }).setInputFiles({ name: '시안.ai', mimeType: 'application/octet-stream', buffer: art })
  await page.getByRole('button', { name: '첨부 1개 · 등록' }).click()
  await page.getByText('등록 완료', { exact: true }).waitFor({ timeout: 15000 }).catch(async cause => {
    console.error({ requests, errors, body: await page.locator('body').innerText(), offset, starts, resumes })
    throw cause
  })
  assert.equal(starts, 1)
  assert.equal(resumes, 1)
  assert.equal(offset, art.length)
  assert.equal(saved[0].sha256, digest(art))

  let download = page.waitForEvent('download')
  await page.getByRole('button', { name: '작은 첨부 전체 받기' }).click()
  const archive = await JSZip.loadAsync(await readFile(await (await download).path()))
  assert.deepEqual(await archive.file(file.name).async('nodebuffer'), asset)
  await page.getByRole('button', { name: '잘못된 파일 받기' }).click()
  await page.getByText(`파일을 다시 확인해 주세요. ${file.name}`, { exact: true }).waitFor({ timeout: 5000 }).catch(async cause => {
    console.error({ requests, errors, body: await page.locator('body').innerText() })
    throw cause
  })
  await page.getByRole('button', { name: '큰 첨부 전체 받기' }).click()
  await page.getByRole('dialog', { name: '작업지시서 첨부 받기' }).waitFor()
  const confirm = page.getByRole('button', { name: '다운로드 확인' })
  assert.equal(await confirm.isEnabled(), false)
  download = page.waitForEvent('download')
  await page.getByRole('button', { name: `${file.name} 받기` }).click()
  assert.deepEqual(await readFile(await (await download).path()), asset)
  await confirm.click()
  await page.getByText('받기 완료', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Sample work orders: 10 GB boundary, 11 files, AI upload, chunk retry through HEAD, ZIP checksum and individual download fallback passed.')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
