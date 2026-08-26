import type { BrandField, FieldOwner, Season } from '@/lib/types'
import { OWNER_LABEL } from '@/lib/import/fields'
import { filterFieldsForTemplate } from '@/lib/import/brand-field-template'
import {
  allowedValuesForField,
  createProductWorkbook,
  downloadExcelWorkbook,
  isProductDropdownField,
} from '@/lib/export/product-workbook'

const TYPE_LABEL: Record<BrandField['type'], string> = {
  text: '텍스트',
  number: '숫자',
  list: '목록(쉼표 구분)',
  gender: '성별(남성/여성/공용)',
  season: '시즌 코드',
  image: '이미지 주소',
  select: '단일 선택',
}

const EXAMPLE: Record<string, string> = {
  styleNo: 'AT-26SS-001',
  imageUrl: '',
  name: '오버사이즈 트렌치',
  seasonCode: '26SS',
  category: '아우터',
  gender: '여성',
  plannedQty: '400',
  targetCost: '89000',
  planner: '박민지',
  colors: 'Ivory, Black',
  fabric: 'Cotton blend',
  designer: '김서연',
  retailPrice: '289000',
  orderQty: '400',
  channel: '온라인',
  warehouse: '김포 물류센터',
  onHand: '0',
  description: '',
}

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

/**
 * 현재 브랜드 항목으로 빈 양식 xlsx를 만들고 브라우저 다운로드를 트리거한다.
 */
export async function downloadUploadTemplate(options: {
  brandName: string
  fields: BrandField[]
  ownerFilter?: FieldOwner | 'all'
  seasons?: Season[]
}) {
  const seasons = options.seasons ?? []
  const fields = filterFieldsForTemplate(
    options.fields,
    options.ownerFilter ?? 'all',
  ).sort((a, b) => a.order - b.order)

  if (fields.length === 0) {
    throw new Error('다운로드할 항목이 없습니다.')
  }

  const headers = fields.map((field) => field.label)
  const guideRows = [
    ['항목명', '유형', '필수', '부서', '예시', '허용값', '설명'],
    ...fields.map((field) => [
      field.label,
      TYPE_LABEL[field.type],
      field.required ? 'Y' : 'N',
      OWNER_LABEL[field.owner] ?? field.owner,
      allowedValuesForField(field, seasons).split(', ')[0] ||
        (field.systemKey && EXAMPLE[field.systemKey]) ||
        '',
      allowedValuesForField(field, seasons),
      [
        field.systemKey
          ? '시스템 기본 항목'
          : '브랜드에서 추가한 사용자 항목',
        isProductDropdownField(field)
          ? '연한 하늘색 열은 목록에서 고릅니다'
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ]),
  ]

  const workbook = await createProductWorkbook({
    dataSheetName: '상품업로드',
    headers,
    fields,
    seasons,
    guideRows,
    guideColumnWidths: [14, 16, 6, 10, 20, 36, 24],
    validationRows: 2000,
  })

  const fileName = `${safeFilePart(options.brandName)}_상품업로드양식_${todayStamp()}.xlsx`
  await downloadExcelWorkbook(workbook, fileName)
}
