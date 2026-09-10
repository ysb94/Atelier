import { serializeBrandSelection } from '../products/company-brand-filter'

export type SearchPatch = Record<string, string | null>

export type CompanyLocation = {
  pathname: string
  searchPatch: SearchPatch
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

export function withSearch(pathname: string, patch: SearchPatch): string {
  const search = applySearchPatch(new URLSearchParams(), patch)
  const suffix = search.toString()
  return suffix ? `${pathname}?${suffix}` : pathname
}

export function applySearchPatch(
  current: URLSearchParams,
  patch: SearchPatch,
): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') next.delete(key)
    else next.set(key, value)
  }
  return next
}

export function brandsQueryValue(
  slugs: string[],
  availableSlugs: string[],
): string | null {
  return serializeBrandSelection(slugs, availableSlugs)
}

export function withBrandsFilter(
  pathname: string,
  slugs: string[],
  availableSlugs: string[],
): string {
  return withSearch(pathname, {
    brands: brandsQueryValue(slugs, availableSlugs),
  })
}

export function withBrandTarget(pathname: string, slug: string): string {
  return withSearch(pathname, { brand: slug })
}

export function dataUploadHref(
  brandSlug: string,
  extra: SearchPatch = {},
): string {
  return withSearch('/data/upload', { brand: brandSlug, ...extra })
}

export function productDetailPath(brandSlug: string, styleNo: string) {
  return `/products/${brandSlug}/${encodeURIComponent(styleNo)}`
}

export function productWorkPath(owner: string) {
  return `/product-work/${owner}`
}

export function productWorkDetailPath(
  owner: string,
  brandSlug: string,
  styleNo: string,
) {
  return `/product-work/${owner}/${brandSlug}/${encodeURIComponent(styleNo)}`
}

export function dataSheetDetailPath(
  owner: string,
  brandSlug: string,
  styleNo: string,
) {
  return `/data/${owner}/${brandSlug}/${encodeURIComponent(styleNo)}`
}

export function draftDetailPath(draftId: string) {
  return `/drafts/${draftId}`
}

export function chinaWorkOrdersPath() {
  return '/china/work-orders'
}

export function designColorSamplesPath() {
  return '/design/color-samples'
}

export function companyMeetingsPath() {
  return '/meetings'
}

export function draftNewPath(brandSlug?: string, extra: SearchPatch = {}) {
  return brandSlug
    ? withSearch('/drafts/new', { brand: brandSlug, ...extra })
    : withSearch('/drafts/new', extra)
}

export function settingsPath(kind: string, brandSlug: string) {
  return withBrandTarget(`/settings/${kind}`, brandSlug)
}

/**
 * 예전 `/b/:slug/...` 경로를 회사 경로와 brands/brand 파라미터로 옮긴다.
 * 목록은 brands, 설정·업로드·새 작업은 brand 를 쓴다.
 */
