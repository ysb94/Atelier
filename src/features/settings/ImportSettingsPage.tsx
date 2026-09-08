import { Navigate, useSearchParams } from 'react-router-dom'

/** 예전 설정 → 가져오기 경로. 데이터 일괄 업로드로 보낸다. */
export function ImportSettingsPage() {
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode')
  const brand = searchParams.get('brand')
  const next = new URLSearchParams()
  if (mode === 'single') next.set('mode', 'single')
  if (brand) next.set('brand', brand)
  const suffix = next.toString()
  return <Navigate to={suffix ? `/data/upload?${suffix}` : '/data/upload'} replace />
}
