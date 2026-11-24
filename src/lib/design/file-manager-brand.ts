import { brandStorageRoot } from '../company/capabilities'

/** ATELIER 실제 R2 루트. 기존 파일은 `type/...` 에 있고 루트 폴더명만 masmarulez 다. */
export const ATELIER_STORAGE_ROOT = 'masmarulez'

const ATELIER_SLUGS = new Set(['atelier', 'masmarulez'])

// Worker가 숨기는 루트와 파일 업로드 대신 정적 파일 조회로 처리하는 경로.
const reservedRoots = new Set([ATELIER_STORAGE_ROOT, 'logs', 'static'])

export function topLevelFolderNameError(name: string): string | null {
  if (reservedRoots.has(name)) return '시스템에서 사용하는 이름입니다. 다른 폴더 이름을 입력하세요.'
  if (!/^[A-Za-z0-9가-힣_-]+$/.test(name)) {
    return '최상위 폴더 이름에는 한글, 영문, 숫자, 밑줄(_), 하이픈(-)만 사용할 수 있습니다.'
  }
  return null
}

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

export function isKeyAllowedForBrand(key: string, slug?: string | null) {
  if (!brandFileCapability(slug).canOperate || key.includes('\\')) return false
  const parts = key.replace(/\/$/, '').split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return false
  const [root] = parts
  // 이미 저장한 masmarulez/... 키는 그대로 참조하되 가상 루트 자체는 조작하지 않는다.
  if (root === ATELIER_STORAGE_ROOT) return parts.length > 1
  return topLevelFolderNameError(root) === null
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
  const prefix = `${type}/`
  const legacyPrefix = `${ATELIER_STORAGE_ROOT}/${prefix}`
  return items.filter((item) => {
    const key = item.key || `${type}/${item.name || ''}`
    return (key.startsWith(prefix) || key.startsWith(legacyPrefix)) && isKeyAllowedForBrand(key, slug)
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
