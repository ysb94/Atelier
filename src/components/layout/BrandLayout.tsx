import { Navigate, useLocation, useParams } from 'react-router-dom'
import { buildLegacyRedirectHref } from '@/lib/workspace/company-paths'

/** 예전 `/b/:slug/*` 작업장은 회사 경로로만 보낸다. */
export function BrandLayout() {
  const { brandSlug = '' } = useParams()
  const location = useLocation()
  const rest = location.pathname.replace(/^\/b\/[^/]+/, '')
  const href = buildLegacyRedirectHref(brandSlug, rest, location.search)
  return <Navigate to={href} replace />
}
