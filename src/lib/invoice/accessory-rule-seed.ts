import type {
  InvoiceAccessoryRule,
  InvoiceAccessoryRuleType,
  StyleRef,
} from '@/lib/types'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceAccessoryRuleInput } from '@/lib/supabase/invoice-accessory-rules'

export type InvoiceAccessorySeedDraft = {
  ruleType: InvoiceAccessoryRuleType
  pattern: string
  accessoryKind?: string
  namePrefix?: string
  colorName?: string
  styleNo?: string
  note?: string
}

/**
 * 612행 실측에서 뽑은 권장 사전. DB에 넣지 않고 화면에서 확인한 뒤 등록한다.
 */
export const INVOICE_ACCESSORY_SEED_DRAFTS: InvoiceAccessorySeedDraft[] = [
  { ruleType: 'label', pattern: 'tassel', accessoryKind: '태슬', namePrefix: '태슬 - ', note: 'Tassel·Tassle·Tassel 1' },
  { ruleType: 'label', pattern: 'tassle', accessoryKind: '태슬', namePrefix: '태슬 - ' },
  { ruleType: 'label', pattern: '태슬', accessoryKind: '태슬', namePrefix: '태슬 - ' },
  { ruleType: 'label', pattern: 'shoulder strap', accessoryKind: '숄더스트랩', namePrefix: '숄더스트랩 - ' },
  { ruleType: 'label', pattern: '숄더 스트랩', accessoryKind: '숄더스트랩', namePrefix: '숄더스트랩 - ' },
  { ruleType: 'label', pattern: '숄더스트랩', accessoryKind: '숄더스트랩', namePrefix: '숄더스트랩 - ' },
  { ruleType: 'label', pattern: '컬러스트랩', accessoryKind: '컬러스트랩', namePrefix: '컬러스트랩 ' },
  { ruleType: 'label', pattern: 'color strap', accessoryKind: '컬러스트랩', namePrefix: '컬러스트랩 ' },

  { ruleType: 'color', pattern: 'black', colorName: '블랙' },
  { ruleType: 'color', pattern: 'red', colorName: '레드' },
  { ruleType: 'color', pattern: 'gray', colorName: '그레이' },
  { ruleType: 'color', pattern: 'grey', colorName: '그레이' },
  { ruleType: 'color', pattern: 'navy', colorName: '네이비' },
  { ruleType: 'color', pattern: 'khaki', colorName: '카키' },
  { ruleType: 'color', pattern: 'purple', colorName: '퍼플' },
  { ruleType: 'color', pattern: 'brown', colorName: '브라운' },
  { ruleType: 'color', pattern: 'hot pink', colorName: '핫핑크' },
  { ruleType: 'color', pattern: 'white', colorName: '화이트' },
  { ruleType: 'color', pattern: 'orange', colorName: '오렌지' },
  { ruleType: 'color', pattern: 'pink', colorName: '핑크' },
  { ruleType: 'color', pattern: 'yellow', colorName: '옐로우' },
  { ruleType: 'color', pattern: 'ocean blue', colorName: '오션블루' },
  { ruleType: 'color', pattern: 'smoke blue', colorName: '스모크블루' },
  { ruleType: 'color', pattern: 'blue', colorName: '블루' },
  { ruleType: 'color', pattern: 'light brown', colorName: '라이트브라운' },
  { ruleType: 'color', pattern: 'cotton black', colorName: '코튼블랙' },
  { ruleType: 'color', pattern: 'cotton beige', colorName: '코튼베이지' },
  { ruleType: 'color', pattern: 'scarlet', colorName: '스칼렛' },
  { ruleType: 'color', pattern: 'green', colorName: '그린' },
  { ruleType: 'color', pattern: 'neon green', colorName: '네온그린' },
  { ruleType: 'color', pattern: 'heart strap', colorName: '하트스트랩' },
  { ruleType: 'color', pattern: 'beige', colorName: '베이지' },
  { ruleType: 'color', pattern: '블랙', colorName: '블랙' },
  { ruleType: 'color', pattern: '레드', colorName: '레드' },
  { ruleType: 'color', pattern: '그레이', colorName: '그레이' },
  { ruleType: 'color', pattern: '네이비', colorName: '네이비' },
  { ruleType: 'color', pattern: '화이트', colorName: '화이트' },

  { ruleType: 'default', pattern: '컬러스트랩', accessoryKind: '컬러스트랩', namePrefix: '컬러스트랩 ', note: '라벨 없는 색상 나열' },
  { ruleType: 'default', pattern: 'pouch', accessoryKind: '태슬', namePrefix: '태슬 - ' },
  { ruleType: 'default', pattern: '파우치', accessoryKind: '태슬', namePrefix: '태슬 - ' },
  { ruleType: 'default', pattern: 'cross bag', accessoryKind: '숄더스트랩', namePrefix: '숄더스트랩 - ' },
  { ruleType: 'default', pattern: 'bobu bag', accessoryKind: '숄더스트랩', namePrefix: '숄더스트랩 - ' },
  { ruleType: 'default', pattern: '크로스백', accessoryKind: '숄더스트랩', namePrefix: '숄더스트랩 - ' },
  { ruleType: 'default', pattern: '보부백', accessoryKind: '숄더스트랩', namePrefix: '숄더스트랩 - ' },
  { ruleType: 'default', pattern: '스트랩 커스텀', accessoryKind: '숄더스트랩', namePrefix: '숄더스트랩 - ' },
  { ruleType: 'default', pattern: 'tassel 모음', accessoryKind: '태슬', namePrefix: '태슬 - ' },
  { ruleType: 'default', pattern: '태슬 모음', accessoryKind: '태슬', namePrefix: '태슬 - ' },

  { ruleType: 'token', pattern: 'pearl ribbon keyring', styleNo: 'M0998', note: '진주리본키링' },
  { ruleType: 'token', pattern: 'pearl ribbon', styleNo: 'M0998' },
  { ruleType: 'token', pattern: '진주 리본 키링', styleNo: 'M0998' },
  { ruleType: 'token', pattern: '진주리본키링', styleNo: 'M0998' },
  { ruleType: 'token', pattern: 'bb keyring', styleNo: 'M0997' },
  { ruleType: 'token', pattern: 'b.b.keyring', styleNo: 'M0997' },
  { ruleType: 'token', pattern: 'bb키링', styleNo: 'M0997' },
  { ruleType: 'token', pattern: 'tiny drop heart keyring', styleNo: 'M0732' },
  { ruleType: 'token', pattern: '하트 미러 참 키링 블랙', styleNo: 'M0318' },
  { ruleType: 'token', pattern: 'heart mirror keyring black', styleNo: 'M0318' },
  { ruleType: 'token', pattern: 'heart mirror keyring butter yellow', styleNo: 'M0319' },
  { ruleType: 'token', pattern: '레드 키링', styleNo: 'M0983', note: '쇼핑몰이 태슬을 키링이라고 부름' },
  { ruleType: 'token', pattern: '블랙 키링', styleNo: 'M0982' },
  { ruleType: 'token', pattern: '핑크 키링', styleNo: 'M0992' },

  { ruleType: 'ignore', pattern: '파우치 선택' },
  { ruleType: 'ignore', pattern: 'strap pouch' },
  { ruleType: 'ignore', pattern: 'canvas tote bag' },
]

