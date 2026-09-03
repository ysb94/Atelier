import {
  buildDefaultInvoiceProductListPrintLayout,
  buildInvoiceProductListPrintRouteSections,
  formatInvoiceProductListRouteLabel,
  type InvoiceProductListPrintLayout,
} from '@/lib/invoice/product-list-route'
import type {
  InvoiceProductListWarehouseGroup,
  InvoiceProductListWarehouseLine,
} from '@/lib/invoice/product-list-warehouse'
import { UNSPECIFIED_LOCATION_ZONE } from '@/lib/invoice/product-list-warehouse'

export const INVOICE_PRODUCT_LIST_PRINT_ROWS = 26
export const INVOICE_PRODUCT_LIST_ZONE_HEADER_ROWS = 1
export const INVOICE_PRODUCT_LIST_LANDSCAPE_ROWS = 24
export const INVOICE_PRODUCT_LIST_MIN_FONT_PT = 7
export const INVOICE_PRODUCT_LIST_BASE_FONT_PT = 8

export type InvoiceProductListColumnMode =
  | 'vertical_1'
  | 'vertical_2'
  | 'horizontal_3'

export const INVOICE_PRODUCT_LIST_COLUMN_MODE_OPTIONS: {
  value: InvoiceProductListColumnMode
  label: string
}[] = [
  { value: 'vertical_1', label: '세로 1단' },
  { value: 'vertical_2', label: '세로 2단' },
  { value: 'horizontal_3', label: '가로 3단' },
]

export const INVOICE_PRODUCT_LIST_COLUMN_MODE_ORDER: InvoiceProductListColumnMode[] =
  ['vertical_1', 'vertical_2', 'horizontal_3']

export type InvoiceProductListPrintCapacity = {
  mode: InvoiceProductListColumnMode
  columnCount: 1 | 2 | 3
  rowsPerColumn: number
  zoneHeaderRows: number
  orientation: 'portrait' | 'landscape'
}

export const INVOICE_PRODUCT_LIST_CAPACITY_BY_MODE: Record<
  InvoiceProductListColumnMode,
  InvoiceProductListPrintCapacity
> = {
  vertical_1: {
    mode: 'vertical_1',
    columnCount: 1,
    rowsPerColumn: INVOICE_PRODUCT_LIST_PRINT_ROWS,
    zoneHeaderRows: INVOICE_PRODUCT_LIST_ZONE_HEADER_ROWS,
    orientation: 'portrait',
  },
  vertical_2: {
    mode: 'vertical_2',
    columnCount: 2,
    rowsPerColumn: INVOICE_PRODUCT_LIST_PRINT_ROWS,
    zoneHeaderRows: INVOICE_PRODUCT_LIST_ZONE_HEADER_ROWS,
    orientation: 'portrait',
  },
  horizontal_3: {
    mode: 'horizontal_3',
    columnCount: 3,
    rowsPerColumn: INVOICE_PRODUCT_LIST_LANDSCAPE_ROWS,
    zoneHeaderRows: INVOICE_PRODUCT_LIST_ZONE_HEADER_ROWS,
    orientation: 'landscape',
  },
}

export type InvoiceProductListPrintSlot =
  | {
      kind: 'header'
      locationZonePrefix: string
      zoneQuantity: number
      continued: boolean
      isShortage: boolean
    }
  | {
      kind: 'item'
      line: InvoiceProductListWarehouseLine
    }
  | {
      kind: 'empty'
    }

export type InvoiceProductListPrintZoneSegment = {
  locationZonePrefix: string
  zoneQuantity: number
  styleCount: number
  pageInZone: number
  pageCountInZone: number
  continued: boolean
  isShortage: boolean
  rows: InvoiceProductListWarehouseLine[]
}

export type InvoiceProductListPrintColumn = {
  columnIndex: number
  slots: InvoiceProductListPrintSlot[]
  segments: InvoiceProductListPrintZoneSegment[]
}

