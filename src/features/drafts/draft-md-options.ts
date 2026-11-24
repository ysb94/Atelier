import { createContext } from 'react'

export const DRAFT_MD_OPTION_LABELS = {
  register: '등록유형',
  open: '오픈유형',
  option: '옵션유무',
}

export type DraftMdOptionField = keyof typeof DRAFT_MD_OPTION_LABELS
export type DraftMdOption = { id: string; label: string }
export type DraftMdOptionLists = Record<DraftMdOptionField, DraftMdOption[]>

export const DEFAULT_DRAFT_MD_OPTIONS: DraftMdOptionLists = {
  register: [{ id: 'register-single', label: '단품 등록' }, { id: 'register-collection', label: '모음전 + 단품' }],
  open: [{ id: 'open-general', label: '일반발매' }, { id: 'open-early', label: '선발매' }, { id: 'open-exclusive', label: '단독발매' }],
  option: [
    { id: 'option-none', label: '옵션없음' },
    { id: 'option-surcharge', label: '옵션 추가금 O' },
    { id: 'option-included', label: '옵션 추가금 X' },
  ],
}

export function initialDraftMdOptionId(field: DraftMdOptionField, value: string) {
  const comparison = value.replace(/\s+/g, '')
  return DEFAULT_DRAFT_MD_OPTIONS[field].find(option => option.label.replace(/\s+/g, '') === comparison)?.id ?? ''
}

export const DraftMdOptionsContext = createContext<{
  lists: DraftMdOptionLists
  update: (field: DraftMdOptionField, options: DraftMdOption[]) => void
} | null>(null)
