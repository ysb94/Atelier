import { buildOutboundPartnerNameIndex } from './outbound-partner-matching'
import { compactOutboundPartnerKey, outboundPartnerDisplayName } from './outbound-partner'
import { filterOutboundPartnersByCategory } from './outbound-folder'
import type { CodeUsageTarget, CodeUsageTargetAlias, CodeUsageTargetFolder, SabangnetProduct } from '@/lib/types'

export type SabangnetMallUrl = {
  id: string; brandId: string; productId: string; targetId: string; url: string
  mallProductCode: string; sourceMall: string; sourceFile: string; sourceRow: number
  mallProductName?: string
}
export type UrlImportStatus = 'ready' | 'unchanged' | 'conflict' | 'missing-code' | 'missing-mall' | 'invalid' | 'duplicate'
export type UrlImportRow = {
  lineNo: number; mall: string; code: string; name: string; mallProductCode: string; url: string
  productId: string | null; targetId: string | null; targetName: string
  status: UrlImportStatus; reason: string
}
export const URL_STATUS_LABEL: Record<UrlImportStatus, string> = {
  ready: '등록 예정', unchanged: '이미 등록됨', conflict: 'URL 충돌 · 보류',
  'missing-code': '코드 없음 · 제외', 'missing-mall': '업체 미연결', invalid: '값 확인 필요', duplicate: '파일 내 동일 URL',
}
export function validMallUrl(value: string): boolean {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password }
  catch { return false /* URL 구문 오류는 예상된 검증 결과다. */ }
}
export function prepareSabangnetUrlRows(options: {
  rows: string[][]; products: readonly SabangnetProduct[]; targets: readonly CodeUsageTarget[]
  aliases: readonly CodeUsageTargetAlias[]; folders: readonly CodeUsageTargetFolder[]; existing: readonly SabangnetMallUrl[]
}): UrlImportRow[] {
  const { rows, products, targets, aliases, folders, existing } = options
  const headerIndex = rows.slice(0, 10).findIndex(row => row.some(v => v.trim() === '쇼핑몰명') && row.some(v => v.trim() === '쇼핑몰상품코드 URL'))
  if (headerIndex < 0) throw new Error('쇼핑몰명·품번코드·쇼핑몰상품코드 URL 헤더가 필요합니다.')
  const headers = rows[headerIndex]!.map(v => v.trim())
  const mallIdx = headers.indexOf('쇼핑몰명'), codeIdx = headers.indexOf('품번코드'), urlIdx = headers.indexOf('쇼핑몰상품코드 URL')
  if (codeIdx < 0) throw new Error('C열에 해당하는 품번코드 헤더가 없습니다.')
  const shopIdx = headers.indexOf('쇼핑몰상품코드'), nameIdx = headers.indexOf('상품명(송신)')
  const onlineRoot = folders.find(f => !f.parentId && compactOutboundPartnerKey(f.name) === '온라인')
  if (!onlineRoot) throw new Error('온라인 출고업체 분류가 없습니다.')
  const scoped = filterOutboundPartnersByCategory(targets.filter(t => t.active), folders, onlineRoot.id)
  const index = buildOutboundPartnerNameIndex(scoped, aliases)
  const productsByCode = new Map<string, SabangnetProduct[]>()
  for (const product of products) { const list = productsByCode.get(product.code.trim()) ?? []; list.push(product); productsByCode.set(product.code.trim(), list) }
  const saved = new Map(existing.map(v => [`${v.targetId}|${v.productId}`, v.url]))
  const prepared: UrlImportRow[] = []
  const groups = new Map<string, UrlImportRow[]>()
  rows.slice(headerIndex + 1).forEach((raw, i) => {
    if (!raw.some(v => v.trim())) return
    const mall = raw[mallIdx]?.trim() ?? '', code = raw[codeIdx]?.trim() ?? '', url = raw[urlIdx]?.trim() ?? ''
    const product = productsByCode.get(code), target = index.get(compactOutboundPartnerKey(mall))
    let status: UrlImportStatus = 'ready', reason = ''
    if (!mall || !code || !validMallUrl(url)) { status = 'invalid'; reason = '업체명·코드 또는 http/https URL을 확인하세요.' }
    else if (!product) { status = 'missing-code'; reason = '사이트에 없는 코드는 생성하지 않습니다.' }
    else if (product.length !== 1) { status = 'invalid'; reason = '같은 코드에 상품이 여러 개입니다.' }
    else if (!target) { status = 'missing-mall'; reason = '온라인 업체명·별칭을 확인하세요.' }
    const row: UrlImportRow = { lineNo: headerIndex + i + 2, mall, code, url, name: raw[nameIdx]?.trim() ?? '', mallProductCode: raw[shopIdx]?.trim() ?? '', productId: product?.length === 1 ? product[0]!.id : null, targetId: target?.id ?? null, targetName: target ? outboundPartnerDisplayName(target) : '', status, reason }
    prepared.push(row)
    // 연결 여부와 무관하게 파일의 동일 업체/코드 조합 전체를 충돌 검사한다.
    const groupKey = `${target?.id ?? compactOutboundPartnerKey(mall)}|${code}`
    const list = groups.get(groupKey) ?? []; list.push(row); groups.set(groupKey, list)
  })
  for (const group of groups.values()) {
    const urls = new Set(group.map(v => v.url))
    if (urls.size > 1) { for (const row of group) { row.status = 'conflict'; row.reason = '같은 업체·같은 코드에 서로 다른 URL이 있어 전체 보류합니다.' } continue }
    let accepted = false
    for (const row of group) {
      if (row.status !== 'ready') continue
      const old = saved.get(`${row.targetId}|${row.productId}`)
      if (old && old !== row.url) { row.status = 'conflict'; row.reason = '기존 저장 URL과 다릅니다. 덮어쓰지 않습니다.' }
      else if (old) row.status = 'unchanged'
      else if (accepted) row.status = 'duplicate'
      else accepted = true
    }
  }
  return prepared
}

export function urlImportPayload(rows: readonly UrlImportRow[]) {
  return rows.filter(r => r.status === 'ready').map(r => ({ product_id: r.productId, target_id: r.targetId, url: r.url, mall_product_code: r.mallProductCode, mall_product_name: r.name, source_mall: r.mall, source_row: r.lineNo }))
}
