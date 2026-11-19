import type { WarehouseOrganizationOutboundItem } from '@/lib/supabase/warehouse-organization-outbound'
import { parseRoomListPaste } from './room-list-paste'

const MAX_ROWS = 10_000
const MAX_QUANTITY = 2_147_483_647

export function previousWarehouseOutboundMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find(part => part.type === 'year')?.value)
  const month = Number(parts.find(part => part.type === 'month')?.value)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

export function isWarehouseOutboundMonth(value: string) {
  return /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(value)
}

export function warehouseOutboundMonthDays(month: string): number | null {
  if (!isWarehouseOutboundMonth(month)) return null
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
}

export function parseWarehouseOrganizationOutbound(text: string):
  { items: WarehouseOrganizationOutboundItem[] } | { error: string } {
  const items: WarehouseOrganizationOutboundItem[] = []
  const rows = parseRoomListPaste(text)
  let firstDataRow = true
  for (const [index, row] of rows.entries()) {
    if (row.every(cell => !cell.trim())) continue
    const [productName = '', quantityText = ''] = row.map(cell => cell.trim())
    if (firstDataRow && row.length === 2 && /^(상품명|제품명)$/.test(productName) &&
      /^(출고\s*수량|수량)$/.test(quantityText)) {
      firstDataRow = false
      continue
    }
    firstDataRow = false
    if (row.length !== 2 || !productName || [...productName].length > 240) {
      return { error: `${index + 1}번째 행에 상품명(240자 이하)과 출고 수량 두 열을 입력해 주세요.` }
    }
    const quantity = Number(quantityText.replaceAll(',', ''))
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(quantityText) || quantity > MAX_QUANTITY) {
      return { error: `${index + 1}번째 행에 0 이상 2,147,483,647 이하의 정수 수량을 입력해 주세요.` }
    }
    items.push({ productName, quantity })
    if (items.length > MAX_ROWS) return { error: '한 달에 최대 10,000행을 저장할 수 있습니다.' }
  }
  return items.length ? { items } : { error: '상품명과 출고 수량 두 열을 붙여넣어 주세요.' }
}
