import { createRoot } from 'react-dom/client'
import { SpinModelViewer } from './SpinModelViewer'
import { readPublicModelUrl } from './model-viewer-url'
import '@/index.css'

const model = readPublicModelUrl(new URLSearchParams(window.location.search).get('model'))

createRoot(document.getElementById('viewer')!).render(
  model
    ? <SpinModelViewer src={model.href} title="상품 360도 보기" embedded />
    : <p role="alert" className="p-4 text-sm">올바른 상품 3D 모델 주소를 지정해 주세요.</p>,
)
