import { Navigate, useParams, useSearchParams } from 'react-router-dom'

/** 예전 설정 → 가져오기 경로. 데이터 일괄 업로드로 보낸다. */
export function ImportSettingsPage() {
  const { brandSlug } = useParams()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode')
  const query = mode === 'single' ? '?mode=single' : ''
  return <Navigate to={`/b/${brandSlug}/data/upload${query}`} replace />
}
