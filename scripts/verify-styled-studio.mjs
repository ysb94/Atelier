import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, offline: true })
const page = await context.newPage()
const errors = [], network = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (req) => { if (/^https?:/.test(req.url())) network.push(req.url()) })
const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const photo = (name) => ({ name, mimeType: 'image/png', buffer })
const shot = async (name) => page.screenshot({ path: fileURLToPath(new URL('../outputs/' + name + '.png', import.meta.url)), fullPage: true })
async function saved() { await page.getByText('● 이 브라우저에 저장됨', { exact: true }).waitFor() }
async function persisted() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('atelier-styled-studio-v1', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, read = db.transaction('workspace').objectStore('workspace').get('current')
      read.onsuccess = () => { resolve(read.result); db.close() }
      read.onerror = () => { reject(read.error); db.close() }
    }
  }))
}
try {
  await page.goto(new URL('../outputs/연출컷-스튜디오.html', import.meta.url).href)
  await page.getByRole('heading', { name: '연출컷 스튜디오', exact: true }).waitFor()
  await saved()
  await shot('연출컷-스튜디오-화면')
  assert.ok(await page.getByRole('button', { name: '요청 흐름 체험', exact: true }).isDisabled())
  await page.getByRole('button', { name: '작업 예시 보기' }).click()
  await page.getByText('연결 후에는 이렇게 대화해요', { exact: true }).waitFor()
  await page.getByRole('button', { name: '예시 닫기' }).click()
  await page.getByLabel('제품명', { exact: true }).fill('니트 숄더백')
  await page.getByLabel('제품 사진 추가', { exact: true }).setInputFiles([photo('front.png'), photo('fabric.png'), photo('strap.png')])
  await page.getByAltText('strap.png', { exact: true }).waitFor()
  await page.getByLabel('front.png 역할', { exact: true }).selectOption('제품 기준')
  await page.getByLabel('fabric.png 역할', { exact: true }).selectOption('원단 디테일')
  await page.getByLabel('strap.png 역할', { exact: true }).selectOption('끈·구조')
  await page.getByLabel('레퍼런스 추가', { exact: true }).setInputFiles(photo('room.png'))
  await page.getByAltText('room.png', { exact: true }).waitFor()
  await page.getByRole('button', { name: '레퍼런스처럼 만들어줘', exact: true }).click()
  await page.getByRole('button', { name: '요청 흐름 체험', exact: true }).click()
  assert.equal(await page.locator('.cs-turn').count(), 1)
  assert.equal(await page.locator('.cs-inline-results button').count(), 2)
  assert.equal(await page.locator('.cs-mini-placeholder').count(), 2, '이미지 미생성 자리만 표시')
  await page.getByLabel('테스트 결과 사진 등록', { exact: true }).setInputFiles(photo('result.png'))
  await page.getByAltText('선택한 결과', { exact: true }).waitFor()
  await page.getByRole('button', { name: '끈만 자연스럽게', exact: true }).click()
  await page.getByRole('button', { name: '요청 흐름 체험', exact: true }).click()
  assert.equal(await page.locator('.cs-turn').count(), 2)
  assert.ok((await page.locator('.cs-turn').last().innerText()).includes('Adobe Firefly'))
  await page.getByRole('button', { name: '이 컷에서 대화 이어가기', exact: true }).click()
  await page.getByRole('button', { name: '배경만 바꿔줘', exact: true }).click()
  await page.getByRole('button', { name: '요청 흐름 체험', exact: true }).click()
  assert.ok((await page.locator('.cs-turn').last().innerText()).includes('Photoroom'))
  await page.getByRole('button', { name: '이 컷에서 대화 이어가기', exact: true }).click()
  await page.getByRole('button', { name: '다른 구도도 보여줘', exact: true }).click()
  await page.getByRole('button', { name: '요청 흐름 체험', exact: true }).click()
  assert.ok((await page.locator('.cs-turn').last().innerText()).includes('Nano Banana Pro'))
  await page.getByRole('button', { name: '최종 후보로 담기' }).click()
  await saved()
  const snapshot = await persisted()
  assert.equal(snapshot.versions.length, 5)
  assert.equal(snapshot.conversationUi.turns.length, 4)
  const detail = snapshot.conversationUi.turns[1]
  assert.deepEqual(detail.assetIds.map((id) => snapshot.assets[id].name).sort(), ['front.png', 'result.png', 'strap.png'])
  assert.equal(snapshot.conversationUi.turns[2].parentId, detail.versionIds[0])
  assert.equal(snapshot.versions.find((v) => v.id === snapshot.selectedId).favorite, true)
  await shot('연출컷-스튜디오-작업검증')
  await page.reload()
  await saved()
  assert.equal(await page.locator('.cs-turn').count(), 4)
  assert.equal(await page.locator('.cs-history-item').count(), 5)
  assert.equal(await page.getByAltText('front.png', { exact: true }).count(), 1)
  await page.getByRole('button', { name: '시안 1 이력 선택', exact: true }).click()
  await page.getByAltText('선택한 결과', { exact: true }).waitFor()
  await page.getByRole('button', { name: '끈만 자연스럽게', exact: true }).click()
  await page.getByRole('button', { name: '요청 흐름 체험', exact: true }).click()
  await saved()
  const forked = await persisted()
  assert.equal(forked.conversationUi.turns.at(-1).parentId, snapshot.conversationUi.turns[0].versionIds[0], '이전 컷에서 분기')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '모바일 가로 넘침 없음')
  await shot('연출컷-스튜디오-모바일')
  // Existing workspaces have no conversationUi. Keep their inputs/results/prompts visible.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('atelier-styled-studio-v1', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('workspace', 'readwrite'), store = tx.objectStore('workspace'), read = store.get('current')
      read.onsuccess = () => {
        const value = read.result
        value.product.front = value.conversationUi.sampleIds[0]
        delete value.conversationUi
        value.versions[0].prompt = '이전 작업 지시 보존'
        value.selectedId = value.versions[0].id
        store.put(value, 'current')
      }
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  }))
  await page.reload()
  await saved()
  await page.getByAltText('선택한 결과', { exact: true }).waitFor()
  await page.getByText('이전에 저장한 지시문', { exact: true }).click()
  assert.equal(await page.getByLabel('이전에 저장한 지시문').inputValue(), '이전 작업 지시 보존')
  assert.equal(await page.getByAltText('front.png', { exact: true }).count(), 1)
  assert.deepEqual(errors, [])
  assert.deepEqual(network, [])
  console.log('Studio UI verified: bulk uploads, role controls, conversation/revision branches, preview-only tools, attachments, persistence, legacy workspace, mobile, zero network.')
} finally { await browser.close() }
