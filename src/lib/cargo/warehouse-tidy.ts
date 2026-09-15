import { UNLOAD_STACK_BOX_LIMIT } from './inbound'

export type WarehouseTidyShippedOnInput = {
  shippedAt: string
  boxSum: number
  partIndex: number
  partCount: number
  limit?: number
}

function isValidUtcYmd(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function formatYymmdd(date: Date) {
  const yy = String(date.getUTCFullYear()).slice(-2)
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

/** YYYY-MM-DD를 UTC 기준으로 일수만큼 옮긴 뒤 yymmdd로 돌려준다. */
export function shiftShippedOnStamp(shippedAt: string, dayOffset: number) {
  const match = shippedAt.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isValidUtcYmd(year, month, day)) return ''
  return formatYymmdd(new Date(Date.UTC(year, month - 1, day + dayOffset)))
}

/**
 * 창고정리용 선적일.
 * 갈라진 마지막 행은 하루 뒤, 합이 한도인 행은 하루 앞, 나머지는 그대로.
 */
export function resolveWarehouseTidyShippedOn({
  shippedAt,
  boxSum,
  partIndex,
  partCount,
  limit = UNLOAD_STACK_BOX_LIMIT,
}: WarehouseTidyShippedOnInput) {
  const isLastSplitPart = partCount > 1 && partIndex === partCount - 1
  if (isLastSplitPart) return shiftShippedOnStamp(shippedAt, 1)
  if (boxSum === limit) return shiftShippedOnStamp(shippedAt, -1)
  return shiftShippedOnStamp(shippedAt, 0)
}
