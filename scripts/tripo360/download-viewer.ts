import { createModelViewer } from '../../src/features/spin360/model-viewer-engine'

const stage = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!
const angle = document.querySelector<HTMLInputElement>('#angle')!
const play = document.querySelector<HTMLButtonElement>('#play')!

function readEmbeddedModel() {
  const embedded = document.querySelector('#model')!
  const parts = [...embedded.children]
  const length = parts.reduce((size, part) => {
    const encoded = part.textContent ?? ''
    const padding = encoded.endsWith('==') ? 2 : Number(encoded.endsWith('='))
    return size + encoded.length / 4 * 3 - padding
  }, 0)
  const bytes = new Uint8Array(length)
  embedded.remove()
  let offset = 0
  for (const part of parts) {
    const binary = atob(part.textContent ?? '')
    for (let i = 0; i < binary.length; i++) bytes[offset + i] = binary.charCodeAt(i)
    offset += binary.length
    part.remove()
  }
  return bytes.buffer
}

try {
  let playing = false
  const viewer = createModelViewer(stage, readEmbeddedModel(), {
    ready() {
      status.textContent = ''
      angle.disabled = false
      play.disabled = false
    },
    error(message) {
      status.textContent = message
      angle.disabled = true
      play.disabled = true
    },
    angle: value => { angle.value = String(value) },
  }, { stageHeightFill: 0.78 })
  function setPlaying(value: boolean) {
    playing = value
    viewer.play(value)
    play.textContent = value ? '회전 멈춤' : '자동 회전'
  }
  angle.addEventListener('input', () => {
    setPlaying(false)
    viewer.rotate(angle.valueAsNumber)
  })
  play.addEventListener('click', () => setPlaying(!playing))
  window.addEventListener('pagehide', event => { if (!event.persisted) viewer.dispose() })
} catch {
  status.textContent = '이 브라우저에서 3D 화면을 열 수 없습니다.'
}
