/** 브랜드 데이터 캐시는 항상 brandId 를 앞에 둔다. */
export function brandQueryKey(
  domain: string,
  brandId: string,
  ...rest: unknown[]
) {
  return [domain, brandId, ...rest] as const
}

/** 여러 브랜드를 한 번에 묶은 회사 목록. 브랜드별 키와 섞이지 않게 한다. */
export function companyQueryKey(
  domain: string,
  brandIds: readonly string[],
  ...rest: unknown[]
) {
  return [domain, 'company', [...brandIds].sort(), ...rest] as const
}

export function sortedBrandIds(brandIds: readonly string[]) {
  return [...brandIds].sort()
}