export type InvoiceProductListPrintFitProfile = {
  rowsPerColumn: number
  fontScale: number
  fontPt: number
  rowHeightMm: number
  columnWidthPercents: [number, number, number, number, number]
}

export type InvoiceProductListPrintPage = {
  printedOn: string
  warehouseLabel: string
  /** 바코드 출고 등에서 시트 상단에 넣는 작업 제목(업체명) */
  jobTitle?: string
  /** 바코드 출고 등에서 시트 상단에 넣는 건 요약 */
  jobSubtitle?: string
  /** true면 확인(체크) 열을 빼고 나머지 열을 넓힌다 */
  hideCheckColumn?: boolean
  routeGroupId: string
  routeGroupLabel: string
  routeGroupIndex: number
  routePageIndex: number
  routePageCount: number
  globalPageIndex: number
  globalPageCount: number
  locationZonePrefix: string
  zoneQuantity: number
  pageInSection: number
  pageCountInSection: number
  columnMode: InvoiceProductListColumnMode
  orientation: 'portrait' | 'landscape'
  fit: InvoiceProductListPrintFitProfile
  columns: InvoiceProductListPrintColumn[]
  segments: InvoiceProductListPrintZoneSegment[]
  slots: InvoiceProductListPrintSlot[]
  rows: Array<InvoiceProductListWarehouseLine | null>
}

export type InvoiceProductListPrintPageCounts = Record<
  InvoiceProductListColumnMode,
  number
>

export type InvoiceProductListPrintBuildInput = {
  groups: InvoiceProductListWarehouseGroup[]
  warehouseLabel: string
  layout?: InvoiceProductListPrintLayout
  columnMode?: InvoiceProductListColumnMode
  printedAt?: Date
  rowsPerPage?: number
  zoneHeaderRows?: number
  /** true면 작은 구역이 남은 칸에 안 들어갈 때 다음 장으로 통째 넘김. 기본 true */
  keepZoneTogether?: boolean
  autoFit?: boolean
}

