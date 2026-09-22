/**
 * 사방넷 코드 엑셀 헤더·공식 파일 호환·선행 0·중복·미등록 M번호 검증.
 * 실행: npx tsx src/lib/codes/sabangnet-import.verify.ts
 */
import type { SabangnetField, SabangnetProduct, StyleRef } from '../types'
import { parseStyleNoList } from './style-no-list'
import {
  describeSabangnetHeader,
  findSabangnetHeader,
  prepareSabangnetFillRows,
  prepareSabangnetRows,
  toSabangnetProductInput,
} from './sabangnet-import'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function style(styleNo: string, id = styleNo): StyleRef {
  return { styleId: id, styleNo, name: `${styleNo} 상품` }
}

function product(
  code: string,
  styles: StyleRef[] = [],
): SabangnetProduct {
  return {
    id: `p-${code}`,
    brandId: 'brand',
    code,
    name: `${code} 이름`,
    values: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    styles,
  }
}

const styles = [
  style('M0001', 's1'),
  style('M0002', 's2'),
  style('M0511', 's511'),
]

const templateRows = [
  ['사방넷 코드', '사방넷 상품명', 'M번호 리스트'],
  ['1001', '셔링 아이보리', 'M0001'],
  ['1002', '래빗에코백 세트', 'M0001, M0002'],
  ['1003', '미연결', ''],
]

const officialRows = [
  ['사방넷 상품 대량수정', '', '', '', ''],
  ['품번코드 / [수정불가]', '상품명', '옵션1', 'M번호 리스트', '자체상품코드'],
  ['[수정불가]', '상품명을 입력하세요', '', '쉼표로 구분', '저장하지 않음'],
  ['1001', '셔링 아이보리', '아이보리', 'M0511', 'OLD-1'],
  ['1002', '래빗에코백 세트', '', 'M0001\nM0002', 'OLD-2'],
  ['1003', '미연결 상품', '', '', 'OLD-3'],
]

const header = findSabangnetHeader(officialRows)
assert(header, '공식 파일 헤더를 찾아야 한다')
assert(header.headerIndex === 1, '헤더는 2행')
assert(header.dataStartIndex === 3, '안내 3행을 건너뛴다')
assert(header.codeIdx === 0, '품번코드 열')
assert(header.nameIdx === 1, '상품명 열')
assert(header.stylesIdx === 3, 'M번호 리스트 열')

const newlineHeader = findSabangnetHeader([
  ['사방넷 상품 대량수정'],
  ['품번코드\n[수정불가]', '상품명', 'M번호 리스트'],
  ['[수정불가]', '상품명을 입력하세요', '쉼표로 구분'],
  ['1001', '셔링 아이보리', 'M0511'],
])
assert(newlineHeader?.headerIndex === 1, '줄바꿈 품번코드 헤더')
assert(newlineHeader?.dataStartIndex === 3, '줄바꿈 헤더 다음 안내행 건너뜀')

const officialGuideHeader = findSabangnetHeader([
  ['사방넷 상품 대량수정'],
  ['품번코드', '상품명', 'M번호 리스트'],
  [
    '▶사방넷에서 자동 발급된 코드로 변경이 불가합니다.',
    '▶255자까지 입력 가능합니다.',
    '카테고리',
  ],
  ['100008', 'Handle string bag', 'M2198'],
])
assert(officialGuideHeader?.dataStartIndex === 3, '▶ 안내행을 건너뛴다')

const officialPrepared = prepareSabangnetRows({
  rows: officialRows,
  styles,
  existingProducts: [],
})
assert(officialPrepared.length === 3, '공식 파일 데이터 3행')
assert(officialPrepared[0]?.styleNos[0] === 'M0511', '선행 0을 유지한다')
assert(officialPrepared[0]?.statusLabel === 'ok', 'M0511은 정상 연결')
assert(officialPrepared[1]?.styleIds.length === 2, '1:N 연결')
assert(
  officialPrepared[1]?.styleNos.join(',') === 'M0001,M0002',
  '줄바꿈 M번호 목록',
)
assert(officialPrepared[2]?.statusLabel === 'pending', '공란 M번호는 미연결')
assert(
  officialPrepared.every((row) => !row.message.includes('OLD')),
  '자체상품코드 열은 무시한다',
)

