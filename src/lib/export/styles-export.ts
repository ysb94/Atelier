import type { BrandField, FieldOwner, Season, Style } from '@/lib/types'
import { formatSeasonLabel } from '@/lib/types'
import { OWNER_LABEL, OWNER_ORDER } from '@/lib/import/fields'
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
  if (owner === 'all') return '취합'
  return OWNER_LABEL[owner]
}

/**
 * 현재 필터된 상품을 xlsx로 내려받는다.
 * 헤더는 가져오기가 인식하는 label 그대로라서 고쳐 다시 넣을 수 있다.
 */
export async function downloadStylesExport(options: {
  brandName: string
  owner: DataSheetOwner
  fields: BrandField[]
  styles: Style[]
  seasons: Season[]
}) {
  const XLSX = await import('xlsx')
  const columns = columnsForSheet(options.fields, options.owner)
  if (columns.length === 0) {
    throw new Error('내보낼 항목이 없습니다.')
  }

  const seasonById = new Map(options.seasons.map((s) => [s.id, s]))
  const headers = columns.map((f) => f.label)
  const rows = options.styles.map((style) => {
    const season = seasonById.get(style.seasonId)
    return columns.map((field) => {
      if (field.systemKey === 'seasonCode' || field.systemKey === 'seasonId') {
        return season?.code ?? ''
      }
      return getStyleFieldDisplay(style, field, {
        seasonCode: season ? formatSeasonLabel(season) : undefined,
      })
    })
  })

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  sheet['!cols'] = headers.map(() => ({ wch: 16 }))
  XLSX.utils.book_append_sheet(workbook, sheet, '상품데이터')

  const ownerPart = sheetOwnerLabel(options.owner)
  const fileName = `${safeFilePart(options.brandName)}_${safeFilePart(ownerPart)}_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export { fieldValueKey }
