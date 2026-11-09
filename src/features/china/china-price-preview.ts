import type { DraftColorRow, ProductDraft } from '@/lib/types'

export const priceRequestLabels = { first: '1차 요청', repeat: '단가 재요청' } as const
export type PriceRequestKind = keyof typeof priceRequestLabels
type PriceColor = { id: string; name: string; photoUrl: string | null }
type PricePreviewProduct = {
  brandName: string
  draftNo: string
  imageUrl: string | null
  owner: string
  nameKo: string
  nameEn: string
  colors: PriceColor[]
}

export type ChinaPricePreviewRequest = {
  id: string
  kind: PriceRequestKind
  requestedAt: string
  product: PricePreviewProduct
}

export type ChinaPricePreviewState = Record<string, { amounts: Record<string, string>; sent?: boolean }>

function colorPhoto(draft: ProductDraft, color: DraftColorRow) {
  return draft.specs.colorImageChoices?.[color.id] === 'Image'
    ? draft.specs.colorPhotoUrls?.[color.id]?.trim() || null
    : null
}

export function buildChinaPricePreviewRequests(
  drafts: readonly ProductDraft[],
  brandById: ReadonlyMap<string, { name: string }> | undefined,
  requestedAt: string,
): ChinaPricePreviewRequest[] {
  const draft = drafts.find(item => item.colors.some(color => color.name.trim() && colorPhoto(item, color)))
    ?? drafts.find(item => item.colors.some(color => color.name.trim()))

  const product: PricePreviewProduct = draft ? {
    brandName: brandById?.get(draft.brandId ?? '')?.name ?? '브랜드 미정',
    draftNo: draft.draftNo,
    imageUrl: draft.imageUrl,
    owner: draft.owner,
    nameKo: draft.nameKo,
    nameEn: draft.nameEn,
    colors: draft.colors.filter(color => color.name.trim()).map(color => ({
      id: color.id, name: color.name, photoUrl: colorPhoto(draft, color),
    })),
  } : {
    brandName: '브랜드 미정', draftNo: 'PL-0000', imageUrl: null,
    owner: '디자이너', nameKo: '예시 상품', nameEn: 'Sample Product',
    colors: ['Black', 'Yellow', 'Light Yellow'].map(name => ({ id: name, name, photoUrl: null })),
  }

  const kinds: PriceRequestKind[] = ['first', 'repeat']
  return kinds.map(kind => ({ id: `${draft?.id ?? 'sample'}:${kind}`, kind, requestedAt, product }))
}
