import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoiceWorkPipelineInput } from '@/lib/invoice/invoice-work-pipeline'
import type {
  InvoiceGiftRequest,
  InvoiceItemNameRule,
  InvoiceProductNameExclusion,
  InvoiceProductNameMap,
  InvoiceWorkInstruction,
  StyleRef,
} from '@/lib/types'

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

const coat = style('style-coat', 'M1001', '울 코트')
const bag = style('style-bag', 'M1002', '토트백')
const pouch = style('style-pouch', 'M2001', '파우치 블랙')
const charm = style('style-charm', 'M2002', '키링')
const giftBox = style('style-box', 'M3001', '선물박스')

function row(
  rowNumber: number,
  patch: Partial<SabangnetOrderRow> = {},
): SabangnetOrderRow {
  return {
    rowNumber,
    productName: '울 코트',
    itemName: '블랙 / M',
    quantity: '1',
    recipientName: `수령인${rowNumber}`,
    recipientPhone: `0100000${String(rowNumber).padStart(4, '0')}`,
    recipientOtherPhone: '',
    shippingType: '선불',
    recipientAddress: `서울 가상주소 ${rowNumber}`,
    shippingMessage: '',
    customerOrderNo: `ORD-${String(rowNumber).padStart(5, '0')}`,
    mallName: '테스트몰',
    orderedAt: '2026-08-28 10:00',
    ownProductCode: '',
    ...patch,
  }
}

function productMap(
  id: string,
  productName: string,
  target: StyleRef,
  lookupKey = productName,
): InvoiceProductNameMap {
  return {
    id,
    brandId: 'brand-1',
    mallName: '',
    normalizedMallName: '',
    productName,
    normalizedProductName: normalizeInvoiceText(productName),
    itemNameContext: '',
    normalizedItemNameContext: '',
    ownProductCode: '',
    normalizedOwnProductCode: '',
    lookupKey,
    normalizedLookupKey: normalizeInvoiceText(lookupKey),
    style: target,
    isActive: true,
    note: '',
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
  }
}

function exclusion(
  id: string,
  productName: string,
  itemName: string,
): InvoiceProductNameExclusion {
  return {
    id,
    brandId: 'brand-1',
    mallName: '테스트몰',
    normalizedMallName: normalizeInvoiceText('테스트몰'),
    productName,
    normalizedProductName: normalizeInvoiceText(productName),
    itemName,
    normalizedItemName: normalizeInvoiceText(itemName),
    isActive: true,
    note: '',
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
  }
}

function itemRule(
  id: string,
  itemName: string,
  action: InvoiceItemNameRule['action'],
  components: InvoiceItemNameRule['components'] = [],
): InvoiceItemNameRule {
  return {
    id,
    brandId: 'brand-1',
    scope: 'global',
    itemName,
    normalizedItemName: normalizeInvoiceText(itemName),
    productLookupKey: '',
    normalizedProductLookupKey: '',
    mainStyle: null,
    action,
    isActive: true,
    note: '',
    components,
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
  }
}

function instruction(): InvoiceWorkInstruction {
  return {
    id: 'inst-1',
    brandId: 'brand-1',
    title: '선물포장',
    labelText: '[선물]',
    isActive: true,
    note: '',
    startsAt: null,
    endsAt: null,
    matchMode: 'exact',
    countBasis: 'per_shipment',
    outgoingProducts: [giftBox],
    items: [
      {
        id: 'inst-item-1',
        instructionId: 'inst-1',
        productName: '토트백',
        normalizedProductName: normalizeInvoiceText('토트백'),
      },
    ],
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
  }
}

function giftRequest(): InvoiceGiftRequest {
  return {
    id: 'gift-1',
    brandId: 'brand-1',
    title: '코트 사은품',
    taskNo: 'G1',
    mallName: '테스트몰',
    normalizedMallName: normalizeInvoiceText('테스트몰'),
    startsAt: '2026-08-01 00:00',
    endsAt: '2026-08-31 23:59',
    countBasis: 'per_order',
    mergeBasis: 'per_shipment',
    usesFirstCome: false,
    firstComeLimitMode: 'per_style',
    firstComeTotalLimit: null,
    firstComeUsedCount: 0,
    hasAllocationHistory: false,
    isActive: true,
    note: '',
    items: [
      {
        id: 'gift-item-1',
        requestId: 'gift-1',
        productName: '울 코트',
        normalizedProductName: normalizeInvoiceText('울 코트'),
        prefix: '',
        outgoingProducts: [pouch],
        isRandom: false,
      },
    ],
    quotas: [],
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:00Z',
  }
}

export const INVOICE_WORK_FIXTURE_STYLES = [coat, bag, pouch, charm, giftBox]

export function buildInvoiceWorkFixtureRows(count: number): SabangnetOrderRow[] {
  const rows: SabangnetOrderRow[] = []
  for (let index = 0; index < count; index += 1) {
    const rowNumber = index + 2
    const kind = index % 6
    if (kind === 0) {
      rows.push(row(rowNumber))
      continue
    }
    if (kind === 1) {
      rows.push(
        row(rowNumber, {
          productName: '토트백',
          itemName: '키링',
        }),
      )
      continue
    }
    if (kind === 2) {
      rows.push(
        row(rowNumber, {
          productName: '미등록 상품',
          itemName: '옵션없음',
        }),
      )
      continue
    }
    if (kind === 3) {
      rows.push(
        row(rowNumber, {
          productName: '제외 상품',
          itemName: '제외옵션',
        }),
      )
      continue
    }
    if (kind === 4) {
      rows.push(
        row(rowNumber, {
          productName: '[사은품] 파우치',
          itemName: '',
        }),
      )
      continue
    }
    rows.push(
      row(rowNumber, {
        productName: '울 코트',
        itemName: '블랙 / L',
        quantity: '2',
      }),
    )
  }
  return rows
}

export function buildInvoiceWorkFixtureInput(
  rowCount: number,
): InvoiceWorkPipelineInput {
  return {
    rows: buildInvoiceWorkFixtureRows(rowCount),
    styles: INVOICE_WORK_FIXTURE_STYLES,
    productNameMaps: [
      productMap('map-coat', '울 코트', coat),
      productMap('map-bag', '토트백', bag),
    ],
    productNameExclusions: [exclusion('ex-1', '제외 상품', '제외옵션')],
    productNameTagRoles: [],
    optionMaps: [],
    itemNameRules: [
      itemRule('rule-delete', '블랙 / M', 'delete'),
      itemRule('rule-charm', '키링', 'components', [
        {
          id: 'comp-1',
          ruleId: 'rule-charm',
          style: charm,
          role: 'included',
          quantity: 1,
          sortOrder: 0,
        },
      ]),
    ],
    accessoryRules: [],
    workInstructions: [instruction()],
    giftRequests: [giftRequest()],
    giftAllocations: [],
    giftSourceMaps: [],
    giftSourceAllocations: [],
    giftSeed: 1,
  }
}

export const INVOICE_WORK_SMALL_ROW_COUNT = 24
export const INVOICE_WORK_LARGE_ROW_COUNT = 40_000
