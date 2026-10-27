import assert from 'node:assert/strict'
import { selectionHull, solidifyProductAlpha } from './spin-mask'
import { spinMovieViews } from './spin-photos'
import { spinEmbedCode, spinViewerHtml } from './spin-export'
import { motionRetimedTimes, spinFrameTimes, spinPixelStats, spinSampleWindow, spinWrap, validateSpinSettings, type SpinSettings } from './spin-core'

const settings: SpinSettings = { start: 2, end: 12, anchors: [], edge: 800, ai: false, brightness: 100, contrast: 100, crop: 0 }
const photoMovie = spinMovieViews(['앞', '오른쪽', '뒤', '왼쪽'])
assert.equal(photoMovie.length, 70)
assert.deepEqual([...new Set(photoMovie)], ['앞', '오른쪽', '뒤', '왼쪽'], '영상 재생 시간만 맞추며 새로운 원본 각도를 꾸미지 않음')
assert.deepEqual(spinMovieViews([]), [])
const mask = new Uint8Array(100)
for (let y = 1; y < 9; y++) for (let x = 2; x < 8; x++) if (!(y === 4 && x === 5)) mask[y * 10 + x] = 1
assert.equal(selectionHull(mask, 10, 10).length, 4, '선택 마스크의 구멍 때문에 실제 제품을 깎지 않음')
assert.throws(() => selectionHull(new Uint8Array(100), 10, 10))
const faded = new Uint8ClampedArray(10 * 10 * 4)
for (let y = 1; y < 9; y++) for (let x = 2; x < 8; x++) faded[(y * 10 + x) * 4 + 3] = 100
faded[(4 * 10 + 5) * 4 + 3] = 0
faded[3] = 255
solidifyProductAlpha(faded, 10, 10)
assert.equal(faded[(4 * 10 + 5) * 4 + 3], 255, '불투명 인쇄면의 잘못된 내부 구멍 복원')
assert.equal(faded[(2 * 10 + 3) * 4 + 3], 255, '옅어진 제품 내부를 불투명하게 보존')
assert.equal(faded[3], 0, '외부 배경을 제품으로 채우지 않음')
validateSpinSettings(settings, 15)
validateSpinSettings({ ...settings, region: { x: 0.2, y: 0.1, width: 0.4, height: 0.7 } }, 15)
for (const region of [{ x: -0.1, y: 0, width: 0.5, height: 1 }, { x: 0.8, y: 0, width: 0.5, height: 1 }, { x: 0, y: NaN, width: 1, height: 1 }, { x: 0, y: 0, width: 0.001, height: 1 }]) assert.throws(() => validateSpinSettings({ ...settings, region }, 15))
const times = spinFrameTimes(settings)
const paused = Array.from({ length: 101 }, (_, index) => ({ time: 2 + index / 10, signature: [index < 30 ? index * 4 : index < 70 ? 120 : (index - 40) * 4] }))
const retimed = motionRetimedTimes(settings, paused)
assert.equal(retimed.length, 70)
assert.ok(retimed.filter(time => time > 5 && time < 9).length < 4, '정지 구간을 중복 각도로 길게 선택하지 않음')
assert.ok(retimed.every((time, index) => !index || time >= retimed[index - 1]), '변화량 보정 후에도 시간 순서 유지')
assert.equal(times.length, 70)
assert.equal(times[0], 2)
assert.ok(times.at(-1)! < 12, '첫 각도와 겹치는 끝 각도를 중복 출력하지 않음')
const uneven = spinFrameTimes({ ...settings, anchors: [{ angle: 90, time: 3 }, { angle: 180, time: 8 }, { angle: 270, time: 10 }] })
assert.equal(uneven[35], 8, '속도가 달라도 지정한 180도 시각을 따름')
const fastEnd = spinFrameTimes({ ...settings, anchors: [{ angle: 270, time: 11.999 }] })
assert.ok(spinSampleWindow(fastEnd, 69, 2, 12).every(time => time >= fastEnd[68] && time < 12), '매우 짧은 마지막 구간에서도 후보 순서를 보존')
for (let i = 0; i < 70; i++) {
  const candidates = spinSampleWindow(times, i, 2, 12)
  assert.ok(candidates.every(time => time >= 2 && time < 12))
  if (i) assert.ok(spinSampleWindow(times, i - 1, 2, 12).at(-1)! <= candidates[0], '선명도 후보가 다음 각도를 역전하지 않음')
}
for (const patch of [{ end: 2 }, { start: NaN }, { edge: 4096 }, { brightness: 0 }, { anchors: [{ angle: 180, time: 13 }] }, { anchors: [{ angle: 270, time: 5 }, { angle: 90, time: 6 }] }]) assert.throws(() => validateSpinSettings({ ...settings, ...patch }, 15))
assert.equal(spinWrap(-1, 70), 69); assert.equal(spinWrap(70, 70), 0)
const flat = new Uint8ClampedArray(16 * 16 * 4).fill(128), checker = new Uint8ClampedArray(flat)
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let c = 0; c < 3; c++) checker[(y * 16 + x) * 4 + c] = (x + y) % 2 ? 255 : 0
assert.ok(spinPixelStats(checker, 16, 16).sharpness > spinPixelStats(flat, 16, 16).sharpness)
assert.throws(() => spinEmbedCode('javascript:alert(1)', '상품'))
assert.throws(() => spinEmbedCode('https://user:password@example.com/viewer.html', '상품'))
const hostile = '</script><script>alert(1)</script><img onerror=alert(1)>'
const html = spinViewerHtml(hostile, ['frames/001.webp', 'frames/002.webp'])
assert.ok(!html.includes(hostile), '사용자 제목을 코드로 실행하지 않음')
assert.ok(!html.includes('http'), '완성 뷰어에는 외부 런타임 의존성 없음')
assert.ok(spinEmbedCode('https://example.com/viewer.html', '" onload="alert(1)').includes('&quot;'))
console.log('spin360-core: 70프레임, 기준 각도 보간, 선명도 후보 순서, 입력 검증, 회전 래핑, 선명도 분석, HTML/URL 안전성 통과')
