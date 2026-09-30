export const CARGO_LINE_LIST_COLUMNS = [
  { key: 'no', label: 'NO', widthClass: 'w-12', align: 'center', printLabel: 'NO' },
  { key: 'name', label: '품명', widthClass: 'w-56', align: 'left', printLabel: '품명' },
  { key: 'photo', label: '사진', widthClass: 'w-16', align: 'center', printLabel: '사진' },
  { key: 'qty', label: '총수량', widthClass: 'w-20', align: 'center', printLabel: '총수량' },
  { key: 'perBox', label: '박스당', widthClass: 'w-16', align: 'center', printLabel: '박스당' },
  { key: 'boxes', label: '박스수', widthClass: 'w-16', align: 'center', printLabel: '박스수' },
  { key: 'styleNo', label: '모델명', widthClass: 'w-24', align: 'center', printLabel: '모델명' },
  { key: 'stow', label: '적재방식', widthClass: 'w-20', align: 'center', printLabel: '적재 방식' },
  { key: 'slot', label: '창고자리', widthClass: 'w-20', align: 'center', printLabel: '창고 자리' },
  { key: 'note', label: '비고', widthClass: 'w-24', align: 'left', printLabel: '비고' },
  { key: 'shippedAt', label: '선적일', widthClass: 'w-20', align: 'center', printLabel: '선적일' },
  { key: 'latestSlot', label: '최신자리', widthClass: 'w-24', align: 'center', printLabel: '최신 자리' },
  { key: 'latestBoxes', label: '최신박스수', widthClass: 'w-20', align: 'center', printLabel: '최신 박스수' },
] as const

export type CargoLineListColumnKey =
  (typeof CARGO_LINE_LIST_COLUMNS)[number]['key']

/** 창고정리용은 모델명을 총수량 바로 왼쪽에 둔다. 하차용 순서는 바꾸지 않는다. */
const CARGO_WAREHOUSE_COLUMN_KEYS = [
  'no',
  'name',
  'photo',
  'styleNo',
  'qty',
  'perBox',
  'boxes',
  'stow',
  'slot',
  'note',
  'shippedAt',
  'latestSlot',
  'latestBoxes',
] as const satisfies readonly CargoLineListColumnKey[]

export const CARGO_WAREHOUSE_LINE_LIST_COLUMNS = CARGO_WAREHOUSE_COLUMN_KEYS.map(
  (key) => {
    const column = CARGO_LINE_LIST_COLUMNS.find((item) => item.key === key)
    if (!column) throw new Error(`창고정리용 열이 없습니다: ${key}`)
    return column
  },
)
