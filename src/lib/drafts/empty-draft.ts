import type {
  DraftColorRow,
  DraftOptionRow,
  ProductDraftInput,
} from '@/lib/types'

/** 기획안에서 최대 몇 색까지 잡는지. 기획 시트가 9줄이다. */
export const MAX_DRAFT_COLORS = 9

function newId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function newColorRow(): DraftColorRow {
  return { id: newId('color'), name: '', orderQty: null }
}

export function newOptionRow(): DraftOptionRow {
  return { id: newId('option'), styleId: '', name: '', price: null }
}

export function emptyDraftInput(): ProductDraftInput {
  return {
    seasonId: null,
    status: 'open',
    owner: '',
    nameKo: '',
    nameEn: '',
    imageUrl: null,
    colors: [newColorRow()],
    sampleDone: false,
    orderDone: false,
    photoSampleDone: false,
    held: false,
    holdReason: '',
    heldAt: null,
    targetCost: null,
    costCurrency: 'CNY',
    costConfirmed: false,
    retailPrice: null,
    discountPrice: null,
    originCountry: '',
    registerType: '',
    openType: '',
    openTypeDetail: '',
    releaseIssue: '',
    specs: {
      size: { value: '', confirmed: false, note: '' },
      weight: { value: '', confirmed: false, note: '' },
      fabric: { value: '', confirmed: false, note: '' },
      coating: { value: '', confirmed: false, note: '' },
    },
    hasOptions: false,
    options: [],
    note: '',
  }
}
