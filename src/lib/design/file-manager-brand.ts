import { brandStorageRoot } from '../company/capabilities'

/** ATELIER 실제 R2 루트. 기존 파일은 `type/...` 에 있고 루트 폴더명만 masmarulez 다. */
export const ATELIER_STORAGE_ROOT = 'masmarulez'

const ATELIER_SLUGS = new Set(['atelier', 'masmarulez'])

/** Worker가 prefix 없이 type 전체만 돌려주는 현재 계약에서 쓰는 최상위 폴더. */
export const R2_BROWSE_TYPES = new Set([
  'embed',
  'image',
  'spin360',
  'video',
  'logs',
])

export type BrandFileCapability = {
  slug: string
  root: string
  canOperate: boolean
  reason: string | null
}

/**
 * R2 Worker 필요 계약:
 * - GET /list?type=&prefix=ROOT → ROOT/type/ 또는 기본 루트의 type/ 만
 * - PUT/DELETE/MOVE 키도 같은 prefix 안만 허용
 * 지금은 prefix를 무시하므로 비-ATELIER 브랜드 파일 작업을 열지 않는다.
 */
export const R2_WORKER_PREFIX_CONTRACT =
  'GET /list?type=&prefix=ROOT 가 ROOT 밖 키를 돌려주면 안 된다. 쓰기도 ROOT/ 또는 기본 type/ 만 허용해야 한다.'

export function isAtelierBrandSlug(slug?: string | null) {
  return ATELIER_SLUGS.has((slug ?? '').trim().toLowerCase())
}

export function brandFileCapability(slug?: string | null): BrandFileCapability {
  const normalized = (slug ?? '').trim().toLowerCase()
  const root = brandStorageRoot(normalized)
  if (!normalized) {
    return {
      slug: '',
      root,
      canOperate: false,
      reason: '파일을 다룰 브랜드를 먼저 고르세요.',
    }
  }
  if (isAtelierBrandSlug(normalized)) {
    return { slug: normalized, root, canOperate: true, reason: null }
  }
  return {
    slug: normalized,
    root,
    canOperate: false,
    reason:
      'R2 Worker가 브랜드 prefix 필터를 아직 지원하지 않습니다. 이 브랜드 파일은 열 수 없습니다.',
  }
}

export function storageKeyFirstSegment(key: string) {
  return key.replace(/^\/+/, '').split('/')[0] ?? ''
}

/** ATELIER는 기존 type/ 키와 masmarulez/ 키만, 다른 브랜드는 자기 루트만 허용한다. */
export function isKeyAllowedForBrand(key: string, slug?: string | null) {
  const capability = brandFileCapability(slug)
  if (!capability.canOperate) return false
  const first = storageKeyFirstSegment(key)
  if (!first) return false
  if (isAtelierBrandSlug(capability.slug)) {
    return first === ATELIER_STORAGE_ROOT || R2_BROWSE_TYPES.has(first)
  }
  return first === capability.root
}

export function assertKeyAllowedForBrand(key: string, slug?: string | null) {
  if (isKeyAllowedForBrand(key, slug)) return
  throw new Error('다른 브랜드 파일 경로로는 작업할 수 없습니다.')
}

export function filterItemsForBrand<T extends { key?: string; name?: string }>(
  items: T[],
  type: string,
  slug?: string | null,
): T[] {
  return items.filter((item) => {
    const key = item.key || `${type}/${item.name || ''}`
    return isKeyAllowedForBrand(key, slug)
  })
}

/** ATELIER는 기존처럼 type/folder, 다른 브랜드는 root/type/folder. 후자는 열지 않는다. */
export function buildBrandUploadPath(
  slug: string,
  type: string,
  folder?: string | null,
) {
  const capability = brandFileCapability(slug)
  if (!capability.canOperate) {
    throw new Error(
      capability.reason ?? '이 브랜드 파일은 업로드할 수 없습니다.',
    )
  }
  const relative = folder ? `${type}/${folder}` : type
  if (isAtelierBrandSlug(slug)) return relative
  return `${capability.root}/${relative}`
}

export function scopedStorageKey(slug: string, key: string) {
  assertKeyAllowedForBrand(key, slug)
  return key
}