export function mapLegacyBrandPath(
  brandSlug: string,
  restPath: string,
): CompanyLocation {
  const rest = trimSlashes(restPath)
  const parts = rest ? rest.split('/') : []
  const [head, ...tail] = parts

  if (!head) return { pathname: '/', searchPatch: {} }

  if (head === 'products') {
    const styleNo = tail[0]
    return {
      pathname: styleNo
        ? productDetailPath(brandSlug, decodeURIComponent(styleNo))
        : '/products',
      searchPatch: { brands: brandSlug },
    }
  }

  if (head === 'drafts') {
    if (tail[0] === 'new') {
      return { pathname: '/drafts/new', searchPatch: { brand: brandSlug } }
    }
    if (tail[0] === 'all' || tail.length === 0) {
      return { pathname: '/drafts', searchPatch: { brands: brandSlug } }
    }
    if (tail[0] === 'season' && tail[1]) {
      return {
        pathname: '/drafts',
        searchPatch: {
          brands: brandSlug,
          season: decodeURIComponent(tail[1]),
        },
      }
    }
    return {
      pathname: draftDetailPath(decodeURIComponent(tail[0])),
      searchPatch: {},
    }
  }

  if (head === 'work' && tail[0]) {
    const owner = tail[0]
    const styleNo = tail[1]
    return {
      pathname: styleNo
        ? productWorkDetailPath(owner, brandSlug, decodeURIComponent(styleNo))
        : productWorkPath(owner),
      searchPatch: { brands: brandSlug },
    }
  }

  if (head === 'design' && tail[0] === 'file-manager') {
    return { pathname: '/design/file-manager', searchPatch: {} }
  }

  if (head === 'logistics') {
    if (tail[0] === 'invoice-data-entry' || tail[0] === 'invoices') {
      return {
        pathname: '/logistics/invoices',
        searchPatch: { brand: brandSlug },
      }
    }
    if (tail[0] === 'barcode-outbound-data-entry') {
      return {
        pathname: '/logistics/barcode-outbound-data-entry',
        searchPatch: { brand: brandSlug },
      }
    }
    if (tail[0] === 'bulk-outbound') {
      return {
        pathname: '/logistics/bulk-outbound',
        searchPatch: { brands: brandSlug },
      }
    }
    if (tail[0] === 'warehouses') {
      return {
        pathname: '/logistics/warehouses',
        searchPatch: { brands: brandSlug },
      }
    }
    if (!tail[0]) {
      return {
        pathname: productWorkPath('logistics'),
        searchPatch: { brands: brandSlug },
      }
    }
  }

  if (head === 'data') {
    if (!tail[0] || tail[0] === 'all') {
      const styleNo = tail[0] === 'all' ? tail[1] : undefined
      return {
        pathname: styleNo
          ? dataSheetDetailPath('all', brandSlug, decodeURIComponent(styleNo))
          : '/data/all',
        searchPatch: { brands: brandSlug },
      }
    }
    if (tail[0] === 'upload') {
      return { pathname: '/data/upload', searchPatch: { brand: brandSlug } }
    }
    const owner = tail[0]
    const styleNo = tail[1]
    return {
      pathname: styleNo
        ? dataSheetDetailPath(owner, brandSlug, decodeURIComponent(styleNo))
        : `/data/${owner}`,
      searchPatch: { brands: brandSlug },
    }
  }

  if (head === 'barcodes') {
    return { pathname: '/barcodes', searchPatch: { brands: brandSlug } }
  }
  if (head === 'usage-codes') {
    return { pathname: '/usage-codes', searchPatch: { brands: brandSlug } }
  }
  if (head === 'partner-codes') {
    return { pathname: '/partner-codes', searchPatch: { brands: brandSlug } }
  }
  if (head === 'operations' || head === 'outbound-data') {
    return { pathname: '/operations', searchPatch: { brands: brandSlug } }
  }

  if (head === 'settings') {
    if (tail[0] === 'profile') {
      return { pathname: '/settings/profile', searchPatch: {} }
    }
    if (tail[0] === 'members') {
      return { pathname: '/members', searchPatch: {} }
    }
    if (tail[0] === 'import') {
      return { pathname: '/data/upload', searchPatch: { brand: brandSlug } }
    }
    if (tail[0]) {
      return {
        pathname: `/settings/${tail[0]}`,
        searchPatch: { brand: brandSlug },
      }
    }
  }

  if (head === 'org-chart') {
    return { pathname: '/org-chart', searchPatch: {} }
  }
  if (head === 'meetings') {
    return { pathname: '/meetings', searchPatch: {} }
  }
  if (head === 'work-requests' && tail[0]) {
    return { pathname: `/work-requests/${tail[0]}`, searchPatch: {} }
  }
  if (head === 'upload' || head === 'import') {
    return { pathname: '/data/upload', searchPatch: { brand: brandSlug } }
  }
  if (head === 'planning' || head === 'design' || head === 'md') {
    return {
      pathname: productWorkPath(head),
      searchPatch: { brands: brandSlug },
    }
  }

  return { pathname: '/', searchPatch: {} }
}

export function buildLegacyRedirectHref(
  brandSlug: string,
  restPath: string,
  currentSearch: string,
): string {
  const mapped = mapLegacyBrandPath(brandSlug, restPath)
  const search = applySearchPatch(
    new URLSearchParams(currentSearch),
    mapped.searchPatch,
  )
  const suffix = search.toString()
  return suffix ? `${mapped.pathname}?${suffix}` : mapped.pathname
}
