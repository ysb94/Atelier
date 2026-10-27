import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { Input, ALL_FORMATS, BlobSource, EncodedPacketSink } from 'mediabunny'
import { chromium } from 'playwright-core'

// verify-spin360-real-video.mjs --full이 만든 실제 결과 파일을 독립적으로 다시 연다.
const folder = path.resolve(process.env.SPIN360_RESULT_DIR || 'dev-tools/ai-workflow/.state/spin360-real')
const movie = await fs.readFile(path.join(folder, 'white-background-360.mp4'))
const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([movie])) })
let metadata
try {
  const track = await input.getPrimaryVideoTrack()
  assert.ok(track)
  const packets = []
  for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet)
  metadata = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), codec: await track.getCodec(), duration: await input.computeDuration(), packets: packets.length }
  assert.equal(metadata.width, 800); assert.equal(metadata.height, 800)
  assert.equal(metadata.codec, 'avc'); assert.equal(metadata.packets, 70)
  assert.ok(Math.abs(metadata.duration - 3.5) < .01)
  assert.ok(packets.every((packet, i) => Math.abs(packet.timestamp - i / 20) < .001))
} finally { input.dispose() }
const zip = await JSZip.loadAsync(await fs.readFile(path.join(folder, 'white-background-360.zip')))
const names = Object.keys(zip.files).filter(name => /^frames\/\d{3}\.webp$/.test(name)).sort()
assert.equal(names.length, 70)
assert.deepEqual(await zip.file('rotation.mp4').async('nodebuffer'), movie)
const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
assert.equal(manifest.frameCount, 70); assert.equal(manifest.video.fps, 20)
assert.equal(manifest.aiModel.id, 'studioludens/birefnet-lite-512')
assert.equal(manifest.aiModel.target.id, 'Xenova/slimsam-77-uniform')
assert.ok(manifest.frames.every((frame, i) => !i || frame.selectedTime >= manifest.frames[i - 1].selectedTime))
const frameFolder = path.join(folder, 'qa-frames')
await fs.mkdir(frameFolder, { recursive: true })
const hashes = []
for (const name of names) {
  const bytes = await zip.file(name).async('nodebuffer')
  hashes.push(createHash('sha256').update(bytes).digest('hex'))
  await fs.writeFile(path.join(frameFolder, path.basename(name)), bytes)
}
assert.equal(new Set(hashes).size, 70, '중복 이미지로 70장을 채우지 않음')
const html = await fs.readFile(path.join(folder, 'white-background-360.html'), 'utf8')
assert.equal((html.match(/data:image\/webp;base64/g) || []).length, 70)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let pixelProof
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => /^(file:|data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort())
  await page.goto(pathToFileURL(path.join(folder, 'white-background-360.html')).href)
  await page.locator('#image').evaluate(image => image.decode())
  await page.locator('#stage').focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('#stage').getAttribute('aria-valuenow'), '2')
  await page.locator('#image').evaluate(image => image.decode())
  await page.screenshot({ path: path.join(folder, 'html-preview.png') })
  await page.setContent('<input id="frames" type="file" multiple><input id="video" type="file"><video muted></video>')
  await page.locator('#frames').setInputFiles(names.map(name => path.join(frameFolder, path.basename(name))))
  pixelProof = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 800
    const context = canvas.getContext('2d', { willReadFrequently: true }), results = []
    for (const file of document.querySelector('#frames').files) {
      const image = await createImageBitmap(file)
      if (image.width !== 800 || image.height !== 800) throw Error('프레임 크기 불일치')
      context.drawImage(image, 0, 0); image.close()
      const pixels = context.getImageData(0, 0, 800, 800).data
      let productPixels = 0, left = 800, top = 800, right = 0, bottom = 0
      for (let y = 0; y < 800; y++) for (let x = 0; x < 800; x++) {
        const i = (y * 800 + x) * 4
        if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 225) { productPixels++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y) }
        if ((x < 40 || x >= 760) && (y < 40 || y >= 760) && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 248) throw Error(file.name + ': 모서리에 흰 배경이 아님')
      }
      if (productPixels < 1000 || bottom - top < 400) throw Error(file.name + ': 제품이 없거나 잘린 프레임')
      results.push({ file: file.name, productPixels, bounds: { left, top, right, bottom } })
    }
    return results
  })
  await page.locator('#video').setInputFiles(path.join(folder, 'white-background-360.mp4'))
  const playback = await page.evaluate(async () => {
    const video = document.querySelector('video'), url = URL.createObjectURL(document.querySelector('#video').files[0])
    try { video.src = url; await video.play(); await new Promise(resolve => setTimeout(resolve, 350)); return { time: video.currentTime, width: video.videoWidth, height: video.videoHeight } }
    finally { video.pause(); URL.revokeObjectURL(url) }
  })
  assert.ok(playback.time > .1); assert.equal(playback.width, 800); assert.equal(playback.height, 800)
  assert.deepEqual(errors, [])
} finally { await browser.close() }
const proof = { metadata, images: names.length, uniqueImages: new Set(hashes).size, pixelProof }
await fs.writeFile(path.join(folder, 'artifact-proof.json'), JSON.stringify(proof, null, 2))
console.log('spin360-artifacts: MP4 800×800/20fps/70frames/3.5s, 70 unique images, white corners, product presence, ZIP, offline HTML and video playback passed')
