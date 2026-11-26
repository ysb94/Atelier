import { CDN_BASE } from '@/features/design/file-manager/file-manager-config'

export function readPublicModelUrl(value: string | null): URL | null {
  if (!value) return null
  try {
    const model = new URL(value)
    return model.origin === CDN_BASE && !model.username && !model.password && /\.glb$/i.test(model.pathname) ? model : null
  } catch {
    return null
  }
}

export function publicModelViewerUrl(modelUrl: string, origin = window.location.origin): string {
  const viewer = new URL('/viewer.html', origin)
  viewer.searchParams.set('model', modelUrl)
  return viewer.href
}