export function formatInvoiceProductListPrintDate(date: Date) {
  const year = String(date.getFullYear()).slice(2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
}

export function getInvoiceProductListPrintCapacity(
  mode: InvoiceProductListColumnMode = 'vertical_1',
  override?: Partial<InvoiceProductListPrintCapacity>,
): InvoiceProductListPrintCapacity {
  const base = INVOICE_PRODUCT_LIST_CAPACITY_BY_MODE[mode]
  return {
    ...base,
    rowsPerColumn: override?.rowsPerColumn ?? base.rowsPerColumn,
    zoneHeaderRows: override?.zoneHeaderRows ?? base.zoneHeaderRows,
    columnCount: override?.columnCount ?? base.columnCount,
    orientation: override?.orientation ?? base.orientation,
    mode,
  }
}

type InvoiceProductListFitSpec = {
  contentWidthMm: number
  contentHeightMm: number
  chromeMm: number
  columnGapMm: number
  columnRulePadMm: number
  cellPadMm: number
  baseRowMm: number
  baseRows: number
  columnCount: 1 | 2 | 3
}

const INVOICE_PRODUCT_LIST_FIT_SPEC: Record<
  InvoiceProductListColumnMode,
  InvoiceProductListFitSpec
> = {
  vertical_1: {
    contentWidthMm: 194,
    contentHeightMm: 275,
    chromeMm: 13,
    columnGapMm: 0,
    columnRulePadMm: 0,
    cellPadMm: 1.4,
    baseRowMm: 8.4,
    baseRows: INVOICE_PRODUCT_LIST_PRINT_ROWS,
    columnCount: 1,
  },
  vertical_2: {
    contentWidthMm: 194,
    contentHeightMm: 275,
    chromeMm: 10,
    columnGapMm: 4,
    columnRulePadMm: 3,
    cellPadMm: 0.7,
    baseRowMm: 8.4,
    baseRows: INVOICE_PRODUCT_LIST_PRINT_ROWS,
    columnCount: 2,
  },
  horizontal_3: {
    contentWidthMm: 277,
    contentHeightMm: 194,
    chromeMm: 10,
    columnGapMm: 3,
    columnRulePadMm: 3,
    cellPadMm: 0.7,
    baseRowMm: 6.9,
    baseRows: INVOICE_PRODUCT_LIST_LANDSCAPE_ROWS,
    columnCount: 3,
  },
}

function isWidePrintChar(char: string) {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe1f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

export function measureInvoiceProductListPrintTextMm(
  text: string,
  fontPt = INVOICE_PRODUCT_LIST_BASE_FONT_PT,
) {
  let em = 0
  for (const char of text) {
    if (char === ' ') em += 0.35
    else if (isWidePrintChar(char)) em += 1
    else if (/[0-9A-Za-z]/.test(char)) em += 0.62
    else em += 0.55
  }
  return em * fontPt * (25.4 / 72)
}

function locationPrintText(line: InvoiceProductListWarehouseLine) {
  return line.isShortage
    ? `${line.locationLabel}(재고 부족)`
    : line.locationLabel
}

function longestPrintTexts(groups: InvoiceProductListWarehouseGroup[]) {
  let name = '상품명'
  let location = '자리번호'
  let styleNo = 'M번호'
  for (const group of groups) {
    for (const line of group.lines) {
      if (
        measureInvoiceProductListPrintTextMm(line.styleName) >
        measureInvoiceProductListPrintTextMm(name)
      ) {
        name = line.styleName
      }
      const nextLocation = locationPrintText(line)
      if (
        measureInvoiceProductListPrintTextMm(nextLocation) >
        measureInvoiceProductListPrintTextMm(location)
      ) {
        location = nextLocation
      }
      if (
        measureInvoiceProductListPrintTextMm(line.styleNo) >
        measureInvoiceProductListPrintTextMm(styleNo)
      ) {
        styleNo = line.styleNo
      }
    }
  }
  return { name, location, styleNo }
}

function invoiceProductListColumnInnerWidthMm(
  spec: InvoiceProductListFitSpec,
) {
  const gaps = (spec.columnCount - 1) * spec.columnGapMm
  const columnWidth = (spec.contentWidthMm - gaps) / spec.columnCount
  const rulePad = spec.columnCount > 1 ? spec.columnRulePadMm : 0
  return columnWidth - rulePad
}

function toColumnWidthPercents(widths: number[]) {
  const total = widths.reduce((sum, width) => sum + width, 0)
  const percents = widths.map((width) =>
    Math.round((width / total) * 10000) / 100,
  )
  const drift =
    100 - percents.reduce((sum, width) => sum + width, 0)
  percents[3] = Math.round((percents[3]! + drift) * 100) / 100
  return percents as [number, number, number, number, number]
}

export function maxInvoiceProductListFitRows(
  mode: InvoiceProductListColumnMode,
) {
  const spec = INVOICE_PRODUCT_LIST_FIT_SPEC[mode]
  const minRowMm =
    spec.baseRowMm *
    (INVOICE_PRODUCT_LIST_MIN_FONT_PT / INVOICE_PRODUCT_LIST_BASE_FONT_PT)
  const tableHeight = spec.contentHeightMm - spec.chromeMm
  return Math.max(
    spec.baseRows,
    Math.floor(tableHeight / minRowMm) - 1,
  )
}

function countPackedSheets(
  groups: InvoiceProductListWarehouseGroup[],
  rowsPerColumn: number,
  columnCount: number,
  headerRows: number,
  keepZoneTogether = true,
) {
  return chunkColumns(
    packRouteSection(groups, rowsPerColumn, headerRows, keepZoneTogether),
    columnCount,
  ).length
}

export function chooseInvoiceProductListFitRows(
  groups: InvoiceProductListWarehouseGroup[],
  mode: InvoiceProductListColumnMode,
  headerRows = INVOICE_PRODUCT_LIST_ZONE_HEADER_ROWS,
  keepZoneTogether = true,
) {
  const spec = INVOICE_PRODUCT_LIST_FIT_SPEC[mode]
  const baseRows = spec.baseRows
  const maxRows = maxInvoiceProductListFitRows(mode)
  const baseCount = countPackedSheets(
    groups,
    baseRows,
    spec.columnCount,
    headerRows,
    keepZoneTogether,
  )
  for (let rows = baseRows + 1; rows <= maxRows; rows += 1) {
    if (
      countPackedSheets(
        groups,
        rows,
        spec.columnCount,
        headerRows,
        keepZoneTogether,
      ) < baseCount
    ) {
      return rows
    }
  }
  return baseRows
}

export function buildInvoiceProductListPrintFitProfile(
  groups: InvoiceProductListWarehouseGroup[],
  mode: InvoiceProductListColumnMode,
  rowsPerColumn: number,
): InvoiceProductListPrintFitProfile {
  const spec = INVOICE_PRODUCT_LIST_FIT_SPEC[mode]
  const tableWidth = invoiceProductListColumnInnerWidthMm(spec)
  const pad = spec.cellPadMm * 2
  const texts = longestPrintTexts(groups)
  let checkW = Math.max(
    8,
    measureInvoiceProductListPrintTextMm('확인') + pad + 0.8,
  )
  let styleW = Math.max(
    11,
    measureInvoiceProductListPrintTextMm(texts.styleNo) + pad + 1.4,
  )
  let locationW = Math.max(
    12,
    measureInvoiceProductListPrintTextMm(texts.location) + pad + 1,
  )
  let qtyW = Math.max(
    9,
    measureInvoiceProductListPrintTextMm('수량') + pad + 0.8,
  )
  const minName = 18
  const minScale =
    INVOICE_PRODUCT_LIST_MIN_FONT_PT / INVOICE_PRODUCT_LIST_BASE_FONT_PT
  const nameNeed =
    measureInvoiceProductListPrintTextMm(texts.name) + pad
  const nameNeedAtMin = nameNeed * minScale + 1.2
  const minFixed = 34
  let fixed = checkW + styleW + locationW + qtyW
  let nameW = tableWidth - fixed
  if (nameW < Math.max(minName, nameNeedAtMin) && nameNeedAtMin + minFixed <= tableWidth) {
    nameW = Math.max(minName, nameNeedAtMin)
    const shrink = (tableWidth - nameW) / Math.max(fixed, 1)
    checkW *= shrink
    styleW *= shrink
    locationW *= shrink
    qtyW *= shrink
    fixed = checkW + styleW + locationW + qtyW
    nameW = tableWidth - fixed
  } else if (nameW < minName) {
    const shrink = Math.max(0, tableWidth - minName) / Math.max(fixed, 1)
    checkW *= shrink
    styleW *= shrink
    locationW *= shrink
    qtyW *= shrink
    nameW = Math.max(minName, tableWidth - (checkW + styleW + locationW + qtyW))
  }
  const nameScale = nameNeed <= 0 ? 1 : Math.min(1, nameW / nameNeed)
  const tableHeight = spec.contentHeightMm - spec.chromeMm
  const rowHeightMm = tableHeight / (rowsPerColumn + 1)
  const rowScale = Math.min(1, rowHeightMm / spec.baseRowMm)
  const fontScale = Math.max(
    minScale,
    Math.min(nameScale, rowScale, 1),
  )
  return {
    rowsPerColumn,
    fontScale,
    fontPt: INVOICE_PRODUCT_LIST_BASE_FONT_PT * fontScale,
    rowHeightMm,
    columnWidthPercents: toColumnWidthPercents([
      checkW,
      styleW,
      locationW,
      nameW,
      qtyW,
    ]),
  }
}

export function defaultInvoiceProductListPrintFitProfile(
  mode: InvoiceProductListColumnMode,
  rowsPerColumn?: number,
): InvoiceProductListPrintFitProfile {
  const spec = INVOICE_PRODUCT_LIST_FIT_SPEC[mode]
  const rows = rowsPerColumn ?? spec.baseRows
  const tableHeight = spec.contentHeightMm - spec.chromeMm
  return {
    rowsPerColumn: rows,
    fontScale: 1,
    fontPt: INVOICE_PRODUCT_LIST_BASE_FONT_PT,
    rowHeightMm: tableHeight / (rows + 1),
    columnWidthPercents: [8, 14, 18, 48, 12],
  }
}

function linePrintRowCount(line: InvoiceProductListWarehouseLine) {
  const labels = line.locationLabels?.filter(Boolean)
  if (labels && labels.length > 0) return labels.length
  const parts = line.locationLabel.split('\n').filter(Boolean)
  return Math.max(1, parts.length)
}

function padSlots(
  slots: InvoiceProductListPrintSlot[],
  rowsPerPage: number,
): InvoiceProductListPrintSlot[] {
  const padded = [...slots]
  let used = 0
  for (const slot of padded) {
    used +=
      slot.kind === 'item' ? linePrintRowCount(slot.line) : 1
  }
  while (used < rowsPerPage) {
    padded.push({ kind: 'empty' })
    used += 1
  }
  return padded
}

function zoneCapacity(rowsPerPage: number, headerRows: number) {
  return Math.max(1, rowsPerPage - headerRows)
}

type DraftSegment = {
  locationZonePrefix: string
  zoneQuantity: number
  styleCount: number
  continued: boolean
  isShortage: boolean
  rows: InvoiceProductListWarehouseLine[]
}

type DraftColumn = {
  slots: InvoiceProductListPrintSlot[]
  usedRows: number
  segments: DraftSegment[]
}

function createDraftColumn(): DraftColumn {
  return { slots: [], usedRows: 0, segments: [] }
}

function appendSegment(
  column: DraftColumn,
  group: InvoiceProductListWarehouseGroup,
  rows: InvoiceProductListWarehouseLine[],
  continued: boolean,
  headerRows: number,
) {
  const isShortage = group.locationZonePrefix === UNSPECIFIED_LOCATION_ZONE
  if (headerRows > 0) {
    column.slots.push({
      kind: 'header',
      locationZonePrefix: group.locationZonePrefix,
      zoneQuantity: group.quantity,
      continued,
      isShortage,
    })
    for (let index = 1; index < headerRows; index += 1) {
      column.slots.push({ kind: 'empty' })
    }
  }
  let rowCount = headerRows
  for (const line of rows) {
    const span = linePrintRowCount(line)
    column.slots.push({ kind: 'item', line })
    rowCount += span
  }
  column.usedRows += rowCount
  column.segments.push({
    locationZonePrefix: group.locationZonePrefix,
    zoneQuantity: group.quantity,
    styleCount: group.styleCount,
    continued,
    isShortage,
    rows,
  })
}

function packRouteSection(
  groups: InvoiceProductListWarehouseGroup[],
  rowsPerColumn: number,
  headerRows: number,
  keepZoneTogether = true,
): DraftColumn[] {
  const columns: DraftColumn[] = []
  let current = createDraftColumn()
  const flush = () => {
    if (current.segments.length === 0) return
    columns.push(current)
    current = createDraftColumn()
  }

  for (const group of groups) {
    if (group.lines.length === 0) continue
    const totalLineRows = group.lines.reduce(
      (sum, line) => sum + linePrintRowCount(line),
      0,
    )
    const capacity = zoneCapacity(rowsPerColumn, headerRows)
    const keepTogether =
      keepZoneTogether && totalLineRows <= capacity
    let remaining = group.lines
    let chunkIndex = 0
    while (remaining.length > 0) {
      const free = rowsPerColumn - current.usedRows
      if (free < headerRows + 1) {
        flush()
        continue
      }
      if (keepTogether) {
        const needed = headerRows + totalLineRows
        if (current.usedRows > 0 && current.usedRows + needed > rowsPerColumn) {
          flush()
        }
      }
      let take = 0
      let used = headerRows
      while (take < remaining.length) {
        const span = linePrintRowCount(remaining[take]!)
        if (used + span > free && take > 0) break
        if (used + span > free && take === 0) {
          // 한 줄이 칸보다 커도 강제로 넣고 다음 칸으로
          take = 1
          break
        }
        used += span
        take += 1
        if (used >= free) break
      }
      if (take <= 0) {
        flush()
        continue
      }
      appendSegment(
        current,
        group,
        remaining.slice(0, take),
        chunkIndex > 0,
        headerRows,
      )
      remaining = remaining.slice(take)
      chunkIndex += 1
      if (remaining.length > 0) flush()
    }
  }
  flush()
  return columns
}

function chunkColumns(
  columns: DraftColumn[],
  columnCount: number,
): DraftColumn[][] {
  if (columns.length === 0) return []
  const sheets: DraftColumn[][] = []
  for (let index = 0; index < columns.length; index += columnCount) {
    sheets.push(columns.slice(index, index + columnCount))
  }
  return sheets
}

function countZoneSheets(
  sheets: DraftColumn[][],
  prefix: string,
) {
  return sheets.filter((sheet) =>
    sheet.some((column) =>
      column.segments.some((segment) => segment.locationZonePrefix === prefix),
    ),
  ).length
}

function pageInZone(
  sheets: DraftColumn[][],
  prefix: string,
  sheetIndex: number,
) {
  let count = 0
  for (let index = 0; index <= sheetIndex; index += 1) {
    if (
      sheets[index]?.some((column) =>
        column.segments.some(
          (segment) => segment.locationZonePrefix === prefix,
        ),
      )
    ) {
      count += 1
    }
  }
  return count
}

function emptyColumn(rowsPerColumn: number, columnIndex: number) {
  return {
    columnIndex,
    slots: padSlots([], rowsPerColumn),
    segments: [] as InvoiceProductListPrintZoneSegment[],
  }
}

export function buildInvoiceProductListPrintPages(
  input: InvoiceProductListPrintBuildInput,
): InvoiceProductListPrintPage[] {
  const columnMode = input.columnMode ?? 'vertical_1'
  const capacity = getInvoiceProductListPrintCapacity(columnMode, {
    rowsPerColumn: input.rowsPerPage,
    zoneHeaderRows: input.zoneHeaderRows,
  })
  const printedOn = formatInvoiceProductListPrintDate(
    input.printedAt ?? new Date(),
  )
  const layout =
    input.layout ??
    buildDefaultInvoiceProductListPrintLayout(input.groups, 'picking')
  const sections = buildInvoiceProductListPrintRouteSections(
    input.groups,
    layout,
  )
  const keepZoneTogether = input.keepZoneTogether !== false
  const packed = sections.map((section) => {
    const rowsPerColumn = input.autoFit
      ? chooseInvoiceProductListFitRows(
          section.groups,
          columnMode,
          capacity.zoneHeaderRows,
          keepZoneTogether,
        )
      : capacity.rowsPerColumn
    const fit = input.autoFit
      ? buildInvoiceProductListPrintFitProfile(
          section.groups,
          columnMode,
          rowsPerColumn,
        )
      : defaultInvoiceProductListPrintFitProfile(columnMode, rowsPerColumn)
    return {
      section,
      rowsPerColumn,
      fit,
      sheets: chunkColumns(
        packRouteSection(
          section.groups,
          rowsPerColumn,
          capacity.zoneHeaderRows,
          keepZoneTogether,
        ),
        capacity.columnCount,
      ),
    }
  })
  const globalPageCount = packed.reduce(
    (sum, item) => sum + item.sheets.length,
    0,
  )
  const pages: InvoiceProductListPrintPage[] = []
  let globalPageIndex = 0
  packed.forEach((item, routeGroupIndex) => {
    const routePageCount = item.sheets.length
    item.sheets.forEach((sheet, sheetIndex) => {
      globalPageIndex += 1
      const columns = Array.from(
        { length: capacity.columnCount },
        (_, columnIndex) => {
          const draft = sheet[columnIndex]
          if (!draft) return emptyColumn(item.rowsPerColumn, columnIndex)
          const segments = draft.segments.map((segment) => ({
            ...segment,
            pageInZone: pageInZone(
              item.sheets,
              segment.locationZonePrefix,
              sheetIndex,
            ),
            pageCountInZone: countZoneSheets(
              item.sheets,
              segment.locationZonePrefix,
            ),
          }))
          return {
            columnIndex,
            slots: padSlots(draft.slots, item.rowsPerColumn),
            segments,
          }
        },
      )
      const segments = columns.flatMap((column) => column.segments)
      const first = segments[0]
      const slots = columns[0]?.slots ?? []
      pages.push({
        printedOn,
        warehouseLabel: input.warehouseLabel,
        routeGroupId: item.section.id,
        routeGroupLabel:
          item.section.label ||
          formatInvoiceProductListRouteLabel(
            segments.map((segment) => segment.locationZonePrefix),
          ),
        routeGroupIndex: routeGroupIndex + 1,
        routePageIndex: sheetIndex + 1,
        routePageCount,
        globalPageIndex,
        globalPageCount,
        locationZonePrefix: first?.locationZonePrefix ?? '',
        zoneQuantity: first?.zoneQuantity ?? 0,
        pageInSection: sheetIndex + 1,
        pageCountInSection: routePageCount,
        columnMode,
        orientation: capacity.orientation,
        fit: item.fit,
        columns,
        segments,
        slots,
        rows: slots.map((slot) => (slot.kind === 'item' ? slot.line : null)),
      })
    })
  })
  return pages
}

export function scopeInvoiceProductListPrintPages(
  pages: InvoiceProductListPrintPage[],
  routeGroupId: string | null,
): InvoiceProductListPrintPage[] {
  if (!routeGroupId) return []
  const scoped = pages.filter((page) => page.routeGroupId === routeGroupId)
  const globalPageCount = scoped.length
  return scoped.map((page, index) => ({
    ...page,
    globalPageIndex: index + 1,
    globalPageCount,
  }))
}

export function resolveInvoiceProductListSelectedRouteGroupId(input: {
  preferredId: string | null
  availableIds: string[]
  pages: InvoiceProductListPrintPage[]
}) {
  if (
    input.preferredId &&
    input.availableIds.includes(input.preferredId)
  ) {
    return input.preferredId
  }
  const firstPrinted = input.pages[0]?.routeGroupId
  if (firstPrinted && input.availableIds.includes(firstPrinted)) {
    return firstPrinted
  }
  return input.availableIds[0] ?? null
}

export function buildInvoiceProductListPrintPagesByMode(
  input: Omit<InvoiceProductListPrintBuildInput, 'columnMode'>,
) {
  return {
    vertical_1: buildInvoiceProductListPrintPages({
      ...input,
      columnMode: 'vertical_1',
    }),
    vertical_2: buildInvoiceProductListPrintPages({
      ...input,
      columnMode: 'vertical_2',
    }),
    horizontal_3: buildInvoiceProductListPrintPages({
      ...input,
      columnMode: 'horizontal_3',
    }),
  }
}

export function estimateInvoiceProductListPrintPageCounts(
  input: Omit<InvoiceProductListPrintBuildInput, 'columnMode'>,
): InvoiceProductListPrintPageCounts {
  const pages = buildInvoiceProductListPrintPagesByMode(input)
  return {
    vertical_1: pages.vertical_1.length,
    vertical_2: pages.vertical_2.length,
    horizontal_3: pages.horizontal_3.length,
  }
}

export function recommendInvoiceProductListColumnMode(
  counts: InvoiceProductListPrintPageCounts,
): InvoiceProductListColumnMode {
  const min = Math.min(
    counts.vertical_1,
    counts.vertical_2,
    counts.horizontal_3,
  )
  return (
    INVOICE_PRODUCT_LIST_COLUMN_MODE_ORDER.find(
      (mode) => counts[mode] === min,
    ) ?? 'vertical_1'
  )
}

export function invoiceProductListPrintSheetClass(
  mode: InvoiceProductListColumnMode,
) {
  return `print-sheet-${mode}`
}