const templatePrepared = prepareSabangnetRows({
  rows: templateRows,
  styles,
  existingProducts: [],
})
assert(templatePrepared.length === 3, '3열 양식 3행')
assert(templatePrepared[0]?.statusLabel === 'ok', '단건 연결')
assert(templatePrepared[1]?.statusLabel === 'ok', '다중 연결')
assert(templatePrepared[2]?.statusLabel === 'pending', '양식 공란은 미연결')

const duplicateFile = prepareSabangnetRows({
  rows: [
    ...templateRows,
    ['1001', '중복', 'M0002'],
  ],
  styles,
  existingProducts: [],
})
assert(
  duplicateFile.some(
    (row) =>
      row.code === '1001' &&
      row.statusLabel === 'error' &&
      row.message.includes('파일 안에서 중복'),
  ),
  '파일 안 코드 중복',
)

const existingDb = prepareSabangnetRows({
  rows: templateRows,
  styles,
  existingProducts: [product('1001', [style('M0002', 's2')])],
})
assert(existingDb[0]?.statusLabel === 'update', '기존 코드는 상품명·M번호를 수정한다')
assert(existingDb[0]?.styleIds[0] === 's1', '기존 코드의 M번호를 파일 내용으로 바꾼다')

const unchangedDb = prepareSabangnetRows({
  rows: [
    ['사방넷 코드', '사방넷 상품명', 'M번호 리스트'],
    ['1001', '1001 이름', 'M0001'],
  ],
  styles,
  existingProducts: [product('1001', [style('M0001', 's1')])],
})
assert(
  unchangedDb[0]?.statusLabel === 'unchanged',
  '같은 내용의 기존 코드는 건너뛴다',
)

const twoColHeader = findSabangnetHeader([
  ['사방넷 코드', 'M번호 리스트'],
  ['1001', 'M0001'],
])
assert(twoColHeader?.codeIdx === 0, '2열 양식 코드 열')
assert(twoColHeader?.nameIdx == null, '2열 양식은 상품명 열이 없다')
assert(twoColHeader?.stylesIdx === 1, '2열 양식 M번호 열')
assert(
  describeSabangnetHeader(twoColHeader).includes('상품명은 기존 값'),
  '2열 양식 안내',
)

const twoColPrepared = prepareSabangnetRows({
  rows: [
    ['사방넷 코드', 'M번호 리스트'],
    ['1001', 'M0002'],
    ['1004', 'M0001'],
  ],
  styles,
  existingProducts: [product('1001', [style('M0001', 's1')])],
})
assert(twoColPrepared[0]?.statusLabel === 'update', '2열은 기존 상품명을 유지하고 M만 수정')
assert(twoColPrepared[0]?.name === '1001 이름', '상품명 열이 없으면 기존 상품명')
assert(twoColPrepared[0]?.styleIds[0] === 's2', '2열 M번호로 연결을 바꾼다')
assert(
  twoColPrepared[1]?.statusLabel === 'error' &&
    twoColPrepared[1].message.includes('신규 등록할 수 없습니다'),
  '상품명 없이 신규 코드는 등록하지 않는다',
)

const noHeader = prepareSabangnetRows({
  rows: [
    ['코드', '이름'],
    ['1001', '셔링'],
  ],
  styles,
  existingProducts: [],
})
assert(noHeader[0]?.statusLabel === 'error', '헤더가 없으면 파일 오류')

const rowDuplicateM = prepareSabangnetRows({
  rows: [
    ['사방넷 코드', '사방넷 상품명', 'M번호 리스트'],
    ['2001', '중복 M', 'M0001, M0001'],
  ],
  styles,
  existingProducts: [],
})
assert(
  rowDuplicateM[0]?.statusLabel === 'error' &&
    rowDuplicateM[0].message.includes('반복'),
  '행 안 M번호 중복',
)

