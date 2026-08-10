import { normalizeHeader } from './fields'

/**
 * 엑셀 왕복 편집용 예약 열.
 * 내보낸 파일을 고쳐 다시 올릴 때 행을 식별하고 삭제를 지시한다.
 */
export const ROW_ID_HEADER = '_id'
export const ROW_ACTION_HEADER = '_작업'

export type RowAction = 'upsert' | 'delete'

const ID_ALIASES = ['_id', 'id', '상품id', 'styleid']
const ACTION_ALIASES = ['_작업', '작업', '_action', 'action', '처리']

const DELETE_WORDS = ['삭제', 'delete', 'del', 'remove', 'x', 'd']
const UPSERT_WORDS = ['수정', '유지', '갱신', 'upsert', 'update', 'keep', 'u']

function matchesAlias(header: string, aliases: string[]) {
  const normalized = normalizeHeader(header)
  if (!normalized) return false
  return aliases.some((alias) => normalizeHeader(alias) === normalized)
}

export function isRowIdHeader(header: string) {
  return matchesAlias(header, ID_ALIASES)
}

export function isRowActionHeader(header: string) {
  return matchesAlias(header, ACTION_ALIASES)
}

/** 빈 값은 수정으로 본다. 알 수 없는 값은 null을 돌려 행을 오류로 만든다. */
export function parseRowAction(value: string): RowAction | null {
  const v = value.trim().toLowerCase()
  if (!v) return 'upsert'
  if (DELETE_WORDS.includes(v)) return 'delete'
  if (UPSERT_WORDS.includes(v)) return 'upsert'
  return null
}
