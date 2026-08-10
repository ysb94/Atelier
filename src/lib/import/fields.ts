export type FieldOwner = 'common' | 'planning' | 'design' | 'md' | 'logistics'

export type FieldType =
  | 'text'
  | 'number'
  | 'list'
  | 'gender'
  | 'season'
  | 'image'

export type ImportField = {
  key: string
  label: string
  owner: FieldOwner
  type: FieldType
  /** 신규 상품을 만들 때 반드시 있어야 하는 값 */
  requiredForNew?: boolean
  aliases: string[]
}

export const OWNER_LABEL: Record<FieldOwner, string> = {
  common: '공통',
  planning: '기획',
  design: '디자인',
  md: 'MD',
  logistics: '물류',
}

export const OWNER_ORDER: FieldOwner[] = [
  'common',
  'planning',
  'design',
  'md',
  'logistics',
]

export const IMPORT_FIELDS: ImportField[] = [
  {
    key: 'styleNo',
    label: '품번',
    owner: 'common',
    type: 'text',
    requiredForNew: true,
    aliases: ['품번', '스타일번호', '스타일넘버', '품목코드', '상품코드', 'styleno', 'style', 'sku', 'code'],
  },
  {
    key: 'imageUrl',
    label: '대표이미지',
    owner: 'common',
    type: 'image',
    aliases: [
      '대표이미지',
      '이미지',
      '이미지주소',
      '이미지링크',
      '사진',
      '썸네일',
      'image',
      'imageurl',
      'thumbnail',
      'photo',
    ],
  },
  {
    key: 'name',
    label: '상품명',
    owner: 'planning',
    type: 'text',
    requiredForNew: true,
    aliases: ['상품명', '스타일명', '제품명', '품명', 'name', 'productname', 'stylename'],
  },
  {
    key: 'seasonCode',
    label: '시즌',
    owner: 'planning',
    type: 'season',
    requiredForNew: true,
    aliases: ['시즌', '시즌코드', 'season', 'seasoncode'],
  },
  {
    key: 'category',
    label: '카테고리',
    owner: 'planning',
    type: 'text',
    aliases: ['카테고리', '분류', '품목', '아이템', 'category', 'item'],
  },
  {
    key: 'gender',
    label: '성별',
    owner: 'planning',
    type: 'gender',
    aliases: ['성별', '구분', 'gender', 'sex'],
  },
  {
    key: 'plannedQty',
    label: '기획수량',
    owner: 'planning',
    type: 'number',
    aliases: ['기획수량', '계획수량', '기획물량', 'plannedqty', 'planqty'],
  },
  {
    key: 'targetCost',
    label: '목표원가',
    owner: 'planning',
    type: 'number',
    aliases: ['목표원가', '원가', '생산원가', '매입가', 'cost', 'targetcost'],
  },
  {
    key: 'planner',
    label: '기획 담당',
    owner: 'planning',
    type: 'text',
    aliases: ['기획담당', '기획자', 'md담당', 'planner'],
  },
  {
    key: 'colors',
    label: '컬러',
    owner: 'design',
    type: 'list',
    aliases: ['컬러', '색상', '컬러웨이', 'color', 'colors', 'colorway'],
  },
  {
    key: 'fabric',
    label: '원단',
    owner: 'design',
    type: 'text',
    aliases: ['원단', '소재', '겉감', 'fabric', 'material'],
  },
  {
    key: 'designer',
    label: '디자인 담당',
    owner: 'design',
    type: 'text',
    aliases: ['디자인담당', '디자이너', 'designer'],
  },
  {
    key: 'retailPrice',
    label: '소비자가',
    owner: 'md',
    type: 'number',
    aliases: ['소비자가', '판매가', '정가', '태그가', 'price', 'retailprice'],
  },
  {
    key: 'orderQty',
    label: '발주수량',
    owner: 'md',
    type: 'number',
    aliases: ['발주수량', '오더수량', '생산수량', 'orderqty', 'poqty'],
  },
  {
    key: 'channel',
    label: '판매채널',
    owner: 'md',
    type: 'text',
    aliases: ['판매채널', '채널', '유통', 'channel'],
  },
  {
    key: 'warehouse',
    label: '창고',
    owner: 'logistics',
    type: 'text',
    aliases: ['창고', '물류센터', '보관처', '매장', 'warehouse', 'location'],
  },
  {
    key: 'onHand',
    label: '재고수량',
    owner: 'logistics',
    type: 'number',
    aliases: ['재고', '재고수량', '보유재고', 'onhand', 'stock', 'inventory'],
  },
  {
    key: 'weightG',
    label: '단품무게(g)',
    owner: 'logistics',
    type: 'number',
    aliases: ['무게', '중량', '실중량', '단품무게', 'weight', 'weightg', 'netweight'],
  },
  {
    key: 'logisticsImageUrl',
    label: '물류이미지',
    owner: 'logistics',
    type: 'image',
    aliases: [
      '물류이미지',
      '물류사진',
      '물류이미지주소',
      '창고이미지',
      'logisticsimage',
      'logisticsimageurl',
    ],
  },
  {
    key: 'description',
    label: '비고',
    owner: 'common',
    type: 'text',
    aliases: ['비고', '설명', '메모', '특이사항', 'description', 'note', 'remark'],
  },
]

export const FIELD_MAP = new Map(IMPORT_FIELDS.map((f) => [f.key, f]))

export function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s_\-/().]/g, '')
    .trim()
}

/** 시트 헤더 이름으로 대응하는 시스템 필드를 추측한다. */
export function guessField(header: string): ImportField | null {
  const normalized = normalizeHeader(header)
  if (!normalized) return null

  for (const field of IMPORT_FIELDS) {
    if (normalizeHeader(field.label) === normalized) return field
    if (field.aliases.some((alias) => normalizeHeader(alias) === normalized)) {
      return field
    }
  }

  for (const field of IMPORT_FIELDS) {
    if (
      field.aliases.some(
        (alias) =>
          normalized.includes(normalizeHeader(alias)) &&
          normalizeHeader(alias).length >= 2,
      )
    ) {
      return field
    }
  }

  return null
}
