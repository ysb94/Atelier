import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>()
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    node.geometry.dispose()
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      material.dispose()
    }
  })
  for (const texture of textures) {
    texture.dispose()
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close()
  }
}

export function createModelViewer(host: HTMLElement, src: string, callbacks: {
  ready: () => void; error: (message: string) => void; angle: (degrees: number) => void
}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const canvas = renderer.domElement
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab'
  canvas.setAttribute('aria-label', '좌우로 드래그하여 3D 제품 회전')
  canvas.dataset.ready = 'false'
  host.append(canvas)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('white')
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, .01, 100)
  camera.position.set(0, .15, 5)
  camera.lookAt(0, 0, 0)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb7b7b7, 2))
  for (const [x, y, z, power] of [[3, 4, 5, 2], [-3, 2, -4, 1.5]]) {
    const light = new THREE.DirectionalLight(0xffffff, power)
    light.position.set(x, y, z)
    scene.add(light)
  }
  const pivot = new THREE.Group()
  scene.add(pivot)
  let disposed = false, loaded = false, active = true, visible = true, playing = false
  let angle = 0, target = 0, frame = 0, lastTime = 0
  let drag: { id: number; x: number; angle: number } | null = null
  const controller = new AbortController()
  const allowed = () => active && visible && !document.hidden && !disposed && loaded
  const schedule = () => { if (!frame && allowed()) frame = requestAnimationFrame(tick) }
  function tick(now: number) {
    frame = 0
    if (!allowed()) { lastTime = 0; return }
    const seconds = lastTime ? Math.min((now - lastTime) / 1000, .05) : 1 / 60
    lastTime = now
    if (playing && !drag) target += seconds * 24
    angle += (target - angle) * (1 - Math.exp(-seconds * 18))
    if (Math.abs(target - angle) < .001) angle = target
    pivot.rotation.y = -Math.PI / 2 + THREE.MathUtils.degToRad(angle)
    renderer.render(scene, camera)
    const normalized = ((angle % 360) + 360) % 360
    canvas.dataset.angle = normalized.toFixed(3)
    callbacks.angle(normalized)
    if (playing || Math.abs(target - angle) > .001) schedule()
    else lastTime = 0
  }
  const pauseFrame = () => { cancelAnimationFrame(frame); frame = 0; lastTime = 0 }
  const resize = new ResizeObserver(() => {
    const width = Math.max(1, host.clientWidth)
    renderer.setSize(width, width, false)
    schedule()
  })
  resize.observe(host)
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) schedule(); else pauseFrame()
  })
  intersection.observe(host)
  const visibility = () => { if (document.hidden) pauseFrame(); else schedule() }
  document.addEventListener('visibilitychange', visibility)
  canvas.onpointerdown = event => {
    if (event.button !== 0 || !loaded) return
    drag = { id: event.pointerId, x: event.clientX, angle: target }
    canvas.setPointerCapture(event.pointerId)
    canvas.style.cursor = 'grabbing'
  }
  canvas.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId) return
    target = drag.angle + (event.clientX - drag.x) / Math.max(1, host.clientWidth) * 360
    schedule()
  }
  const endDrag = () => { drag = null; canvas.style.cursor = 'grab'; schedule() }
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = endDrag
  const lost = (event: Event) => {
    event.preventDefault()
    loaded = false
    pauseFrame()
    callbacks.error('3D 표시 연결이 끊겼습니다. 다시 불러오기를 눌러 주세요.')
  }
  canvas.addEventListener('webglcontextlost', lost)
  void (async () => {
    try {
      const response = await fetch(src, { signal: controller.signal })
      if (!response.ok) throw new Error(`모델 조회 실패 (HTTP ${response.status})`)
      const data = await response.arrayBuffer()
      if (disposed) return
      const gltf = await new GLTFLoader().parseAsync(data, new URL('.', src).href)
      if (disposed) { disposeObject(gltf.scene); return }
      const bounds = new THREE.Box3().setFromObject(gltf.scene)
      const size = bounds.getSize(new THREE.Vector3())
      const extent = Math.max(size.x, size.y, size.z)
      if (!Number.isFinite(extent) || extent <= 0) { disposeObject(gltf.scene); throw new Error('표시할 3D 모델이 없습니다.') }
      gltf.scene.position.sub(bounds.getCenter(new THREE.Vector3()))
      pivot.add(gltf.scene)
      pivot.scale.setScalar(2 / extent)
      loaded = true
      canvas.dataset.ready = 'true'
      callbacks.ready()
      schedule()
    } catch (error) {
      if (disposed) return
      console.warn('[spin360] 3D 모델 표시 실패', { src, error })
      callbacks.error('3D 모델을 불러오지 못했습니다. 연결을 확인하고 다시 불러와 주세요.')
    }
  })()
  return {
    rotate(degrees: number) { target = degrees; schedule() },
    play(value: boolean) { playing = value; schedule() },
    setActive(value: boolean) { active = value; if (active) schedule(); else pauseFrame() },
    dispose() {
      disposed = true
      controller.abort()
      pauseFrame()
      resize.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.onpointerdown = canvas.onpointermove = canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = null
      disposeObject(pivot)
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
