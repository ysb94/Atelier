import type { BrandField, FieldOwner, Season, Style } from '@/lib/types'
import { formatSeasonLabel } from '@/lib/types'
import { OWNER_LABEL, OWNER_ORDER } from '@/lib/import/fields'
import { ROW_ACTION_HEADER, ROW_ID_HEADER } from '@/lib/import/row-keys'
import {
  fieldValueKey,
  getStyleFieldDisplay,
} from '@/lib/products/style-fields'

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function safeFilePart(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'brand'
}

export type DataSheetOwner = FieldOwner | 'all'

/** 시트에 보일 열. 품번·상품명은 항상 앞에 둔다. */
export function columnsForSheet(
  fields: BrandField[],
  owner: DataSheetOwner,
): BrandField[] {
  const styleNo = fields.find((f) => f.systemKey === 'styleNo')
  const name = fields.find((f) => f.systemKey === 'name')
  const rest = fields
    .filter((f) => {
      if (f.level === 'sku') return false
      if (f.systemKey === 'styleNo' || f.systemKey === 'name') return false
      if (owner === 'all') {
        return OWNER_ORDER.includes(f.owner) || f.owner === 'common'
      }
      return f.owner === owner || f.owner === 'common'
    })
    .sort((a, b) => {
      if (owner === 'all') {
        const ao = OWNER_ORDER.indexOf(a.owner)
        const bo = OWNER_ORDER.indexOf(b.owner)
        if (ao !== bo) return ao - bo
      }
      return a.order - b.order
    })

  const pinned: BrandField[] = []
  if (styleNo) pinned.push(styleNo)
  else {
    pinned.push({
      id: '_styleNo',
      brandId: '',
      label: '품번',
      systemKey: 'styleNo',
      type: 'text',
      owner: 'common',
      required: true,
      order: -2,
      level: 'style',
    })
  }
  if (name) pinned.push(name)
  else {
    pinned.push({
      id: '_name',
      brandId: '',
      label: '상품명',
      systemKey: 'name',
      type: 'text',
      owner: 'planning',
      required: true,
      order: -1,
      level: 'style',
    })
  }
  return [...pinned, ...rest]
}

export function sheetOwnerLabel(owner: DataSheetOwner): string {
  if (owner === 'all') return '전체'
  return OWNER_LABEL[owner]
}

const GUIDE_ROWS: string[][] = [
  ['열', '설명'],
  [
    ROW_ID_HEADER,
    '상품을 찾는 열입니다. 지우거나 고치지 마세요. 이 값이 있으면 품번을 바꿔도 같은 상품으로 수정됩니다.',
  ],
  [
    ROW_ACTION_HEADER,
    '비워 두면 수정합니다. "삭제"라고 쓴 행은 업로드할 때 상품이 지워집니다.',
  ],
  [
    '나머지 열',
    '값을 고치면 그대로 반영됩니다. 새 행을 아래에 추가하면 신규 상품으로 등록됩니다.',
  ],
  [
    '빈 칸',
    '기본은 기존 값을 그대로 둡니다. 값을 지우려면 업로드 화면에서 "빈 칸은 값 지우기"를 켜세요.',
  ],
  [
    '대표이미지',
    '비워 두면 품번과 같은 이름의 사진을 자동으로 찾습니다. 규칙과 다른 사진을 쓸 때만 전체 주소를 적으세요.',
  ],
]

function buildExportGrid(options: {
  owner: DataSheetOwner
  fields: BrandField[]
  styles: Style[]
  seasons: Season[]
  editable: boolean
}) {
  const columns = columnsForSheet(options.fields, options.owner)
  if (columns.length === 0) {
    throw new Error('내보낼 항목이 없습니다.')
  }

  const seasonById = new Map(options.seasons.map((s) => [s.id, s]))
  const prefix = options.editable ? [ROW_ID_HEADER, ROW_ACTION_HEADER] : []
  const headers = [...prefix, ...columns.map((f) => f.label)]

  const rows = options.styles.map((style) => {
    const season = seasonById.get(style.seasonId)
    const values = columns.map((field) => {
      if (field.systemKey === 'seasonCode' || field.systemKey === 'seasonId') {
        return season?.code ?? ''
      }
      return getStyleFieldDisplay(style, field, {
        seasonCode: season ? formatSeasonLabel(season) : undefined,
      })
    })
    return options.editable ? [style.id, '', ...values] : values
  })

  return { headers, rows, editable: options.editable }
}

function buildWorkbook(
  XLSX: typeof import('xlsx'),
  grid: { headers: string[]; rows: string[][]; editable: boolean },
) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([grid.headers, ...grid.rows])
  sheet['!cols'] = grid.headers.map((header) =>
    header === ROW_ID_HEADER
      ? { wch: 38 }
      : header === ROW_ACTION_HEADER
        ? { wch: 8 }
        : { wch: 16 },
  )
  XLSX.utils.book_append_sheet(workbook, sheet, '상품데이터')

  if (grid.editable) {
    const guide = XLSX.utils.aoa_to_sheet(GUIDE_ROWS)
    guide['!cols'] = [{ wch: 12 }, { wch: 78 }]
    XLSX.utils.book_append_sheet(workbook, guide, '작성안내')
  }

  return workbook
}

/**
 * 현재 필터된 상품을 xlsx로 내려받는다.
 * 헤더는 가져오기가 인식하는 label 그대로이고, _id·_작업 열로 수정·삭제까지 되돌릴 수 있다.
 */
export async function downloadStylesExport(options: {
  brandName: string
  owner: DataSheetOwner
  fields: BrandField[]
  styles: Style[]
  seasons: Season[]
  /** _id·_작업 열을 넣어 다시 올릴 수 있게 한다. 기본값은 넣는다. */
  editable?: boolean
}) {
  const XLSX = await import('xlsx')
  const grid = buildExportGrid({
    owner: options.owner,
    fields: options.fields,
    styles: options.styles,
    seasons: options.seasons,
    editable: options.editable !== false,
  })

  const ownerPart = sheetOwnerLabel(options.owner)
  const fileName = `${safeFilePart(options.brandName)}_${safeFilePart(ownerPart)}_${todayStamp()}.xlsx`
  XLSX.writeFile(buildWorkbook(XLSX, grid), fileName)
}

/**
 * 대량 삭제 직전 대상 행을 파일로 남긴다.
 * 되돌려야 할 때 이 파일을 그대로 다시 올리면 복구된다.
 */
export async function downloadDeletionSnapshot(options: {
  brandName: string
  fields: BrandField[]
  styles: Style[]
  seasons: Season[]
}) {
  const XLSX = await import('xlsx')
  const grid = buildExportGrid({
    owner: 'all',
    fields: options.fields,
    styles: options.styles,
    seasons: options.seasons,
    editable: true,
  })

  const stamp = new Date()
  const time = `${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`
  const fileName = `${safeFilePart(options.brandName)}_삭제전백업_${todayStamp()}_${time}.xlsx`
  XLSX.writeFile(buildWorkbook(XLSX, grid), fileName)
}

export { fieldValueKey }
