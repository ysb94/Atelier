export const CARGO_LINE_LIST_COLUMNS = [
  { key: 'no', label: 'NO', widthClass: 'w-12', align: 'center', printWidth: '4%' },
  { key: 'name', label: '품명', widthClass: 'w-56', align: 'left', printWidth: '18%' },
  { key: 'photo', label: '사진', widthClass: 'w-16', align: 'center', printWidth: '6%' },
  { key: 'styleNo', label: '모델명', widthClass: 'w-24', align: 'center', printWidth: '9%' },
  { key: 'qty', label: '총수량', widthClass: 'w-20', align: 'center', printWidth: '6%' },
  { key: 'perBox', label: '박스당', widthClass: 'w-16', align: 'center', printWidth: '5%' },
  { key: 'boxes', label: '박스수', widthClass: 'w-16', align: 'center', printWidth: '5%' },
  { key: 'stow', label: '적재방식', widthClass: 'w-20', align: 'center', printWidth: '8%' },
  { key: 'slot', label: '창고자리', widthClass: 'w-20', align: 'center', printWidth: '6%' },
  { key: 'note', label: '비고', widthClass: 'w-24', align: 'left', printWidth: '8%' },
  { key: 'shippedAt', label: '선적일', widthClass: 'w-20', align: 'center', printWidth: '6%' },
  { key: 'latestSlot', label: '최신자리', widthClass: 'w-24', align: 'center', printWidth: '10%' },
  { key: 'latestBoxes', label: '최신박스수', widthClass: 'w-20', align: 'center', printWidth: '9%' },
] as const

export type CargoLineListColumnKey =
  (typeof CARGO_LINE_LIST_COLUMNS)[number]['key']