export function accessorySeedKey(draft: Pick<InvoiceAccessorySeedDraft, 'ruleType' | 'pattern'>) {
  return `${draft.ruleType}\u0000${normalizeInvoiceText(draft.pattern)}`
}

export function missingAccessorySeeds(
  drafts: InvoiceAccessorySeedDraft[],
  existing: InvoiceAccessoryRule[],
) {
  const have = new Set(
    existing.map((rule) => `${rule.ruleType}\u0000${rule.normalizedPattern}`),
  )
  return drafts.filter((draft) => !have.has(accessorySeedKey(draft)))
}

export function accessoryRulesFromSeeds(
  drafts: InvoiceAccessorySeedDraft[],
  styles: StyleRef[],
): InvoiceAccessoryRule[] {
  const byNo = new Map(
    styles.map((style) => [style.styleNo.trim().toLocaleLowerCase('ko-KR'), style]),
  )
  const now = '2026-08-19T00:00:00.000Z'
  return drafts.flatMap((draft, index) => {
    const targetStyle = draft.styleNo
      ? byNo.get(draft.styleNo.trim().toLocaleLowerCase('ko-KR')) ?? null
      : null
    if (draft.ruleType === 'token' && !targetStyle) return []
    return [
      {
        id: `seed-${index}`,
        brandId: 'brand',
        ruleType: draft.ruleType,
        pattern: draft.pattern,
        normalizedPattern: normalizeInvoiceText(draft.pattern),
        accessoryKind: draft.accessoryKind ?? '',
        namePrefix: draft.namePrefix ?? '',
        colorName: draft.colorName ?? '',
        targetStyle,
        isActive: true,
        note: draft.note ?? '',
        createdAt: now,
        updatedAt: now,
      },
    ]
  })
}

export function toAccessorySeedInput(
  draft: InvoiceAccessorySeedDraft,
  styleIdByNo: Map<string, string>,
): InvoiceAccessoryRuleInput | { error: string } {
  if (draft.ruleType === 'token') {
    const styleId = draft.styleNo
      ? styleIdByNo.get(draft.styleNo.trim().toLocaleLowerCase('ko-KR'))
      : undefined
    if (!styleId) {
      return { error: `${draft.pattern}: M번호 ${draft.styleNo ?? ''}를 찾지 못했습니다.` }
    }
    return {
      ruleType: 'token',
      pattern: draft.pattern,
      targetStyleId: styleId,
      note: draft.note,
    }
  }
  return {
    ruleType: draft.ruleType,
    pattern: draft.pattern,
    accessoryKind: draft.accessoryKind,
    namePrefix: draft.namePrefix,
    colorName: draft.colorName,
    note: draft.note,
  }
}
