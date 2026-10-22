import assert from 'node:assert/strict'
import {
  blockedShipmentProducts,
  giftEventsValidToday,
} from './invoice-work-briefing.ts'
import type { InvoiceDiscontinuedStyle, InvoiceGiftRequest, InvoicePreorderHold } from '../types.ts'

const now = '2026-10-20 11:00'
const request = (patch: Partial<InvoiceGiftRequest>): InvoiceGiftRequest => ({
  id: 'gift',
  brandId: 'brand',
  title: '행사',
  taskNo: '',
  mallName: '자사몰',
  normalizedMallName: '자사몰',
  startsAt: '2026-10-20 00:00',
  endsAt: '2026-10-20 23:59',
  countBasis: 'per_order',
  mergeBasis: 'per_order',
  usesFirstCome: false,
  firstComeLimitMode: 'per_style',
  firstComeTotalLimit: null,
  firstComeUsedCount: 0,
  hasAllocationHistory: false,
  isActive: true,
  note: '',
  items: [],
  quotas: [],
  createdAt: '',
  updatedAt: '',
  ...patch,
})

const events = giftEventsValidToday(
  [
    request({ id: 'running', title: '진행' }),
    request({ id: 'later', title: '오후', startsAt: '2026-10-20 18:00' }),
    request({ id: 'ended-today', title: '오전끝', endsAt: '2026-10-20 10:00' }),
    request({ id: 'tomorrow', title: '내일', startsAt: '2026-10-21 00:00', endsAt: '2026-10-21 23:59' }),
    request({ id: 'paused', title: '중지', isActive: false }),
    request({
      id: 'with-gift',
      title: '사은품',
      startsAt: '2026-10-01 00:00',
      items: [{
        id: 'item',
        requestId: 'with-gift',
        productName: '본품',
        normalizedProductName: '본품',
        prefix: '',
        isRandom: false,
        outgoingProducts: [
          { styleId: 's1', styleNo: 'M100', name: '파우치' },
          { styleId: 's1', styleNo: 'M100', name: '파우치' },
        ],
      }],
    }),
  ],
  now,
)
assert.deepEqual(events.map((event) => event.id), ['with-gift', 'running', 'later'])
assert.equal(events.find((event) => event.id === 'later')?.phase, 'later-today')
assert.equal(events.find((event) => event.id === 'running')?.phase, 'running')
assert.deepEqual(events.find((event) => event.id === 'with-gift')?.gifts, [
  { id: 'item', productName: '본품', giftNames: ['파우치'] },
])

const hold = (patch: Partial<InvoicePreorderHold>): InvoicePreorderHold => ({
  id: 'hold',
  brandId: 'brand',
  styleId: 'style',
  styleNo: 'M1',
  name: '상품',
  startedOn: '2026-10-01',
  shipOn: '2026-10-25',
  reason: '입고 대기',
  status: 'active',
  endedOn: null,
  endedReason: '',
  clearedAt: null,
  extensions: [],
  createdAt: '',
  updatedAt: '',
  ...patch,
})
const discontinued = (patch: Partial<InvoiceDiscontinuedStyle>): InvoiceDiscontinuedStyle => ({
  id: 'disc',
  brandId: 'brand',
  styleId: 'style-d',
  styleNo: 'M9',
  name: '단종상품',
  note: '',
  createdAt: '',
  updatedAt: '',
  ...patch,
})

const blocked = blockedShipmentProducts(
  [
    hold({ id: 'reserve', styleId: 'style-r', styleNo: 'M2' }),
    hold({ id: 'ended', styleId: 'style-e', styleNo: 'M3', status: 'ended' }),
    hold({ id: 'both', styleId: 'style-d', styleNo: 'M9', reason: '예발인데 단종' }),
  ],
  [discontinued({ styleId: 'style-d', styleNo: 'M9' })],
)
assert.deepEqual(blocked.map((item) => [item.styleNo, item.reason]), [
  ['M9', 'discontinued'],
  ['M2', 'reservation'],
])
assert.match(blocked[1]?.detail ?? '', /2026-10-25/)

console.log('invoice-work-briefing.verify ok')
