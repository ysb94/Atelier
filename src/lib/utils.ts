import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('ko-KR').format(value)
}

const EMPTY_LIST: readonly never[] = []

/**
 * `query.data ?? []` 대신 쓴다. 매 렌더 새 배열을 만들면 이를 의존하는
 * useMemo 가 매번 다시 계산되고, useEffect 안의 setState 와 만나면 렌더 루프가 된다.
 * 반환값은 공유 참조이므로 push·splice 등으로 고치지 않는다.
 */
export function emptyList<T>(): T[] {
  return EMPTY_LIST as unknown as T[]
}
