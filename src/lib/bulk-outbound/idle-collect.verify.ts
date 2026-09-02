/**
 * 대기 업체 상품명·수량 붙여넣기 검증.
 */
import {
  applyIdleCollectStyleLookup,
  idleCollectAllLinked,
  idleCollectBackupEntries,
  idleCollectDisplayRows,
  keepIdleCollectLinks,
  parseIdleCollectText,
} from '@/lib/bulk-outbound/idle-collect'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const pasted = `미니 데일리백팩 크림	5
미니 데일리백팩 레오파드 딥브라운	5
미니 데일리백팩 레오파드 선셋로즈	5
스텔릭 스트링 백팩 네뷸라	5
스텔릭 스트링 백팩 블랙	5
스텔릭 스트링 백팩 로즈퍼플	5
커브드 셔링 백팩 화이트	5
커브드 셔링 백팩 실버그레이	5
커브드 셔링 백팩 블랙	5
레나 숄더백 화이트	5
레나 숄더백 라임민트	5
레나 숄더백 블랙	5
루즈핏 숄더백 빈티지 아이보리	5
루즈핏 숄더백 레오파드 모브블루	5
	
투포켓 데일리백팩 그레이	7
래빗에코백 트와일라잇 블랙	5
투포켓 데일리백팩 블랙	2
미니 플랩백팩 글리터리 블랙	2
미니 데일리백팩 크림	5
스파 화이트도트	3
스파 스프링 그린	3
스파 와플 네이비	3
베파 와플 그린	3
스파 와플 레드	2
베파 와플 블랙	3
미니 플랩백팩 블랙	2
스파 누빔	3
베파 니트데이지 퍼플	3
미니 데일리백팩 블랙	2
스파 와플 블랙	3
미니스 데이지 레드	3
스파 빅데이지 네이비	2
스파 리본 퀼트 실버	3
베파 리본 퀼트 블랙	3
베파 리본 퀼트 실버	3
베파 리본 퀼트 아이보리	3
스파 리본 퀼트 아이보리	3
스파 리본 퀼트 블랙	3`

const parsed = parseIdleCollectText(pasted)
assert(!parsed.error, parsed.error ?? '파서 오류')
assert(parsed.rows.length === 38, `38행이어야 하는데 ${parsed.rows.length}행`)
assert(parsed.rows[0]?.productName === '미니 데일리백팩 크림', '첫 행 상품명')
assert(parsed.rows[0]?.qty === 5, '첫 행 수량')
assert(parsed.rows[14]?.productName === '투포켓 데일리백팩 그레이', '빈 줄 다음 행')
assert(parsed.rows[14]?.qty === 7, '투포켓 그레이 수량')
assert(parsed.rows.at(-1)?.productName === '스파 리본 퀼트 블랙', '마지막 행')
assert(
  parsed.rows.filter((row) => row.productName === '미니 데일리백팩 크림').length ===
    2,
  '같은 상품명 두 행 유지',
)

const spaced = parseIdleCollectText('미니 데일리백팩 크림 5\n스파 누빔 3')
assert(spaced.rows.length === 2, '공백 구분 2행')
assert(spaced.rows[1]?.productName === '스파 누빔', '공백 구분 상품명')
assert(spaced.rows[1]?.qty === 3, '공백 구분 수량')

const headed = parseIdleCollectText('상품명\t수량\n가방\t3')
assert(headed.rows.length === 1 && headed.rows[0]?.productName === '가방', '헤더 행')

const kept = keepIdleCollectLinks(
  [{ productName: '가방', qty: 4, styleNo: '', styleId: '' }],
  [{ productName: '가방', qty: 3, styleNo: 'M0213', styleId: 's1' }],
)
assert(kept[0]?.styleNo === 'M0213', '같은 상품명 M번호 유지')

const resolved = applyIdleCollectStyleLookup(
  [
    { productName: '미니 데일리백팩 크림', qty: 5, styleNo: '', styleId: '' },
    { productName: '없는상품', qty: 1, styleNo: '', styleId: '' },
  ],
  {
    byName: new Map([
      [
        '미니 데일리백팩 크림',
        [{ styleId: 's1', styleNo: 'M0213', name: '미니 데일리백팩 크림' }],
      ],
    ]),
  },
)
assert(resolved[0]?.styleNo === 'M0213', '등록 시 상품명으로 M번호')
assert(resolved[1]?.styleNo === '', '없는 상품은 미연결')

const backupRows = [
  { productName: '크림', qty: 5, styleNo: 'M0213', styleId: 's1' },
  { productName: '크림2', qty: 3, styleNo: 'M0213', styleId: 's1' },
  { productName: '블랙', qty: 2, styleNo: 'M0048', styleId: 's2' },
]
assert(idleCollectAllLinked(backupRows), '전부 연결')
assert(!idleCollectAllLinked(resolved), '미연결 있으면 백업 불가')
const entries = idleCollectBackupEntries(backupRows)
assert(entries.length === 2, '같은 M번호는 합산')
assert(
  entries.find((item) => item.styleId === 's1')?.quantity === 8,
  '같은 상품 수량 합',
)

const displayed = idleCollectDisplayRows([
  { productName: '연결1', qty: 1, styleNo: 'M0001', styleId: 's1' },
  { productName: '미연결1', qty: 2, styleNo: '', styleId: '' },
  { productName: '연결2', qty: 3, styleNo: 'M0002', styleId: 's2' },
  { productName: '미연결2', qty: 4, styleNo: 'M0003', styleId: '' },
])
assert(displayed.map((item) => item.row.productName).join(',') === '미연결1,미연결2,연결1,연결2', '미연결이 위')
assert(displayed[0]?.index === 1 && displayed[1]?.index === 3, '원래 행 위치 유지')

console.log('idle-collect paste ok')
