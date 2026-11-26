import { createModelViewer } from '../../src/features/spin360/model-viewer-engine'

const stage = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!

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
  const viewer = createModelViewer(stage, readEmbeddedModel(), {
    ready() {
      status.textContent = ''
      stage.tabIndex = 0
    },
    error(message) {
      status.textContent = message
      stage.removeAttribute('tabindex')
    },
  }, { stageHeightFill: 0.9 })
  stage.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    viewer.rotateBy(event.key === 'ArrowRight' ? 15 : -15)
  })
  window.addEventListener('pagehide', event => { if (!event.persisted) viewer.dispose() })
} catch {
  status.textContent = '이 브라우저에서 3D 화면을 열 수 없습니다.'
}
