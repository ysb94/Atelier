export function companyRowKey(brandId: string, rowId: string) {
  return `${brandId}:${rowId}`
}

export function parseCompanyRowKey(
  key: string,
): { brandId: string; rowId: string } | null {
  const splitAt = key.indexOf(':')
  if (splitAt <= 0 || splitAt === key.length - 1) return null
  return {
    brandId: key.slice(0, splitAt),
    rowId: key.slice(splitAt + 1),
  }
}

export function sameBrandId(left: string | null | undefined, right: string) {
  return Boolean(left) && left === right
}
