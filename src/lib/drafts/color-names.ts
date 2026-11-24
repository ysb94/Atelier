import type { DraftColorNames } from '@/lib/types'

export function normalizeDraftColorNames(names?: Partial<DraftColorNames>): DraftColorNames {
  return {
    nameEn: typeof names?.nameEn === 'string' ? names.nameEn.trim() : '',
    nameKo: typeof names?.nameKo === 'string' ? names.nameKo.trim() : '',
  }
}

/** A saved single name (or an edit made with the old editor) fills its language slot. */
export function draftColorNames(name: string, saved?: DraftColorNames): DraftColorNames {
  const names = normalizeDraftColorNames(saved)
  const value = name.trim()
  if (!value || value === names.nameEn || value === names.nameKo) return names
  return /\p{Script=Hangul}/u.test(value) ? { ...names, nameKo: value } : { ...names, nameEn: value }
}