const missingM = prepareSabangnetRows({
  rows: [
    ['사방넷 코드', '사방넷 상품명', 'M번호 리스트'],
    ['2002', '없는 M', 'M9999'],
  ],
  styles,
  existingProducts: [],
})
assert(
  missingM[0]?.statusLabel === 'error' &&
    missingM[0].message.includes('없는 M번호'),
  '미등록 M번호',
)

assert(
  parseStyleNoList('M0511, M0001').join(',') === 'M0511,M0001',
  'parseStyleNoList는 선행 0을 지치지 않는다',
)

const input = toSabangnetProductInput(officialPrepared[1]!)
assert(input.styleIds.join(',') === 's1,s2', '저장 입력은 style id 순서')
assert(!('qty' in input), '수량은 저장 입력에 없다')

const fillRows = prepareSabangnetFillRows({
  rows: [
    ['사방넷 코드', '사방넷 상품명', 'M번호 리스트'],
    ['1003', '미연결', 'M0511'],
    ['1001', '이미 연결', 'M0002'],
  ],
  styles,
  products: [
    product('1003'),
    product('1001', [style('M0001', 's1')]),
  ],
})
assert(fillRows[0]?.statusLabel === 'ok', '미연결만 채운다')
assert(
  fillRows[1]?.statusLabel === 'error' &&
    fillRows[1].message.includes('이미 M번호'),
  '이미 연결된 코드는 덮어쓰지 않는다',
)

const customFields: SabangnetField[] = [
  {
    id: 'f-code',
    brandId: 'brand',
    label: '품번',
    systemKey: 'code',
    type: 'text',
    order: 0,
  },
  {
    id: 'f-name',
    brandId: 'brand',
    label: '사방넷 상품명',
    systemKey: 'name',
    type: 'text',
    order: 1,
  },
  {
    id: 'f-styles',
    brandId: 'brand',
    label: 'M번호 리스트',
    systemKey: 'styles',
    type: 'text',
    order: 2,
  },
  {
    id: 'f-box',
    brandId: 'brand',
    label: '박스수',
    systemKey: null,
    type: 'number',
    order: 3,
  },
]
const kept = product('1001', [style('M0001', 's1')])
kept.values = { 'f-box': '3' }
const customPrepared = prepareSabangnetRows({
  rows: [
    ['품번', '사방넷 상품명', 'M번호 리스트', '박스수', '자체상품코드'],
    ['1001', '1001 이름', 'M0001', '', 'IGNORE'],
    ['1008', '새 상품', 'M0002', '1,200'],
    ['1009', '숫자 오류', 'M0002', 'abc'],
  ],
  styles,
  existingProducts: [kept],
  fields: customFields,
})
assert(
  customPrepared[0]?.statusLabel === 'unchanged' &&
    customPrepared[0].values?.['f-box'] === '3',
  '추가 항목 빈 칸은 기존 값을 유지한다',
)
assert(
  customPrepared[1]?.statusLabel === 'ok' &&
    customPrepared[1].values?.['f-box'] === '1200',
  '추가 숫자 항목의 콤마를 제거한다',
)
assert(
  customPrepared[2]?.statusLabel === 'error' &&
    customPrepared[2].message.includes('숫자'),
  '추가 숫자 항목의 문자는 오류다',
)
assert(
  customPrepared.every((row) => !row.message.includes('IGNORE')),
  '관리하지 않는 열은 저장하지 않는다',
)
const renamedOfficial = findSabangnetHeader(officialRows, customFields)
assert(renamedOfficial?.codeIdx === 0, '바꾼 헤더 이름 대신 품번코드 별칭을 읽는다')
assert(renamedOfficial?.custom.length === 0, '공식 파일의 나머지 열은 추가 항목이 아니다')

console.log('sabangnet-import.verify ok')
