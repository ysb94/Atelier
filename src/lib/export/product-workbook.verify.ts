/**
 * 상품 양식 숨김 시트·이름 범위·드롭다운·SheetJS 왕복 검증.
 * 실행: npm run verify:brand-field-select-xlsx
 */
import {
  SELECT_COLUMN_FILL,
  SELECT_COLUMN_HEADER_FILL,
  SELECT_LIST_SHEET,
  createProductWorkbook,
  namedSelectRange,
  workbookDefinedNames,
  workbookToBuffer,
  worksheetValidations,
} from '@/lib/export/product-workbook'
import { parseFile } from '@/lib/import/parse'
import { prepareRows } from '@/lib/import/transform'
import type { BrandField, Season } from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const fields: BrandField[] = [
  {
    id: 'f-style',
    brandId: 'brand',
    label: '품번',
    systemKey: 'styleNo',
    type: 'text',
    owner: 'common',
    required: true,
    order: 0,
    level: 'style',
    options: [],
  },
  {
    id: 'f-gender',
    brandId: 'brand',
    label: '성별',
    systemKey: 'gender',
    type: 'gender',
    owner: 'planning',
    required: false,
    order: 1,
    level: 'style',
    options: [],
  },
  {
    id: 'f-season',
    brandId: 'brand',
    label: '시즌',
    systemKey: 'seasonCode',
    type: 'season',
    owner: 'planning',
    required: false,
    order: 2,
    level: 'style',
    options: [],
  },
  {
    id: 'f-pack',
    brandId: 'brand',
    label: '포장 유형',
    systemKey: null,
    type: 'select',
    owner: 'logistics',
    required: false,
    order: 3,
    level: 'style',
    options: [
      {
        id: 'o-box',
        brandId: 'brand',
        fieldId: 'f-pack',
        label: '상자',
        aliases: ['박스'],
        sortOrder: 0,
        isActive: true,
      },
      {
        id: 'o-old',
        brandId: 'brand',
        fieldId: 'f-pack',
        label: '예전포장',
        aliases: [],
        sortOrder: 1,
        isActive: false,
      },
    ],
  },
]

const seasons: Season[] = [
  {
    id: 'season-1',
    brandId: 'brand',
    code: '26SS',
    name: '26 봄여름',
    releaseTiming: '',
    year: 2026,
    status: 'active',
  },
]

const workbook = await createProductWorkbook({
  dataSheetName: '상품업로드',
  headers: fields.map((field) => field.label),
  rows: [['AT-001', '여성', '26SS', '상자']],
  fields,
  seasons,
  guideRows: [['항목명', '허용값']],
  validationRows: 20,
})

const listSheet = workbook.getWorksheet(SELECT_LIST_SHEET)
assert(listSheet, '숨김 선택목록 시트가 있어야 한다')
assert(listSheet.state === 'hidden', '선택목록 시트는 숨겨야 한다')

const names = workbookDefinedNames(workbook).model
const nameTexts = JSON.stringify(names)
assert(nameTexts.includes(namedSelectRange('f-pack')), '선택형 이름 범위가 있어야 한다')
assert(nameTexts.includes(namedSelectRange('f-gender')), '성별 이름 범위가 있어야 한다')
assert(nameTexts.includes(namedSelectRange('f-season')), '시즌 이름 범위가 있어야 한다')

const dataSheet = workbook.getWorksheet('상품업로드')
assert(dataSheet, '상품업로드 시트가 있어야 한다')
const validations = Object.keys(worksheetValidations(dataSheet).model ?? {})
assert(validations.length >= 3, '선택 열에 data validation이 있어야 한다')

function fillArgb(cell: { fill?: unknown }) {
  if (!cell.fill || typeof cell.fill !== 'object') return undefined
  if (!('fgColor' in cell.fill)) return undefined
  return (cell.fill as { fgColor?: { argb?: string } }).fgColor?.argb
}
assert(
  fillArgb(dataSheet.getCell(1, 2)) === SELECT_COLUMN_HEADER_FILL,
  '성별 헤더는 드롭다운 배경색이어야 한다',
)
assert(
  fillArgb(dataSheet.getCell(2, 2)) === SELECT_COLUMN_FILL,
  '성별 입력칸은 드롭다운 배경색이어야 한다',
)
assert(
  fillArgb(dataSheet.getCell(1, 3)) === SELECT_COLUMN_HEADER_FILL,
  '시즌 헤더는 드롭다운 배경색이어야 한다',
)
assert(
  fillArgb(dataSheet.getCell(1, 4)) === SELECT_COLUMN_HEADER_FILL,
  '선택형 헤더는 드롭다운 배경색이어야 한다',
)
assert(
  fillArgb(dataSheet.getCell(1, 1)) !== SELECT_COLUMN_HEADER_FILL,
  '품번 열은 드롭다운 배경색이 아니어야 한다',
)

const buffer = await workbookToBuffer(workbook)
const file = new File([buffer as BlobPart], 'template.xlsx')
const sheets = await parseFile(file)
const upload = sheets.find((sheet) => sheet.name === '상품업로드')
assert(upload, 'SheetJS가 상품업로드 시트를 읽어야 한다')

const ok = prepareRows({
  rows: upload.rows,
  fields,
  existingStyles: [],
  seasons,
})
assert(ok[0]?.status === 'new', '생성 양식을 다시 올리면 통과해야 한다')
assert(ok[0]?.applied.gender === 'W', '성별 표시값은 기존 파서가 읽는다')
assert(ok[0]?.applied['f-pack'] === '상자', '선택형 표시값은 정규 선택명으로 저장한다')

const bad = prepareRows({
  rows: [upload.rows[0] ?? [], ['AT-002', '여성', '26SS', '없는값']],
  fields,
  existingStyles: [],
  seasons,
})
assert(bad[0]?.status === 'error', '목록 밖 값은 재업로드에서도 오류다')

console.log('verify:brand-field-select-xlsx ok')
