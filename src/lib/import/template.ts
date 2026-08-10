import type { BrandField, FieldOwner } from '@/lib/types'
import { OWNER_LABEL } from '@/lib/import/fields'
import { filterFieldsForTemplate } from '@/lib/import/brand-field-template'

const TYPE_LABEL: Record<BrandField['type'], string> = {
  text: '텍스트',
  number: '숫자',
  list: '목록(쉼표 구분)',
  gender: '성별(남성/여성/공용)',
  season: '시즌 코드',
  image: '이미지 주소',
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
}) {
  const XLSX = await import('xlsx')
  const fields = filterFieldsForTemplate(
    options.fields,
    options.ownerFilter ?? 'all',
  ).sort((a, b) => a.order - b.order)

  if (fields.length === 0) {
    throw new Error('다운로드할 항목이 없습니다.')
  }

  const headers = fields.map((f) => f.label)
  const guideRows = [
    ['항목명', '유형', '필수', '부서', '예시', '설명'],
    ...fields.map((f) => [
      f.label,
      TYPE_LABEL[f.type],
      f.required ? 'Y' : 'N',
      OWNER_LABEL[f.owner] ?? f.owner,
      (f.systemKey && EXAMPLE[f.systemKey]) || '',
      f.systemKey
        ? '시스템 기본 항목'
        : '브랜드에서 추가한 사용자 항목',
    ]),
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([headers])
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)

  // 컬럼 너비 대략 조정
  uploadSheet['!cols'] = headers.map(() => ({ wch: 16 }))
  guideSheet['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 6 },
    { wch: 10 },
    { wch: 20 },
    { wch: 24 },
  ]

  XLSX.utils.book_append_sheet(workbook, uploadSheet, '상품업로드')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')

  const fileName = `${safeFilePart(options.brandName)}_상품업로드양식_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}
