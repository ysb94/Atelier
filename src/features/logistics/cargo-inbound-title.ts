import { formatNumber } from '@/lib/utils'

/** 선적일 2026-09-01, 83박스 → "260901 선적 83박스 건" */
export function formatCargoInboundTitle(shippedAt: string, boxCount: number) {
  const compact = shippedAt.replaceAll('-', '')
  const stamp = /^\d{8}$/.test(compact) ? compact.slice(2) : '미정'
  return `${stamp} 선적 ${formatNumber(boxCount)}박스 건`
}
