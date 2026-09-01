import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Download,
  FileText,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { parseFile } from '@/lib/import/parse'
import {
  getActiveWarehouseInventorySet,
  getCodeUsageTargets,
  getProductCodes,
  getStylesByBrand,
  getWarehouseStockPositions,
} from '@/lib/api'
import {
  partnerBarcodeHeader,
  readPartnerCodeFields,
  readPartnerCodeRows,
  type PartnerCodeField,
} from '@/features/codes/PartnerCodeListPanel'
import { normalizeStyleNo } from '@/lib/import/transform'
import {
  allocateBulkOutboundProductListWarehouse,
  UNSPECIFIED_LOCATION_ZONE,
} from '@/lib/invoice/product-list-warehouse'
import type { InvoiceProductListEntry } from '@/lib/invoice/product-list-summary'
import type {
  CodeUsageTarget,
  ProductCodeComponent,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { BulkOutboundProductListPrint } from '@/features/logistics/BulkOutboundProductListPrint'
import { applyBulkOutboundBackupToOperations } from '@/lib/outbound/product-outbound'

/** 한 건이 여러 날 걸쳐 있을 수 있는 상태. 순서가 강제되지 않는다. */
type JobStatus =
  | 'draft'
  | 'converting'
  | 'backup'
  | 'picking'
  | 'docs'
  | 'done'

type JobPanel =
  | 'upload'
  | 'convert'
  | 'products'
  | 'backup'
  | 'adjust'
  | 'docs'
  | 'done'

type DemoEvidenceFile = {
  id: string
  name: string
  sizeLabel: string
  attachedOn: string
}

/** 대량출고 건이 참조하는 바코드 데이터 출처 */
type BarcodeSource = 'own' | 'partner'

type BulkOutboundPartnerConfig = {
  partnerId: string
  partnerName: string
  barcodeSource: BarcodeSource
}

type DemoExcelRow = {
  id: string
  /** template field id → 값 */
  values: Record<string, string>
}

type DemoJob = {
  id: string
  partnerId: string
  partnerName: string
  barcodeSource: BarcodeSource
  title: string
  /** 데모용 담당자. 실서비스에서는 로그인 사용자와 연결. */
  assignee: string
  status: JobStatus
  startedOn: string
  /** 예상 종료일 (YYYY-MM-DD) */
  dueOn: string
  updatedOn: string
  plannedQty: number
  note: string
  /** 업체 발주서 생파일. 파싱하지 않고 증거로만 보관. */
  evidenceFiles: DemoEvidenceFile[]
  /** 우리 양식으로 올린 작업 엑셀 행 */
  excelRows: DemoExcelRow[]
  excelFileName: string | null
}

const BARCODE_SOURCE_LABEL: Record<BarcodeSource, string> = {
  own: '88바코드',
  partner: '거래처 바코드',
}

/** 목록 기본은 내 건. 다른 업체·다른 담당자 건은 숨긴다. */
const DEMO_ME = '나'
const DEMO_ASSIGNEES = [DEMO_ME, '김물류', '이피킹'] as const

type AssigneeFilter = 'mine' | 'all' | string

const STATUS_LABEL: Record<JobStatus, string> = {
  draft: '작성 중',
  converting: '상품 변환',
  backup: '임시 백업',
  picking: '피킹·조율',
  docs: '서류·포장',
  done: '확정',
}

const STATUS_BADGE: Record<
  JobStatus,
  'muted' | 'outline' | 'warning' | 'success'
> = {
  draft: 'muted',
  converting: 'outline',
  backup: 'warning',
  picking: 'warning',
  docs: 'outline',
  done: 'success',
}

const PANELS: { value: JobPanel; label: string }[] = [
  { value: 'upload', label: '엑셀' },
  { value: 'convert', label: '상품연결' },
  { value: 'products', label: '상품 리스트' },
  { value: 'backup', label: '임시 백업' },
  { value: 'adjust', label: '현장 조율' },
  { value: 'docs', label: '서류·라벨' },
  { value: 'done', label: '확정' },
]

/** 진행 흐름. 실제로는 건너뛰거나 되돌아갈 수 있다. */
const FLOW_STEPS: {
  panel: JobPanel
  label: string
  hint: string
}[] = [
  { panel: 'upload', label: '엑셀', hint: '양식 등록' },
  { panel: 'convert', label: '상품연결', hint: '바코드 매칭' },
  { panel: 'products', label: '상품 리스트', hint: '피킹 목록' },
  { panel: 'backup', label: '임시 백업', hint: '가재고' },
  { panel: 'adjust', label: '현장 조율', hint: '피킹·수정' },
  { panel: 'docs', label: '서류·라벨', hint: '출력' },
  { panel: 'done', label: '확정', hint: '마감' },
]

type FlowStepState = 'done' | 'current' | 'todo'

function flowStepState(status: JobStatus, stepIndex: number): FlowStepState {
  const currentIndex = FLOW_STEPS.findIndex((step) => {
    if (status === 'draft') return step.panel === 'upload'
    if (status === 'converting') return step.panel === 'convert'
    if (status === 'backup') return step.panel === 'backup'
    if (status === 'picking') return step.panel === 'adjust'
    if (status === 'docs') return step.panel === 'docs'
    if (status === 'done') return step.panel === 'done'
    return false
  })
  const index = currentIndex < 0 ? 0 : currentIndex
  if (status === 'done') return 'done'
  if (stepIndex < index) return 'done'
  if (stepIndex === index) return 'current'
  return 'todo'
}

function BulkOutboundFlowStrip({
  status,
  productListReady,
  onSelect,
}: {
  status: JobStatus
  productListReady: boolean
  onSelect: (panel: JobPanel) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
      <ol className="flex min-w-[40rem] items-start justify-between gap-1">
        {FLOW_STEPS.map((step, index) => {
          const state = flowStepState(status, index)
          const nextState =
            index < FLOW_STEPS.length - 1
              ? flowStepState(status, index + 1)
              : null
          const connectorDone =
            state === 'done' &&
            (nextState === 'done' || nextState === 'current')
          const locked = step.panel === 'products' && !productListReady
          return (
            <li
              key={step.panel}
              className="relative flex min-w-0 flex-1 flex-col items-center"
            >
              {index < FLOW_STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[calc(50%+0.85rem)] right-[calc(-50%+0.85rem)] top-3 h-px',
                    connectorDone ? 'bg-foreground/40' : 'bg-border',
                  )}
                />
              ) : null}
              <button
                type="button"
                disabled={locked}
                title={
                  locked
                    ? '상품연결에서 미매칭이 없어야 열 수 있습니다.'
                    : step.hint
                }
                onClick={() => {
                  if (locked) return
                  onSelect(step.panel)
                }}
                aria-current={state === 'current' ? 'step' : undefined}
                className={cn(
                  'relative z-[1] flex w-full flex-col items-center gap-1 rounded-md px-0.5 py-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  locked && 'cursor-not-allowed opacity-40',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors',
                    state === 'done' &&
                      'border-foreground bg-foreground text-background',
                    state === 'current' &&
                      'border-foreground bg-background text-foreground ring-4 ring-foreground/10',
                    state === 'todo' &&
                      'border-border bg-background text-muted-foreground',
                  )}
                >
                  {state === 'done' ? (
                    <Check className="size-3" strokeWidth={2.5} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    'max-w-[5.75rem] text-[11px] leading-tight',
                    state === 'current'
                      ? 'font-semibold text-foreground'
                      : state === 'done'
                        ? 'font-medium text-foreground/80'
                        : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {state === 'current' ? (
                  <span className="text-[10px] leading-none text-muted-foreground">
                    {step.hint}
                  </span>
                ) : (
                  <span className="h-2.5" aria-hidden />
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const DOC_SLOTS = [
  { id: 'outer', label: '박스 겉면 라벨' },
  { id: 'box_list', label: '박스별 내용지' },
  { id: 'full_list', label: '전체 리스트' },
  { id: 'report', label: '업체 보고서' },
  { id: 'ir_label', label: '아이라벨' },
] as const

const DEFAULT_TEMPLATE_HEADERS = [
  '자체품번코드',
  '상품명',
  '수량',
  '받는분성명',
  '받는분전화번호',
  '받는분주소',
  '배송메시지',
  '비고',
] as const

type TemplateField = {
  id: string
  label: string
  order: number
}

function templateFieldsKey(
  brandId: string,
  partnerId: string,
  barcodeSource: BarcodeSource,
) {
  return `atelier:bulk-outbound-template:${brandId}:${partnerId}:${barcodeSource}`
}

function defaultTemplateFields(): TemplateField[] {
  return DEFAULT_TEMPLATE_HEADERS.map((label, order) => ({
    id: `default-${order}`,
    label,
    order,
  }))
}

function readTemplateFields(
  brandId: string,
  partnerId: string,
  barcodeSource: BarcodeSource,
): TemplateField[] {
  try {
    const raw = localStorage.getItem(
      templateFieldsKey(brandId, partnerId, barcodeSource),
    )
    if (!raw) return defaultTemplateFields()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return defaultTemplateFields()
    }
    return parsed
      .filter(
        (item): item is TemplateField =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as TemplateField).id === 'string' &&
          typeof (item as TemplateField).label === 'string',
      )
      .map((item, index) => ({
        id: item.id,
        label: item.label,
        order: typeof item.order === 'number' ? item.order : index,
      }))
      .sort((left, right) => left.order - right.order)
  } catch {
    return defaultTemplateFields()
  }
}

function writeTemplateFields(
  brandId: string,
  partnerId: string,
  barcodeSource: BarcodeSource,
  fields: TemplateField[],
) {
  localStorage.setItem(
    templateFieldsKey(brandId, partnerId, barcodeSource),
    JSON.stringify(fields),
  )
}

async function downloadBulkOutboundTemplate(
  partnerName: string,
  fields: TemplateField[],
) {
  const XLSX = await import('xlsx')
  const headers = fields.map((field) => field.label)
  const example = fields.map((field) => {
    if (field.label.includes('품번') || field.label.includes('코드')) {
      return 'M0000'
    }
    if (field.label.includes('상품')) return '예시 상품'
    if (field.label.includes('수량')) return '1'
    if (field.label.includes('성명') || field.label.includes('이름')) {
      return '홍길동'
    }
    if (field.label.includes('전화')) return '010-0000-0000'
    if (field.label.includes('주소')) return '서울시 예시구'
    return ''
  })
  const sheet = XLSX.utils.aoa_to_sheet([headers, example])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '대량출고')
  const safeName = partnerName.replace(/[\\/:*?"<>|]+/g, '_').trim() || '업체'
  XLSX.writeFile(workbook, `대량출고_등록양식_${safeName}.xlsx`)
}

/** 엑셀/양식 헤더 비교용. 공백·제로폭·대소문자 차이를 없앤다. */
function normalizeBulkHeader(value: string) {
  return value
    .normalize('NFC')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\s_\-/().]/g, '')
    .toLocaleLowerCase('ko-KR')
    .trim()
}

function scoreHeaderRow(headerRow: string[], fields: TemplateField[]) {
  const keys = new Set(
    headerRow.map(normalizeBulkHeader).filter(Boolean),
  )
  return fields.reduce(
    (score, field) =>
      keys.has(normalizeBulkHeader(field.label)) ? score + 1 : score,
    0,
  )
}

/**
 * 여러 시트·앞쪽 행 중 양식 헤더와 가장 많이 맞는 곳을 고른다.
 * (쿠팡 발주서처럼 hiddenSheet가 있거나 헤더 위 안내행이 있을 수 있음)
 */
function pickBulkOutboundSheet(
  sheets: { name: string; rows: string[][] }[],
  fields: TemplateField[],
): { sheetName: string; headerRowIndex: number; rows: string[][] } | null {
  let best: {
    sheetName: string
    headerRowIndex: number
    rows: string[][]
    score: number
  } | null = null

  for (const sheet of sheets) {
    const scanLimit = Math.min(15, sheet.rows.length)
    for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
      const headerRow = sheet.rows[rowIndex] ?? []
      const score = scoreHeaderRow(headerRow, fields)
      if (score === 0) continue
      if (!best || score > best.score) {
        best = {
          sheetName: sheet.name,
          headerRowIndex: rowIndex,
          rows: sheet.rows,
          score,
        }
      }
      if (score === fields.length) return best
    }
  }

  return best
}

/**
 * 헤더 이름으로만 매칭. 열 위치는 무시하고, 양식에 없는 열은 버린다.
 */
function parseBulkOutboundExcelRows(options: {
  rows: string[][]
  headerRowIndex?: number
  fields: TemplateField[]
}): {
  excelRows: DemoExcelRow[]
  ignoredHeaders: string[]
  error: string | null
} {
  const { rows, fields, headerRowIndex = 0 } = options
  if (rows.length === 0) {
    return {
      excelRows: [],
      ignoredHeaders: [],
      error: '파일에서 데이터를 읽지 못했습니다.',
    }
  }
  const headerRow = rows[headerRowIndex]
  if (!headerRow?.length) {
    return { excelRows: [], ignoredHeaders: [], error: '헤더 행이 없습니다.' }
  }

  const headers = headerRow.map((cell) => cell.trim())
  const indexByKey = new Map<string, number>()
  for (const [index, header] of headers.entries()) {
    const key = normalizeBulkHeader(header)
    if (!key) continue
    if (!indexByKey.has(key)) indexByKey.set(key, index)
  }

  const missing = fields
    .map((field) => field.label.trim())
    .filter((label) => !indexByKey.has(normalizeBulkHeader(label)))
  if (missing.length > 0) {
    const found = headers.filter(Boolean).slice(0, 12).join(', ')
    return {
      excelRows: [],
      ignoredHeaders: [],
      error: `양식 헤더가 없습니다: ${missing.join(', ')}${
        found ? ` (파일에서 찾은 헤더: ${found}${headers.filter(Boolean).length > 12 ? '…' : ''})` : ''
      }`,
    }
  }

  const knownKeys = new Set(
    fields.map((field) => normalizeBulkHeader(field.label)),
  )
  const ignoredHeaders = [
    ...new Set(
      headers.filter((header) => {
        const key = normalizeBulkHeader(header)
        return Boolean(key) && !knownKeys.has(key)
      }),
    ),
  ]

  const excelRows: DemoExcelRow[] = []
  const dataRows = rows.slice(headerRowIndex + 1)
  for (const [rowIndex, cells] of dataRows.entries()) {
    if (cells.every((cell) => !cell.trim())) continue
    const values: Record<string, string> = {}
    for (const field of fields) {
      const index = indexByKey.get(normalizeBulkHeader(field.label))!
      values[field.id] = (cells[index] ?? '').trim()
    }
    if (Object.values(values).every((value) => !value)) continue
    excelRows.push({
      id: `excel-${headerRowIndex + rowIndex + 2}`,
      values,
    })
  }

  if (excelRows.length === 0) {
    return {
      excelRows: [],
      ignoredHeaders,
      error: '데이터 행이 없습니다.',
    }
  }

  return { excelRows, ignoredHeaders, error: null }
}

function findTemplateField(
  fields: TemplateField[],
  candidates: string[],
): TemplateField | null {
  const exact = new Set(candidates.map(normalizeBulkHeader))
  const byExact = fields.find((field) =>
    exact.has(normalizeBulkHeader(field.label)),
  )
  if (byExact) return byExact
  return (
    fields.find((field) => {
      const key = normalizeBulkHeader(field.label)
      return candidates.some((candidate) =>
        key.includes(normalizeBulkHeader(candidate)),
      )
    }) ?? null
  )
}

function normalizeMatchCode(value: string) {
  return value.normalize('NFC').replace(/\s+/g, '').toLowerCase()
}

function formatComponentsLabel(components: ProductCodeComponent[]) {
  if (components.length === 0) return null
  return components
    .map((item) => `${item.styleNo}${item.qty > 1 ? `×${item.qty}` : ''}`)
    .join(', ')
}

type ConvertMatchHit = {
  components: ProductCodeComponent[]
  /** 거래처/자사 코드에 연결된 추가 필드 id → 값 */
  values: Record<string, string>
  /** 88바코드 코드명 등 */
  name?: string
}

type ConvertMatchRow = {
  id: string
  barcode: string
  productName: string
  orderQty: string
  status: 'matched' | 'unmatched' | 'empty' | 'no-components'
  components: ProductCodeComponent[]
  linkedValues: Record<string, string>
  linkedName: string
}

function buildConvertMatchRows(options: {
  excelRows: DemoExcelRow[]
  fields: TemplateField[]
  linkedFields: PartnerCodeField[]
  codeByBarcode: Map<string, ConvertMatchHit>
}): {
  rows: ConvertMatchRow[]
  barcodeField: TemplateField | null
  linkedFields: PartnerCodeField[]
  matchedCount: number
  unmatchedCount: number
  emptyCount: number
  noComponentsCount: number
} {
  const barcodeField = findTemplateField(options.fields, [
    '상품바코드',
    '바코드',
  ])
  const nameField = findTemplateField(options.fields, [
    '상품이름',
    '상품명',
    '품명',
  ])
  const qtyField = findTemplateField(options.fields, [
    '발주수량',
    '수량',
    '확정수량',
  ])

  if (!barcodeField) {
    return {
      rows: [],
      barcodeField: null,
      linkedFields: options.linkedFields,
      matchedCount: 0,
      unmatchedCount: 0,
      emptyCount: 0,
      noComponentsCount: 0,
    }
  }

  let matchedCount = 0
  let unmatchedCount = 0
  let emptyCount = 0
  let noComponentsCount = 0

  const emptyRow = (
    row: DemoExcelRow,
    barcode: string,
    productName: string,
    orderQty: string,
    status: ConvertMatchRow['status'],
  ): ConvertMatchRow => ({
    id: row.id,
    barcode,
    productName,
    orderQty,
    status,
    components: [],
    linkedValues: {},
    linkedName: '',
  })

  const rows: ConvertMatchRow[] = options.excelRows.map((row) => {
    const barcode = (row.values[barcodeField.id] ?? '').trim()
    const productName = nameField
      ? (row.values[nameField.id] ?? '').trim()
      : ''
    const orderQty = qtyField ? (row.values[qtyField.id] ?? '').trim() : ''

    if (!barcode) {
      emptyCount += 1
      return emptyRow(row, barcode, productName, orderQty, 'empty')
    }

    const hit = options.codeByBarcode.get(normalizeMatchCode(barcode))
    if (!hit) {
      unmatchedCount += 1
      return emptyRow(row, barcode, productName, orderQty, 'unmatched')
    }

    const linkedValues: Record<string, string> = {}
    for (const field of options.linkedFields) {
      linkedValues[field.id] = (hit.values[field.id] ?? '').trim()
    }

    if (hit.components.length === 0) {
      noComponentsCount += 1
      return {
        id: row.id,
        barcode,
        productName,
        orderQty,
        status: 'no-components',
        components: [],
        linkedValues,
        linkedName: hit.name?.trim() ?? '',
      }
    }

    matchedCount += 1
    return {
      id: row.id,
      barcode,
      productName,
      orderQty,
      status: 'matched',
      components: hit.components,
      linkedValues,
      linkedName: hit.name?.trim() ?? '',
    }
  })

  return {
    rows,
    barcodeField,
    linkedFields: options.linkedFields,
    matchedCount,
    unmatchedCount,
    emptyCount,
    noComponentsCount,
  }
}

function parseOrderQty(value: string) {
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 연결된 구성 × 발주수량 → M번호별 합산 목록 */
function buildBulkProductListEntries(
  rows: ConvertMatchRow[],
  styleNameByNo: Map<string, string>,
): InvoiceProductListEntry[] {
  const merged = new Map<string, InvoiceProductListEntry>()
  for (const row of rows) {
    if (row.status !== 'matched') continue
    const orderQty = parseOrderQty(row.orderQty)
    if (orderQty <= 0) continue
    for (const component of row.components) {
      const styleNo = normalizeStyleNo(component.styleNo)
      if (!styleNo || component.qty <= 0) continue
      const quantity = orderQty * component.qty
      const existing = merged.get(styleNo)
      if (existing) {
        existing.quantity += quantity
        continue
      }
      merged.set(styleNo, {
        styleNo,
        styleName: styleNameByNo.get(styleNo) ?? '',
        quantity,
      })
    }
  }
  return [...merged.values()]
}

function TemplateHeaderDialog({
  partnerName,
  fields,
  onClose,
  onSave,
}: {
  partnerName: string
  fields: TemplateField[]
  onClose: () => void
  onSave: (fields: TemplateField[]) => void
}) {
  const [draft, setDraft] = useState(() =>
    fields.map((field, index) => ({ ...field, order: index })),
  )
  const [newLabel, setNewLabel] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  function addField() {
    const label = newLabel.trim()
    if (!label) {
      setError('헤더 이름을 입력하세요.')
      return
    }
    if (draft.some((field) => field.label === label)) {
      setError('같은 이름의 헤더가 이미 있습니다.')
      return
    }
    setDraft((current) => [
      ...current,
      {
        id: `field-${Date.now()}`,
        label,
        order: current.length,
      },
    ])
    setNewLabel('')
    setError(null)
  }

  function move(id: string, direction: 'up' | 'down') {
    setDraft((current) => {
      const index = current.findIndex((field) => field.id === id)
      if (index < 0) return current
      const swapWith = direction === 'up' ? index - 1 : index + 1
      if (swapWith < 0 || swapWith >= current.length) return current
      const next = [...current]
      const temp = next[index]!
      next[index] = next[swapWith]!
      next[swapWith] = temp
      return next.map((field, order) => ({ ...field, order }))
    })
  }

  function saveEdit(id: string) {
    const label = editLabel.trim()
    if (!label) {
      setError('헤더 이름을 입력하세요.')
      return
    }
    if (draft.some((field) => field.id !== id && field.label === label)) {
      setError('같은 이름의 헤더가 이미 있습니다.')
      return
    }
    setDraft((current) =>
      current.map((field) =>
        field.id === id ? { ...field, label } : field,
      ),
    )
    setEditingId(null)
    setError(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[min(80vh,40rem)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">엑셀 양식 헤더</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {partnerName} 작업용 양식입니다. 열을 추가·이름 변경·순서 변경·삭제할
            수 있습니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-3">
          {draft.map((field, index) => {
            const editing = editingId === field.id
            return (
              <div
                key={field.id}
                className="rounded-lg border border-border px-3 py-2"
              >
                {editing ? (
                  <div className="space-y-2">
                    <Input
                      value={editLabel}
                      onChange={(event) => setEditLabel(event.target.value)}
                      placeholder="헤더 이름"
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        취소
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => saveEdit(field.id)}
                      >
                        저장
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {field.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {index + 1}열
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => move(field.id, 'up')}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={index === draft.length - 1}
                      onClick={() => move(field.id, 'down')}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(field.id)
                        setEditLabel(field.label)
                        setError(null)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft((current) =>
                          current
                            .filter((item) => item.id !== field.id)
                            .map((item, order) => ({ ...item, order })),
                        )
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            )
          })}

          <div className="space-y-2 rounded-lg border border-dashed border-border px-3 py-3">
            <p className="text-xs font-medium text-muted-foreground">열 추가</p>
            <Input
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="예: 박스번호"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addField()
                }
              }}
            />
            <Button type="button" size="sm" variant="outline" onClick={addField}>
              <Plus className="size-3.5" />
              추가
            </Button>
          </div>

          {error ? <p className="px-1 text-xs text-danger">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setDraft(defaultTemplateFields())}
          >
            기본값으로
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={draft.length === 0}
            onClick={() => {
              if (draft.length === 0) {
                setError('헤더를 하나 이상 두세요.')
                return
              }
              onSave(draft.map((field, order) => ({ ...field, order })))
              onClose()
            }}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 대량출고에 등록한 업체·바코드 출처 */
function storageKey(brandId: string) {
  return `atelier:bulk-outbound-partners:${brandId}`
}

/** 출고업체별 바코드 화면에 켠 업체 id */
function usageCodeEnabledIdsKey(brandId: string) {
  return `atelier:usage-codes-target-ids:${brandId}`
}

/** 거래처 코드 화면에 켠 업체 id */
function partnerCodeEnabledIdsKey(brandId: string) {
  return `atelier:partner-codes-target-ids:${brandId}`
}

function readUsageCodeEnabledIds(brandId: string): string[] | null {
  try {
    const raw = localStorage.getItem(usageCodeEnabledIdsKey(brandId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return null
  }
}

function readPartnerCodeEnabledIds(brandId: string): string[] | null {
  try {
    const raw = localStorage.getItem(partnerCodeEnabledIdsKey(brandId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return null
  }
}

function readBulkPartnerConfigs(brandId: string): BulkOutboundPartnerConfig[] {
  try {
    const raw = localStorage.getItem(storageKey(brandId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is BulkOutboundPartnerConfig =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as BulkOutboundPartnerConfig).partnerId === 'string' &&
          typeof (item as BulkOutboundPartnerConfig).partnerName === 'string' &&
          ((item as BulkOutboundPartnerConfig).barcodeSource === 'own' ||
            (item as BulkOutboundPartnerConfig).barcodeSource === 'partner'),
      )
  } catch {
    return []
  }
}

function writeBulkPartnerConfigs(
  brandId: string,
  configs: BulkOutboundPartnerConfig[],
) {
  localStorage.setItem(storageKey(brandId), JSON.stringify(configs))
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 로컬 날짜 기준 남은 일수. 음수면 지남. */
function daysUntilDue(dueOn: string, today = todayIso()) {
  const due = new Date(`${dueOn}T12:00:00`)
  const now = new Date(`${today}T12:00:00`)
  return Math.round((due.getTime() - now.getTime()) / 86_400_000)
}

function dueRemainLabel(days: number) {
  if (days < 0) return `${Math.abs(days)}일 지남`
  if (days === 0) return '오늘 마감'
  return `${days}일 남음`
}

/** 남은 일수 — 중요해서 채도 높은 칩으로 표시 */
function dueRemainClass(days: number) {
  if (days < 0) return 'bg-red-600 text-white shadow-sm shadow-red-600/30'
  if (days === 0) return 'bg-orange-500 text-white shadow-sm shadow-orange-500/30'
  if (days <= 2) return 'bg-amber-400 text-amber-950 shadow-sm shadow-amber-400/40'
  if (days <= 5) return 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
  return 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
}

function DueRemainChip({ dueOn, className }: { dueOn: string; className?: string }) {
  const days = daysUntilDue(dueOn)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-tight',
        dueRemainClass(days),
        className,
      )}
    >
      {dueRemainLabel(days)}
    </span>
  )
}

function demoJobsFor(partners: CodeUsageTarget[]): DemoJob[] {
  const a = partners[0]
  const b = partners[1] ?? partners[0]
  const c = partners[2] ?? partners[0]
  if (!a || !b) return []
  const today = todayIso()
  // 같은 업체(b)에 하루 차이 건이 동시에 열림 — 실제 쿠팡식 패턴
  return [
    {
      id: 'job-b-1002',
      partnerId: b.id,
      partnerName: b.name,
      barcodeSource: 'partner',
      title: '10월 2일 건',
      assignee: DEMO_ME,
      status: 'picking',
      startedOn: '2026-10-02',
      dueOn: addDaysIso(today, 0),
      updatedOn: '2026-10-04',
      plannedQty: 180,
      note: '피킹 이틀째. 3·4일 건과 같이 열려 있음.',
      evidenceFiles: [
        {
          id: 'ev-1',
          name: '쿠팡_발주서_1002.xlsx',
          sizeLabel: '248 KB',
          attachedOn: '2026-10-02',
        },
      ],
      excelRows: [],
      excelFileName: null,
    },
    {
      id: 'job-b-1003',
      partnerId: b.id,
      partnerName: b.name,
      barcodeSource: 'partner',
      title: '10월 3일 건',
      assignee: DEMO_ME,
      status: 'backup',
      startedOn: '2026-10-03',
      dueOn: addDaysIso(today, 2),
      updatedOn: '2026-10-03',
      plannedQty: 95,
      note: '가재고만 잡은 상태. 2일 건과 병행.',
      evidenceFiles: [
        {
          id: 'ev-2',
          name: '쿠팡_발주_1003.pdf',
          sizeLabel: '1.2 MB',
          attachedOn: '2026-10-03',
        },
      ],
      excelRows: [],
      excelFileName: null,
    },
    {
      id: 'job-b-1004',
      partnerId: b.id,
      partnerName: b.name,
      barcodeSource: 'partner',
      title: '10월 4일 건',
      assignee: DEMO_ME,
      status: 'converting',
      startedOn: '2026-10-04',
      dueOn: addDaysIso(today, 5),
      updatedOn: '2026-10-04',
      plannedQty: 110,
      note: '오늘 들어온 건. 상품 변환부터.',
      evidenceFiles: [],
      excelRows: [],
      excelFileName: null,
    },
    {
      id: 'job-a-1',
      partnerId: a.id,
      partnerName: a.name,
      barcodeSource: 'own',
      title: '9월 1차',
      assignee: '김물류',
      status: 'picking',
      startedOn: '2026-08-28',
      dueOn: addDaysIso(today, -1),
      updatedOn: '2026-09-01',
      plannedQty: 420,
      note: '다른 담당자 건. 내 건 필터에선 안 보임.',
      evidenceFiles: [],
      excelRows: [],
      excelFileName: null,
    },
    {
      id: 'job-c-1',
      partnerId: (c ?? a).id,
      partnerName: (c ?? a).name,
      barcodeSource: 'own',
      title: '긴급 추가',
      assignee: '이피킹',
      status: 'converting',
      startedOn: '2026-09-01',
      dueOn: addDaysIso(today, 8),
      updatedOn: '2026-09-01',
      plannedQty: 24,
      note: '다른 담당자 건.',
      evidenceFiles: [],
      excelRows: [],
      excelFileName: null,
    },
  ]
}

function groupJobsByPartner(jobs: DemoJob[]) {
  const order: string[] = []
  const map = new Map<string, DemoJob[]>()
  for (const job of jobs) {
    const list = map.get(job.partnerId)
    if (list) {
      list.push(job)
    } else {
      order.push(job.partnerId)
      map.set(job.partnerId, [job])
    }
  }
  return order.map((partnerId) => {
    const items = map.get(partnerId)!
    return {
      partnerId,
      partnerName: items[0]!.partnerName,
      jobs: items.sort((left, right) =>
        left.startedOn.localeCompare(right.startedOn),
      ),
    }
  })
}

function PartnerSettingsDialog({
  brandSlug,
  partners,
  ownPartnerIds,
  partnerCodePartnerIds,
  initialConfigs,
  onClose,
  onSave,
}: {
  brandSlug: string
  partners: CodeUsageTarget[]
  /** 출고업체별 바코드(자사)에 바코드가 1건이라도 있는 업체 */
  ownPartnerIds: Set<string>
  /** 거래처 코드에 켜 둔 업체 */
  partnerCodePartnerIds: Set<string>
  initialConfigs: BulkOutboundPartnerConfig[]
  onClose: () => void
  onSave: (configs: BulkOutboundPartnerConfig[]) => void
}) {
  const [configs, setConfigs] = useState(() => [...initialConfigs])
  const [adding, setAdding] = useState(false)
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? '')
  const [barcodeSource, setBarcodeSource] = useState<BarcodeSource | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedPartner =
    partners.find((item) => item.id === partnerId) ?? null

  const registryReady =
    barcodeSource === 'own'
      ? selectedPartner
        ? ownPartnerIds.has(selectedPartner.id)
        : false
      : barcodeSource === 'partner'
        ? selectedPartner
          ? partnerCodePartnerIds.has(selectedPartner.id)
          : false
        : false

  const registryEmptyMessage =
    barcodeSource === 'own'
      ? '출고업체별 바코드에 이 업체가 등록되어 있지 않습니다.'
      : barcodeSource === 'partner'
        ? '거래처 코드에 이 업체가 등록되어 있지 않습니다.'
        : null

  function resetAddForm() {
    setAdding(false)
    setBarcodeSource(null)
    setError(null)
    setPartnerId(partners[0]?.id ?? '')
  }

  function handleAdd() {
    if (!selectedPartner || !barcodeSource) return
    if (!registryReady) {
      setError(registryEmptyMessage)
      return
    }
    if (
      configs.some(
        (item) =>
          item.partnerId === selectedPartner.id &&
          item.barcodeSource === barcodeSource,
      )
    ) {
      setError('이미 같은 업체·바코드 출처로 등록되어 있습니다.')
      return
    }
    setConfigs((current) => [
      ...current,
      {
        partnerId: selectedPartner.id,
        partnerName: selectedPartner.name,
        barcodeSource,
      },
    ])
    resetAddForm()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[min(80vh,40rem)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">대량출고 업체 설정</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            한 업체씩 등록합니다. 업체를 고른 뒤 자사·거래처 바코드를 선택하면,
            해당 메뉴에 등록된 경우에만 추가됩니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
          {configs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              아직 등록한 업체가 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {configs.map((item) => (
                <li
                  key={`${item.partnerId}:${item.barcodeSource}`}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.partnerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {BARCODE_SOURCE_LABEL[item.barcodeSource]}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setConfigs((current) =>
                        current.filter(
                          (row) =>
                            !(
                              row.partnerId === item.partnerId &&
                              row.barcodeSource === item.barcodeSource
                            ),
                        ),
                      )
                    }
                  >
                    삭제
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {adding ? (
            <div className="space-y-3 rounded-lg border border-border px-3 py-3">
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">1. 업체</span>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                  value={partnerId}
                  onChange={(event) => {
                    setPartnerId(event.target.value)
                    setBarcodeSource(null)
                    setError(null)
                  }}
                >
                  {partners.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">2. 바코드 출처</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['own', '88바코드'],
                      ['partner', '거래처 바코드'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={barcodeSource === value}
                      onClick={() => {
                        setBarcodeSource(value)
                        setError(null)
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                        barcodeSource === value
                          ? 'border-primary/40 bg-primary/10 font-medium'
                          : 'border-border hover:bg-muted/40',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {barcodeSource && selectedPartner ? (
                registryReady ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                    {selectedPartner.name} ·{' '}
                    {BARCODE_SOURCE_LABEL[barcodeSource]} 데이터로
                    자동 선택되었습니다.
                  </div>
                ) : (
                  <div className="space-y-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                    <p>등록된 업체가 없습니다.</p>
                    <p>{registryEmptyMessage}</p>
                    <Link
                      to={`/b/${brandSlug}/${barcodeSource === 'own' ? 'usage-codes' : 'partner-codes'}`}
                      className="inline-flex font-medium underline underline-offset-2"
                    >
                      {barcodeSource === 'own'
                        ? '출고업체별 바코드로 이동'
                        : '거래처 코드로 이동'}
                    </Link>
                  </div>
                )
              ) : null}

              {error ? <p className="text-xs text-danger">{error}</p> : null}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={resetAddForm}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!selectedPartner || !barcodeSource || !registryReady}
                  onClick={handleAdd}
                >
                  추가
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={partners.length === 0}
              onClick={() => setAdding(true)}
            >
              <Plus className="size-3.5" />
              업체 추가
            </Button>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onSave(configs)
              onClose()
            }}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}

function NewJobDialog({
  configs,
  onClose,
  onCreate,
}: {
  configs: BulkOutboundPartnerConfig[]
  onClose: () => void
  onCreate: (
    config: BulkOutboundPartnerConfig,
    title: string,
    dueOn: string,
  ) => void
}) {
  const [configKey, setConfigKey] = useState(
    configs[0]
      ? `${configs[0].partnerId}:${configs[0].barcodeSource}`
      : '',
  )
  const [title, setTitle] = useState('')
  const [dueOn, setDueOn] = useState(() => addDaysIso(todayIso(), 3))
  const config =
    configs.find(
      (item) => `${item.partnerId}:${item.barcodeSource}` === configKey,
    ) ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold">새 대량출고 건</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          기존 건이 며칠째 진행 중이어도 새 건을 동시에 만들 수 있습니다.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">업체 · 바코드</span>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={configKey}
              onChange={(event) => setConfigKey(event.target.value)}
            >
              {configs.map((item) => (
                <option
                  key={`${item.partnerId}:${item.barcodeSource}`}
                  value={`${item.partnerId}:${item.barcodeSource}`}
                >
                  {item.partnerName} · {BARCODE_SOURCE_LABEL[item.barcodeSource]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">작업 이름</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              placeholder="예: 9월 2차"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">예상 종료일</span>
            <input
              type="date"
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={dueOn}
              min={todayIso()}
              onChange={(event) => setDueOn(event.target.value)}
            />
            <span className="block text-xs text-muted-foreground">
              목록에서 남은 일수로 강조 표시됩니다.
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!config || !dueOn}
            onClick={() => {
              if (!config || !dueOn) return
              onCreate(config, title.trim() || '새 작업', dueOn)
              onClose()
            }}
          >
            만들기
          </Button>
        </div>
      </div>
    </div>
  )
}

export function BulkOutboundPage() {
  const { brand } = useBrand()
  const [partnerConfigs, setPartnerConfigs] = useState<
    BulkOutboundPartnerConfig[]
  >(() => readBulkPartnerConfigs(brand.id))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [jobs, setJobs] = useState<DemoJob[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [panel, setPanel] = useState<JobPanel>('upload')
  const [downloading, setDownloading] = useState(false)
  const [seeded, setSeeded] = useState(false)
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('mine')
  const [templateHeaderOpen, setTemplateHeaderOpen] = useState(false)
  const [templateFields, setTemplateFields] = useState<TemplateField[]>(() =>
    defaultTemplateFields(),
  )
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const [backupApplyNote, setBackupApplyNote] = useState<string | null>(null)
  const [backupSearch, setBackupSearch] = useState('')
  /** M번호 → 수정일(YYYY-MM-DD) → 수량 */
  const [backupQtyOverrides, setBackupQtyOverrides] = useState<
    Record<string, Record<string, number>>
  >({})
  const [backupEditingStyleNo, setBackupEditingStyleNo] = useState<
    string | null
  >(null)
  const [backupEditDraft, setBackupEditDraft] = useState('')

  useEffect(() => {
    setPartnerConfigs(readBulkPartnerConfigs(brand.id))
    setJobs([])
    setActiveJobId(null)
    setPanel('upload')
    setSeeded(false)
    setAssigneeFilter('mine')
    setTemplateHeaderOpen(false)
    setTemplateFields(defaultTemplateFields())
    setUploadError(null)
    setUploadNote(null)
    setBackupApplyNote(null)
    setBackupSearch('')
    setBackupQtyOverrides({})
    setBackupEditingStyleNo(null)
    setBackupEditDraft('')
  }, [brand.id])

  const partnersQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })

  const allPartners = useMemo(
    () =>
      (partnersQuery.data ?? [])
        .filter((item) => item.active && !item.isOneTime)
        .sort(
          (left, right) =>
            left.order - right.order ||
            left.name.localeCompare(right.name, 'ko'),
        ),
    [partnersQuery.data],
  )

  const ownPartnerIds = useMemo(() => {
    const ids = readUsageCodeEnabledIds(brand.id)
    return new Set(ids ?? [])
  }, [brand.id, settingsOpen])

  const partnerCodePartnerIds = useMemo(() => {
    const ids = readPartnerCodeEnabledIds(brand.id)
    return new Set(ids ?? [])
  }, [brand.id, settingsOpen])

  const visibleConfigs = useMemo(() => {
    const partnerById = new Map(allPartners.map((item) => [item.id, item]))
    return partnerConfigs
      .filter((item) => partnerById.has(item.partnerId))
      .map((item) => ({
        ...item,
        partnerName: partnerById.get(item.partnerId)!.name,
      }))
  }, [allPartners, partnerConfigs])

  useEffect(() => {
    if (seeded || allPartners.length === 0) return
    setJobs(demoJobsFor(allPartners))
    setSeeded(true)
  }, [allPartners, seeded])

  const activeJob = jobs.find((job) => job.id === activeJobId) ?? null

  useEffect(() => {
    if (!activeJob) {
      setTemplateFields(defaultTemplateFields())
      setTemplateHeaderOpen(false)
      return
    }
    setTemplateFields(
      readTemplateFields(
        brand.id,
        activeJob.partnerId,
        activeJob.barcodeSource,
      ),
    )
    setTemplateHeaderOpen(false)
    setUploadError(null)
    setUploadNote(null)
  }, [brand.id, activeJob?.id, activeJob?.partnerId, activeJob?.barcodeSource])

  async function handleUploadExcel(file: File) {
    if (!activeJob) return
    setUploadError(null)
    setUploadNote(null)
    try {
      const sheets = await parseFile(file)
      if (sheets.length === 0) {
        setUploadError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      const picked = pickBulkOutboundSheet(sheets, templateFields)
      if (!picked) {
        setUploadError(
          '양식 헤더와 맞는 시트를 찾지 못했습니다. 첫 행에 헤더가 있는지 확인하세요.',
        )
        return
      }
      const parsed = parseBulkOutboundExcelRows({
        rows: picked.rows,
        headerRowIndex: picked.headerRowIndex,
        fields: templateFields,
      })
      if (parsed.error) {
        setUploadError(parsed.error)
        return
      }
      const today = todayIso()
      setJobs((current) =>
        current.map((job) =>
          job.id === activeJob.id
            ? {
                ...job,
                excelRows: parsed.excelRows,
                excelFileName: file.name,
                plannedQty: parsed.excelRows.length,
                updatedOn: today,
                status: job.status === 'draft' ? 'converting' : job.status,
              }
            : job,
        ),
      )
      const sheetHint =
        sheets.length > 1 || picked.headerRowIndex > 0
          ? ` · ${picked.sheetName}${picked.headerRowIndex > 0 ? ` ${picked.headerRowIndex + 1}행` : ''}`
          : ''
      setUploadNote(
        parsed.ignoredHeaders.length > 0
          ? `${formatNumber(parsed.excelRows.length)}행 반영${sheetHint} · 무시된 열: ${parsed.ignoredHeaders.join(', ')}`
          : `${formatNumber(parsed.excelRows.length)}행 반영${sheetHint}`,
      )
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    }
  }

  const openJobs = useMemo(() => {
    const open = jobs.filter((job) => job.status !== 'done')
    if (assigneeFilter === 'all') return open
    if (assigneeFilter === 'mine') {
      return open.filter((job) => job.assignee === DEMO_ME)
    }
    return open.filter((job) => job.assignee === assigneeFilter)
  }, [jobs, assigneeFilter])
  const partnerGroups = useMemo(
    () => groupJobsByPartner(openJobs),
    [openJobs],
  )

  const ownCodesQuery = useQuery({
    queryKey: ['productCodes', brand.id, 'own', 'bulk-outbound-convert'],
    queryFn: () => getProductCodes(brand.id, 'own'),
    enabled: activeJob?.barcodeSource === 'own',
  })

  const convertMatch = useMemo(() => {
    if (!activeJob) {
      return buildConvertMatchRows({
        excelRows: [],
        fields: templateFields,
        linkedFields: [],
        codeByBarcode: new Map(),
      })
    }

    const codeByBarcode = new Map<string, ConvertMatchHit>()
    let linkedFields: PartnerCodeField[] = []

    if (activeJob.barcodeSource === 'partner') {
      linkedFields = readPartnerCodeFields(brand.id, activeJob.partnerId)
      for (const row of readPartnerCodeRows(brand.id, activeJob.partnerId)) {
        const key = normalizeMatchCode(row.code)
        if (!key || codeByBarcode.has(key)) continue
        codeByBarcode.set(key, {
          components: row.components,
          values: row.values,
        })
      }
    } else {
      linkedFields = [
        { id: '_own_name', label: '코드명', type: 'text', order: 0 },
        { id: '_own_weight', label: '무게(g)', type: 'number', order: 1 },
        { id: '_own_size', label: '규격(cm)', type: 'text', order: 2 },
        { id: '_own_note', label: '비고', type: 'text', order: 3 },
      ]
      for (const code of ownCodesQuery.data ?? []) {
        const key = normalizeMatchCode(code.code)
        if (!key || codeByBarcode.has(key)) continue
        const size =
          code.widthCm != null || code.depthCm != null || code.heightCm != null
            ? `${code.widthCm ?? '—'}×${code.depthCm ?? '—'}×${code.heightCm ?? '—'}`
            : ''
        codeByBarcode.set(key, {
          components: code.components,
          name: code.name,
          values: {
            _own_name: code.name,
            _own_weight:
              code.weightG != null ? String(code.weightG) : '',
            _own_size: size,
            _own_note: code.note,
            ...code.values,
          },
        })
      }
    }

    return buildConvertMatchRows({
      excelRows: activeJob.excelRows,
      fields: templateFields,
      linkedFields,
      codeByBarcode,
    })
  }, [
    activeJob,
    brand.id,
    templateFields,
    ownCodesQuery.data,
    panel,
  ])

  const partnerCodeHeaderLabel = activeJob
    ? partnerBarcodeHeader(activeJob.partnerName)
    : '거래처 바코드'

  const productListReady = Boolean(
    activeJob &&
      activeJob.excelRows.length > 0 &&
      convertMatch.barcodeField &&
      convertMatch.unmatchedCount === 0 &&
      convertMatch.emptyCount === 0,
  )

  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'bulk-outbound-products'],
    queryFn: () => getStylesByBrand(brand.id),
    enabled: Boolean(activeJob) && (panel === 'products' || productListReady),
  })

  const warehouseSetQuery = useQuery({
    queryKey: ['warehouse-inventory-set', brand.id, 'bulk-outbound'],
    queryFn: () => getActiveWarehouseInventorySet(brand.id),
    enabled: Boolean(activeJob) && (panel === 'products' || productListReady),
  })

  const warehousePositionsQuery = useQuery({
    queryKey: [
      'warehouse-stock-positions',
      brand.id,
      warehouseSetQuery.data?.id,
      'bulk-outbound',
    ],
    queryFn: () =>
      getWarehouseStockPositions(brand.id, warehouseSetQuery.data!.id),
    enabled: Boolean(warehouseSetQuery.data?.id),
  })

  const productListAllocation = useMemo(() => {
    const styleNameByNo = new Map<string, string>()
    for (const style of stylesQuery.data ?? []) {
      const styleNo = normalizeStyleNo(style.styleNo)
      if (!styleNo) continue
      styleNameByNo.set(styleNo, style.name)
    }
    const entries = buildBulkProductListEntries(
      convertMatch.rows,
      styleNameByNo,
    )
    return allocateBulkOutboundProductListWarehouse({
      entries,
      positions: warehousePositionsQuery.data ?? [],
      zone: 'box_storage',
    })
  }, [
    convertMatch.rows,
    stylesQuery.data,
    warehousePositionsQuery.data,
  ])

  /** 임시 백업용: M번호 중복 제거 · 발주수량 합산 */
  const backupHoldEntries = useMemo(() => {
    const merged = new Map<
      string,
      { styleNo: string; styleName: string; quantity: number }
    >()
    for (const line of productListAllocation.lines) {
      const styleNo = normalizeStyleNo(line.styleNo)
      if (!styleNo || line.quantity <= 0) continue
      const existing = merged.get(styleNo)
      if (existing) {
        existing.quantity += line.quantity
        if (!existing.styleName && line.styleName) {
          existing.styleName = line.styleName
        }
        continue
      }
      merged.set(styleNo, {
        styleNo,
        styleName: line.styleName,
        quantity: line.quantity,
      })
    }
    return [...merged.values()].sort((left, right) =>
      left.styleNo.localeCompare(right.styleNo, 'ko-KR'),
    )
  }, [productListAllocation.lines])

  const backupEditDates = useMemo(() => {
    const dates = new Set<string>()
    for (const byDate of Object.values(backupQtyOverrides)) {
      for (const date of Object.keys(byDate)) dates.add(date)
    }
    return [...dates].sort()
  }, [backupQtyOverrides])

  function backupEffectiveQuantity(styleNo: string, original: number) {
    const byDate = backupQtyOverrides[styleNo]
    if (!byDate) return original
    const dates = Object.keys(byDate).sort()
    const latest = dates[dates.length - 1]
    if (!latest) return original
    return byDate[latest] ?? original
  }

  const backupHoldRows = useMemo(() => {
    const query = backupSearch.trim().toLowerCase()
    const rows = backupHoldEntries.map((row) => ({
      ...row,
      effectiveQuantity: backupEffectiveQuantity(row.styleNo, row.quantity),
    }))
    if (!query) return rows
    return rows.filter(
      (row) =>
        row.styleNo.toLowerCase().includes(query) ||
        row.styleName.toLowerCase().includes(query),
    )
  }, [backupHoldEntries, backupQtyOverrides, backupSearch])

  const backupHoldTotal = useMemo(
    () =>
      backupHoldEntries.reduce(
        (sum, row) =>
          sum + backupEffectiveQuantity(row.styleNo, row.quantity),
        0,
      ),
    [backupHoldEntries, backupQtyOverrides],
  )

  function todayIsoDateLocal() {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function formatBackupEditDateHeader(isoDate: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
    if (!match) return isoDate
    return `${Number(match[2])}/${Number(match[3])}`
  }

  function startBackupQtyEdit(styleNo: string, currentQty: number) {
    setBackupEditingStyleNo(styleNo)
    setBackupEditDraft(String(currentQty))
  }

  function commitBackupQtyEdit(styleNo: string, originalQty: number) {
    const cleaned = backupEditDraft.replace(/,/g, '').trim()
    const next = Number(cleaned)
    setBackupEditingStyleNo(null)
    setBackupEditDraft('')
    if (!Number.isFinite(next) || next < 0) return
    const rounded = Math.round(next)
    if (rounded === originalQty) {
      setBackupQtyOverrides((current) => {
        const next = { ...current }
        delete next[styleNo]
        return next
      })
      return
    }
    const today = todayIsoDateLocal()
    setBackupQtyOverrides((current) => ({
      ...current,
      [styleNo]: {
        ...(current[styleNo] ?? {}),
        [today]: rounded,
      },
    }))
  }

  function applyBackupToOperations() {
    if (!activeJob || backupHoldEntries.length === 0) return
    const styleIdByNo = new Map<string, string>()
    for (const style of stylesQuery.data ?? []) {
      const styleNo = normalizeStyleNo(style.styleNo)
      if (!styleNo) continue
      styleIdByNo.set(styleNo, style.id)
    }
    applyBulkOutboundBackupToOperations({
      brandId: brand.id,
      jobId: activeJob.id,
      partnerId: activeJob.partnerId,
      partnerName: activeJob.partnerName,
      entries: backupHoldEntries.map((row) => ({
        styleId: styleIdByNo.get(row.styleNo),
        styleNo: row.styleNo,
        styleName: row.styleName,
        quantity: backupEffectiveQuantity(row.styleNo, row.quantity),
      })),
    })
    setJobs((current) =>
      current.map((job) =>
        job.id === activeJob.id
          ? {
              ...job,
              status: job.status === 'done' ? job.status : 'backup',
              updatedOn: new Date().toISOString().slice(0, 10),
              plannedQty: backupHoldTotal,
            }
          : job,
      ),
    )
    setBackupApplyNote(
      `운영 현황에 ${formatNumber(backupHoldEntries.length)}종 · ${formatNumber(backupHoldTotal)}개 반영했습니다. (UI 테스트 · DB 미저장)`,
    )
  }

  const doneJobs = useMemo(() => {
    const done = jobs.filter((job) => job.status === 'done')
    if (assigneeFilter === 'all') return done
    if (assigneeFilter === 'mine') {
      return done.filter((job) => job.assignee === DEMO_ME)
    }
    return done.filter((job) => job.assignee === assigneeFilter)
  }, [jobs, assigneeFilter])
  const showingJob = Boolean(activeJob)

  function openJob(jobId: string, nextPanel: JobPanel = 'upload') {
    setActiveJobId(jobId)
    setPanel(nextPanel)
    setBackupApplyNote(null)
    setBackupSearch('')
    setBackupQtyOverrides({})
    setBackupEditingStyleNo(null)
    setBackupEditDraft('')
  }

  function backToList() {
    setActiveJobId(null)
    setPanel('upload')
  }

  async function handleDownloadTemplate() {
    if (!activeJob || downloading) return
    setDownloading(true)
    try {
      await downloadBulkOutboundTemplate(
        activeJob.partnerName,
        templateFields,
      )
    } finally {
      setDownloading(false)
    }
  }

  function attachEvidenceFiles(fileList: FileList | null) {
    if (!activeJob || !fileList || fileList.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    const next: DemoEvidenceFile[] = Array.from(fileList).map((file) => ({
      id: `ev-${Date.now()}-${file.name}`,
      name: file.name,
      sizeLabel: formatFileSize(file.size),
      attachedOn: today,
    }))
    setJobs((current) =>
      current.map((job) =>
        job.id === activeJob.id
          ? {
              ...job,
              evidenceFiles: [...job.evidenceFiles, ...next],
              updatedOn: today,
            }
          : job,
      ),
    )
  }

  function removeEvidenceFile(fileId: string) {
    if (!activeJob) return
    setJobs((current) =>
      current.map((job) =>
        job.id === activeJob.id
          ? {
              ...job,
              evidenceFiles: job.evidenceFiles.filter(
                (file) => file.id !== fileId,
              ),
            }
          : job,
      ),
    )
  }

  return (
    <div>
      <PageHeader
        title="대량출고"
        description={
          showingJob
            ? '선택한 건의 작업판입니다. 목록으로 돌아가 다른 건을 열 수 있습니다.'
            : '내 건만 보고, 같은 업체 동시 건은 묶어서 고릅니다.'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {showingJob ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={backToList}
              >
                <ArrowLeft className="size-3.5" />
                목록
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2 className="size-3.5" />
                  업체 설정
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={visibleConfigs.length === 0}
                  onClick={() => setNewJobOpen(true)}
                >
                  <Plus className="size-3.5" />
                  새 건
                </Button>
              </>
            )}
          </div>
        }
      />

      {showingJob && activeJob ? (
        <div className="-mt-2 mb-4">
          <BulkOutboundFlowStrip
            status={activeJob.status}
            productListReady={productListReady}
            onSelect={setPanel}
          />
        </div>
      ) : null}
      {!showingJob ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">진행 중 건</CardTitle>
            <CardDescription>
              기본은 내 건만 보입니다. 같은 업체는 묶어 두어, 하루 차이로 동시에
              열린 건을 헷갈리지 않게 합니다.
            </CardDescription>
            <div className="flex flex-wrap gap-1.5 pt-2">
              {(
                [
                  { value: 'mine' as const, label: '내 건' },
                  { value: 'all' as const, label: '전체' },
                  ...DEMO_ASSIGNEES.filter((name) => name !== DEMO_ME).map(
                    (name) => ({ value: name, label: name }),
                  ),
                ] as { value: AssigneeFilter; label: string }[]
              ).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={assigneeFilter === item.value}
                  onClick={() => setAssigneeFilter(item.value)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    assigneeFilter === item.value
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {partnersQuery.isPending ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                불러오는 중입니다.
              </p>
            ) : openJobs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  {assigneeFilter === 'mine'
                    ? '내 진행 중 건이 없습니다.'
                    : '진행 중 건이 없습니다.'}
                </p>
                <Button
                  type="button"
                  disabled={visibleConfigs.length === 0}
                  onClick={() => setNewJobOpen(true)}
                >
                  <Plus className="size-4" />
                  새 건 추가
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                {partnerGroups.map((group) => (
                  <div key={group.partnerId} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2 px-0.5">
                      <p className="text-sm font-semibold">{group.partnerName}</p>
                      <p className="text-xs text-muted-foreground">
                        동시 {group.jobs.length}건
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.jobs.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => openJob(job.id)}
                          className="rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.04]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 truncate text-base font-semibold">
                              {job.title}
                            </p>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <DueRemainChip dueOn={job.dueOn} />
                              <Badge variant={STATUS_BADGE[job.status]}>
                                {STATUS_LABEL[job.status]}
                              </Badge>
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {job.startedOn} 시작 · 마감 {job.dueOn} · 예정{' '}
                            {job.plannedQty}개
                            {assigneeFilter !== 'mine' ? (
                              <> · {job.assignee}</>
                            ) : null}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {job.note}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setNewJobOpen(true)}
                  disabled={visibleConfigs.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted/20 hover:text-foreground disabled:opacity-50"
                >
                  <Plus className="size-4" />
                  새 건 추가
                </button>
              </div>
            )}

            {doneJobs.length > 0 ? (
              <div className="mt-6 border-t border-border pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  최근 확정
                </p>
                <div className="flex flex-wrap gap-2">
                  {doneJobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => openJob(job.id)}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted/40"
                    >
                      {job.partnerName} · {job.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">작업 건</p>
                  <CardTitle className="truncate text-2xl">
                    {activeJob!.partnerName}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {activeJob!.title} ·{' '}
                    {BARCODE_SOURCE_LABEL[activeJob!.barcodeSource]} ·{' '}
                    {activeJob!.startedOn}부터 · 마감 {activeJob!.dueOn} · 최근{' '}
                    {activeJob!.updatedOn} · 담당 {activeJob!.assignee}
                  </CardDescription>
                  {activeJob!.note ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {activeJob!.note}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <DueRemainChip dueOn={activeJob!.dueOn} />
                  <Badge variant={STATUS_BADGE[activeJob!.status]}>
                    {STATUS_LABEL[activeJob!.status]}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {PANELS.map((item) => {
                  const locked =
                    item.value === 'products' && !productListReady
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={panel === item.value}
                      disabled={locked}
                      title={
                        locked
                          ? '상품연결에서 미매칭이 없어야 열 수 있습니다.'
                          : undefined
                      }
                      onClick={() => {
                        if (locked) return
                        setPanel(item.value)
                      }}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs',
                        panel === item.value
                          ? 'border-primary/40 bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted/40',
                        locked && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                패널은 아무 순서나 열 수 있습니다. 상품 리스트만 매칭이 끝난 뒤
                열립니다.
              </p>
            </CardContent>
          </Card>

          {panel === 'upload' ? (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">업체 발주서 원본</CardTitle>
                  <CardDescription>
                    받은 파일을 그대로 보관합니다. 파싱·변환하지 않으며, 업체가
                    수량을 바꾸거나 말을 바꿀 때 증거로 씁니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {activeJob!.evidenceFiles.length > 0 ? (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {activeJob!.evidenceFiles.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center gap-3 px-3 py-2.5"
                        >
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {file.sizeLabel} · {file.attachedOn} 보관
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => removeEvidenceFile(file.id)}
                          >
                            삭제
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                      아직 보관한 원본이 없습니다.
                    </p>
                  )}
                  <div>
                    <label className="inline-flex">
                      <input
                        type="file"
                        multiple
                        className="sr-only"
                        onChange={(event) => {
                          attachEvidenceFiles(event.target.files)
                          event.target.value = ''
                        }}
                      />
                      <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted/50">
                        <Upload className="size-3.5" />
                        원본 파일 보관
                      </span>
                    </label>
                    <p className="mt-2 text-xs text-muted-foreground">
                      엑셀·PDF·캡처 등 형식 제한 없음. 작업용 표준 양식과는
                      별개입니다.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">엑셀 (우리 양식)</CardTitle>
                  <CardDescription>
                    헤더 이름만 같으면 열 위치는 상관없습니다. 양식에 없는 열은
                    무시합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {templateFields.map((field) => (
                      <span
                        key={field.id}
                        className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {field.label}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setTemplateHeaderOpen(true)}
                    >
                      <Settings2 className="size-4" />
                      양식 수정
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={downloading || templateFields.length === 0}
                      onClick={() => void handleDownloadTemplate()}
                    >
                      <Download className="size-4" />
                      양식 다운로드
                    </Button>
                    <label className="inline-flex">
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv,.txt"
                        className="sr-only"
                        disabled={templateFields.length === 0}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) void handleUploadExcel(file)
                          event.target.value = ''
                        }}
                      />
                      <span
                        className={cn(
                          'inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 text-sm hover:bg-muted',
                          templateFields.length === 0 &&
                            'pointer-events-none opacity-50',
                        )}
                      >
                        <Upload className="size-4" />
                        엑셀 올리기
                      </span>
                    </label>
                  </div>
                  {uploadError ? (
                    <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                      {uploadError}
                    </p>
                  ) : null}
                  {uploadNote ? (
                    <p className="text-xs text-muted-foreground">{uploadNote}</p>
                  ) : null}
                  {activeJob!.excelRows.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        {activeJob!.excelFileName ?? '업로드 파일'} ·{' '}
                        {formatNumber(activeJob!.excelRows.length)}행
                      </p>
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead className="border-b border-border text-xs text-muted-foreground">
                          <tr>
                            {templateFields.map((field) => (
                              <th
                                key={field.id}
                                className="whitespace-nowrap px-3 py-2 font-medium"
                              >
                                {field.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeJob!.excelRows.slice(0, 8).map((row) => (
                            <tr
                              key={row.id}
                              className="border-b border-border last:border-0"
                            >
                              {templateFields.map((field) => (
                                <td
                                  key={field.id}
                                  className="max-w-[12rem] truncate px-3 py-2"
                                >
                                  {row.values[field.id] || (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {activeJob!.excelRows.length > 8 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                          외 {formatNumber(activeJob!.excelRows.length - 8)}행
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {panel === 'convert' ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  상품연결
                </CardTitle>
                <CardDescription>
                  엑셀 「상품바코드」를{' '}
                  {activeJob!.barcodeSource === 'partner'
                    ? `거래처 코드 「${partnerCodeHeaderLabel}」`
                    : '88바코드'}
                  와 맞춰 구성·연결 필드를 가져옵니다. 매칭이 덜 끝나도
                  목록으로 돌아가 다른 건을 열 수 있습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeJob!.excelRows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                    먼저 「엑셀」 패널에서 우리 양식 파일을 올려 주세요.
                  </div>
                ) : !convertMatch.barcodeField ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                    양식에 「상품바코드」 헤더가 없습니다. 엑셀 양식 수정에서
                    추가해 주세요.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="muted">
                        전체 {formatNumber(convertMatch.rows.length)}행
                      </Badge>
                      <Badge variant="success">
                        연결{' '}
                        {formatNumber(
                          convertMatch.matchedCount +
                            convertMatch.noComponentsCount,
                        )}
                      </Badge>
                      <Badge variant="muted">
                        구성 {formatNumber(convertMatch.matchedCount)}
                      </Badge>
                      {convertMatch.noComponentsCount > 0 ? (
                        <Badge variant="warning">
                          구성 없음{' '}
                          {formatNumber(convertMatch.noComponentsCount)}
                        </Badge>
                      ) : null}
                      {convertMatch.unmatchedCount > 0 ? (
                        <Badge variant="danger">
                          미매칭 {formatNumber(convertMatch.unmatchedCount)}
                        </Badge>
                      ) : null}
                      {convertMatch.emptyCount > 0 ? (
                        <Badge variant="outline">
                          바코드 비움 {formatNumber(convertMatch.emptyCount)}
                        </Badge>
                      ) : null}
                      {activeJob!.barcodeSource === 'partner' ? (
                        <Link to={`/b/${brand.slug}/partner-codes`}>
                          <Button type="button" size="sm" variant="outline">
                            거래처 바코드 열기
                          </Button>
                        </Link>
                      ) : (
                        <Link to={`/b/${brand.slug}/usage-codes`}>
                          <Button type="button" size="sm" variant="outline">
                            88바코드 열기
                          </Button>
                        </Link>
                      )}
                      {productListReady ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setPanel('products')}
                        >
                          상품 리스트 보기
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled>
                          상품 리스트 (미매칭 해소 후)
                        </Button>
                      )}
                    </div>

                    {activeJob!.barcodeSource === 'own' &&
                    ownCodesQuery.isPending ? (
                      <p className="text-sm text-muted-foreground">
                        88바코드 불러오는 중…
                      </p>
                    ) : null}

                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full min-w-[960px] text-left text-sm">
                        <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th className="whitespace-nowrap px-3 py-2 font-medium">
                              상품바코드
                            </th>
                            <th className="whitespace-nowrap px-3 py-2 font-medium">
                              상품이름
                            </th>
                            <th className="whitespace-nowrap px-3 py-2 font-medium">
                              발주수량
                            </th>
                            <th className="whitespace-nowrap px-3 py-2 font-medium">
                              상태
                            </th>
                            <th className="whitespace-nowrap px-3 py-2 font-medium">
                              구성
                            </th>
                            {convertMatch.linkedFields.map((field) => (
                              <th
                                key={field.id}
                                className="whitespace-nowrap px-3 py-2 font-medium"
                              >
                                {field.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {convertMatch.rows.slice(0, 100).map((row) => {
                            const linked =
                              row.status === 'matched' ||
                              row.status === 'no-components'
                            const componentsLabel = formatComponentsLabel(
                              row.components,
                            )
                            const totalQty = row.components.reduce(
                              (sum, item) => sum + item.qty,
                              0,
                            )
                            return (
                              <tr
                                key={row.id}
                                className="border-b border-border last:border-0"
                              >
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                                  {row.barcode || (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                                <td className="max-w-[16rem] truncate px-3 py-2">
                                  {row.productName || (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2">
                                  {row.orderQty || (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2">
                                  {row.status === 'matched' ? (
                                    <Badge variant="success">연결됨</Badge>
                                  ) : row.status === 'no-components' ? (
                                    <Badge variant="warning">구성 없음</Badge>
                                  ) : row.status === 'empty' ? (
                                    <Badge variant="outline">바코드 없음</Badge>
                                  ) : (
                                    <Badge variant="danger">미매칭</Badge>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {row.status === 'matched' &&
                                  componentsLabel ? (
                                    <div className="space-y-0.5">
                                      <Badge variant="muted">
                                        {row.components.length}종 ·{' '}
                                        {formatNumber(totalQty)}개
                                      </Badge>
                                      <p className="text-xs text-muted-foreground">
                                        {componentsLabel}
                                      </p>
                                    </div>
                                  ) : row.status === 'no-components' ? (
                                    <Badge variant="warning">
                                      M번호 미지정
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                                {convertMatch.linkedFields.map((field) => {
                                  const value = linked
                                    ? row.linkedValues[field.id] ?? ''
                                    : ''
                                  return (
                                    <td
                                      key={field.id}
                                      className="max-w-[14rem] truncate px-3 py-2 text-xs"
                                      title={value || undefined}
                                    >
                                      {value || (
                                        <span className="text-muted-foreground">
                                          —
                                        </span>
                                      )}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {convertMatch.rows.length > 100 ? (
                        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                          외 {formatNumber(convertMatch.rows.length - 100)}행
                        </p>
                      ) : null}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {panel === 'products' ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">상품 리스트</CardTitle>
                <CardDescription>
                  구성 × 발주수량을 M번호로 합산합니다. 창고 위치는 박스창고
                  기준이며, 위치 오름차순으로 정렬합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!productListReady ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                    상품연결에서 미매칭·빈 바코드를 없앤 뒤 열어 주세요.
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPanel('convert')}
                      >
                        상품연결로
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="muted">
                        {formatNumber(productListAllocation.lines.length)}행
                      </Badge>
                      <Badge variant="muted">
                        요청 {formatNumber(productListAllocation.totalRequested)}
                      </Badge>
                      <Badge variant="success">
                        배치{' '}
                        {formatNumber(productListAllocation.totalAllocated)}
                      </Badge>
                      {productListAllocation.totalShortage > 0 ? (
                        <Badge variant="warning">
                          미지정{' '}
                          {formatNumber(productListAllocation.totalShortage)}
                        </Badge>
                      ) : null}
                      <Badge variant="outline">박스창고</Badge>
                      <div className="ml-auto">
                        <BulkOutboundProductListPrint
                          brandId={brand.id}
                          allocation={productListAllocation}
                          jobTitle={activeJob!.partnerName}
                          jobSubtitle={`${activeJob!.title} · ${BARCODE_SOURCE_LABEL[activeJob!.barcodeSource]} · ${activeJob!.startedOn}부터 · 마감 ${activeJob!.dueOn} · 최근 ${activeJob!.updatedOn} · 담당 ${activeJob!.assignee}`}
                        />
                      </div>
                    </div>

                    {stylesQuery.isPending ||
                    warehouseSetQuery.isPending ||
                    warehousePositionsQuery.isPending ? (
                      <p className="text-sm text-muted-foreground">
                        창고 자리 불러오는 중…
                      </p>
                    ) : null}

                    {!warehouseSetQuery.isPending &&
                    !warehouseSetQuery.data ? (
                      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        활성 박스창고 세트가 없어 위치는 「
                        {UNSPECIFIED_LOCATION_ZONE}」으로 표시됩니다. 창고
                        관리에서 엑셀을 올리면 자리가 붙습니다.
                      </p>
                    ) : null}

                    {productListAllocation.lines.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                        구성이 연결된 행이 없거나 발주수량이 비어 있습니다.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                            <tr>
                              <th className="whitespace-nowrap px-3 py-2 font-medium">
                                창고 위치
                              </th>
                              <th className="whitespace-nowrap px-3 py-2 font-medium">
                                M번호
                              </th>
                              <th className="whitespace-nowrap px-3 py-2 font-medium">
                                공식상품명
                              </th>
                              <th className="whitespace-nowrap px-3 py-2 font-medium">
                                발주수량
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {productListAllocation.lines.map((line) => {
                              const locations =
                                line.locationLabels?.filter(Boolean) ??
                                line.locationLabel.split('\n').filter(Boolean)
                              return (
                              <tr
                                key={line.styleNo}
                                className="border-b border-border last:border-0"
                              >
                                <td className="whitespace-pre-line px-3 py-2 font-mono text-xs leading-5">
                                  {locations.length > 0
                                    ? locations.map((label) =>
                                        line.isShortage &&
                                        label === UNSPECIFIED_LOCATION_ZONE
                                          ? `${label}(재고 부족)`
                                          : label,
                                      ).join('\n')
                                    : line.isShortage
                                      ? `${line.locationLabel}(재고 부족)`
                                      : line.locationLabel}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 align-middle font-mono text-xs">
                                  {line.styleNo}
                                </td>
                                <td className="max-w-[20rem] px-3 py-2 align-middle">
                                  {line.styleName || (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 align-middle">
                                  {formatNumber(line.quantity)}
                                </td>
                              </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {panel === 'backup' ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">임시 백업 (가재고)</CardTitle>
                <CardDescription>
                  확정 전 예정분. 상품 리스트의 M번호를 합산해 가재고로
                  잡습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!productListReady ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                    상품연결·상품 리스트가 준비된 뒤 열어 주세요.
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPanel('convert')}
                      >
                        상품연결로
                      </Button>
                    </div>
                  </div>
                ) : backupHoldEntries.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                    합산할 발주 수량이 없습니다. 상품 리스트를 먼저 확인하세요.
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPanel('products')}
                      >
                        상품 리스트로
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">임시</Badge>
                      <Badge variant="muted">
                        {formatNumber(backupHoldEntries.length)}종
                      </Badge>
                      <Badge variant="muted">
                        예정 {formatNumber(backupHoldTotal)}
                      </Badge>
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={applyBackupToOperations}
                        >
                          임시 반영
                        </Button>
                        <Link
                          to={`/b/${brand.slug}/operations`}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
                        >
                          운영 현황
                        </Link>
                      </div>
                    </div>
                    {backupApplyNote ? (
                      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        {backupApplyNote}{' '}
                        <Link
                          to={`/b/${brand.slug}/operations`}
                          className="font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          바로가기
                        </Link>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        임시 반영 시 오늘 날짜·이 업체로 운영 현황 출고
                        데이터(브라우저 저장)에 붙습니다. 같은 건을 다시 누르면
                        이전 반영분을 덮어씁니다. 수량을 누르면 수정할 수
                        있습니다.
                      </p>
                    )}
                    <Input
                      value={backupSearch}
                      onChange={(event) => setBackupSearch(event.target.value)}
                      placeholder="M번호·상품명 검색"
                      className="h-8 max-w-sm text-xs"
                      aria-label="임시 백업 검색"
                    />
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th className="whitespace-nowrap px-3 py-2 font-medium">
                              M번호
                            </th>
                            <th className="whitespace-nowrap px-3 py-2 font-medium">
                              공식상품명
                            </th>
                            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                              발주수량
                            </th>
                            {backupEditDates.map((date) => (
                              <th
                                key={date}
                                title={date}
                                className="whitespace-nowrap px-3 py-2 text-right font-medium"
                              >
                                발주수량({formatBackupEditDateHeader(date)})
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {backupHoldRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={3 + backupEditDates.length}
                                className="px-3 py-8 text-center text-sm text-muted-foreground"
                              >
                                검색 결과가 없습니다.
                              </td>
                            </tr>
                          ) : (
                            backupHoldRows.map((row) => {
                              const editing =
                                backupEditingStyleNo === row.styleNo
                              return (
                                <tr
                                  key={row.styleNo}
                                  className="border-b border-border last:border-0"
                                >
                                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                                    {row.styleNo}
                                  </td>
                                  <td className="px-3 py-2">
                                    {row.styleName || (
                                      <span className="text-muted-foreground">
                                        —
                                      </span>
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right">
                                    {editing ? (
                                      <Input
                                        autoFocus
                                        type="number"
                                        min={0}
                                        step={1}
                                        value={backupEditDraft}
                                        onChange={(event) =>
                                          setBackupEditDraft(event.target.value)
                                        }
                                        onBlur={() =>
                                          commitBackupQtyEdit(
                                            row.styleNo,
                                            row.quantity,
                                          )
                                        }
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.currentTarget.blur()
                                          }
                                          if (event.key === 'Escape') {
                                            setBackupEditingStyleNo(null)
                                            setBackupEditDraft('')
                                          }
                                        }}
                                        className="ml-auto h-7 w-24 text-right text-xs tabular-nums"
                                        aria-label={`${row.styleNo} 발주수량 수정`}
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          startBackupQtyEdit(
                                            row.styleNo,
                                            row.effectiveQuantity,
                                          )
                                        }
                                        className="rounded px-1.5 py-0.5 tabular-nums hover:bg-muted"
                                        title="클릭하여 수량 수정"
                                      >
                                        {formatNumber(row.quantity)}
                                      </button>
                                    )}
                                  </td>
                                  {backupEditDates.map((date) => {
                                    const editedQty =
                                      backupQtyOverrides[row.styleNo]?.[date]
                                    return (
                                      <td
                                        key={date}
                                        className="whitespace-nowrap px-3 py-2 text-right tabular-nums"
                                      >
                                        {editedQty != null ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              startBackupQtyEdit(
                                                row.styleNo,
                                                editedQty,
                                              )
                                            }
                                            className="rounded px-1.5 py-0.5 font-medium hover:bg-muted"
                                            title="클릭하여 수량 수정"
                                          >
                                            {formatNumber(editedQty)}
                                          </button>
                                        ) : (
                                          <span className="text-muted-foreground/50">
                                            ·
                                          </span>
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {panel === 'adjust' ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">현장 조율</CardTitle>
                <CardDescription>
                  피킹하며 며칠에 걸쳐 수량을 고칩니다. 수정할 때마다 임시 백업
                  버전이 올라갑니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                  변경 이력 · 타 업체 경합 메모 자리
                </div>
              </CardContent>
            </Card>
          ) : null}

          {panel === 'docs' ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">서류·라벨</CardTitle>
                <CardDescription>
                  업체·출고방식에 따라 필요한 슬롯만 씁니다. 피킹이 덜 끝나도
                  일부 서류만 먼저 뽑을 수 있습니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {DOC_SLOTS.map((slot) => (
                    <div
                      key={slot.id}
                      className="rounded-lg border border-border px-3 py-3 text-sm"
                    >
                      {slot.label}
                      <div className="mt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled
                        >
                          미리보기
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {panel === 'done' ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">포장·확정</CardTitle>
                <CardDescription>
                  준비가 되면 그때 확정합니다. 그 전까지는 임시 백업으로
                  남습니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" disabled>
                  출고 확정
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {settingsOpen ? (
        <PartnerSettingsDialog
          brandSlug={brand.slug}
          partners={allPartners}
          ownPartnerIds={ownPartnerIds}
          partnerCodePartnerIds={partnerCodePartnerIds}
          initialConfigs={visibleConfigs}
          onClose={() => setSettingsOpen(false)}
          onSave={(configs) => {
            writeBulkPartnerConfigs(brand.id, configs)
            setPartnerConfigs(configs)
          }}
        />
      ) : null}

      {newJobOpen ? (
        <NewJobDialog
          configs={visibleConfigs}
          onClose={() => setNewJobOpen(false)}
          onCreate={(config, title, dueOn) => {
            const id = `job-${Date.now()}`
            const today = todayIso()
            const job: DemoJob = {
              id,
              partnerId: config.partnerId,
              partnerName: config.partnerName,
              barcodeSource: config.barcodeSource,
              title,
              assignee: DEMO_ME,
              status: 'draft',
              startedOn: today,
              dueOn,
              updatedOn: today,
              plannedQty: 0,
              note: '방금 만든 건. 엑셀부터 올리면 됩니다.',
              evidenceFiles: [],
              excelRows: [],
              excelFileName: null,
            }
            setJobs((current) => [job, ...current])
            openJob(id, 'upload')
          }}
        />
      ) : null}

      {templateHeaderOpen && activeJob ? (
        <TemplateHeaderDialog
          partnerName={activeJob.partnerName}
          fields={templateFields}
          onClose={() => setTemplateHeaderOpen(false)}
          onSave={(fields) => {
            writeTemplateFields(
              brand.id,
              activeJob.partnerId,
              activeJob.barcodeSource,
              fields,
            )
            setTemplateFields(fields)
          }}
        />
      ) : null}
    </div>
  )
}
