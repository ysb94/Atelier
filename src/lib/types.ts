export type Brand = {
  id: string
  slug: string
  name: string
  nameKo: string
  description: string
  color: string
  styleCount: number
  /** 브랜드 설립/탄생 연도 */
  foundedYear: number
  /** data URL 또는 원격 URL. 없으면 이름 앞 2글자 아바타 */
  logoUrl?: string | null
  createdAt: string
  updatedAt: string
}

/** 브랜드 생성·수정 시 UI/API 입력 (id·집계 필드는 서버/저장소가 관리) */
export type BrandInput = {
  slug: string
  name: string
  nameKo: string
  description: string
  color: string
  foundedYear: number
  logoUrl?: string | null
}

/**
 * 출시 기획 묶음은 기획팀 관점만 본다.
 * 생산·판매·단종은 묶음이 아니라 상품 하나하나의 상태다.
 */
export type SeasonStatus = 'active' | 'archived'

/** 예전 4단계(기획·생산·판매·종료) 데이터를 두 값으로 옮긴다. */
export const LEGACY_SEASON_STATUS_MAP: Record<string, SeasonStatus> = {
  planning: 'active',
  in_production: 'active',
  selling: 'active',
  closed: 'archived',
  active: 'active',
  archived: 'archived',
}

/**
 * 출시 기획. 예전엔 시즌 코드(26SS) 중심이었지만,
 * 실제로는 "26.03 말 SS", "1학기 신학기"처럼 출시 묶음이다.
 * code는 URL·가져오기 호환용으로 앱이 만든다.
 */
export type Season = {
  id: string
  brandId: string
  /** 내부·URL·가져오기 호환용. 사용자에게 직접 받지 않는다. */
  code: string
  /** 기획 이름. 예: SS, 1학기 신학기, 홀리데이 */
  name: string
  /** 출시 예정 자유 문구. 예: 26.03 말, 일정 미정 */
  releaseTiming: string
  year: number
  status: SeasonStatus
}

/** 사용자가 적는 출시 기획 입력. code·year는 저장 시 자동 채운다. */
export type SeasonInput = {
  name: string
  releaseTiming: string
  /** 수정 시 보조. 없으면 active */
  status?: SeasonStatus
}

export function formatSeasonLabel(season: {
  name: string
  releaseTiming?: string | null
  code?: string
}): string {
  const timing = season.releaseTiming?.trim()
  const name = season.name.trim()
  if (timing && name) return `${timing} · ${name}`
  if (timing) return timing
  if (name) return name
  return season.code?.trim() || '출시 기획'
}

/** 필드가 붙는 상품 계층. SKU 층은 자리만 마련하고 이번엔 style만 쓴다. */
export type FieldLevel = 'style' | 'sku'

export type StyleStatus =
  'draft' | 'design' | 'sampling' | 'confirmed' | 'ordered' | 'received'

export type FieldOwner = 'common' | 'planning' | 'design' | 'md' | 'logistics'

export type FieldType =
  | 'text'
  | 'number'
  | 'list'
  | 'gender'
  | 'season'
  /** 이미지 주소를 담는 항목. 값은 공개 URL 문자열이다. */
  | 'image'

/** 브랜드별 업로드 양식 항목(헤더) 정의 */
export type BrandField = {
  id: string
  brandId: string
  label: string
  /** 시스템 필드 키. 사용자 추가 항목은 null */
  systemKey: string | null
  type: FieldType
  owner: FieldOwner
  required: boolean
  order: number
  /** 값이 붙는 계층. 기본 style */
  level: FieldLevel
}

/** 사용자 추가 항목 입력 */
export type BrandFieldInput = {
  label: string
  type: FieldType
  owner: FieldOwner
  required?: boolean
  level?: FieldLevel
}

export type Style = {
  id: string
  brandId: string
  seasonId: string
  styleNo: string
  name: string
  category: string
  gender: 'W' | 'M' | 'U'
  colors: string[]
  /** 미입력과 0을 구분한다. null이면 아직 아무도 입력하지 않은 값 */
  targetCost: number | null
  plannedQty: number | null
  retailPrice: number | null
  status: StyleStatus
  designer?: string
  planner?: string
  thumbnailColor: string
  description?: string
  /** 단품 실중량(g). 코드 포장 무게 제안의 기준값 */
  weightG?: number | null
  /**
   * 타입 속성이 아닌 항목 값.
   * 키는 field.systemKey 또는 field.id.
   */
  values: Record<string, string>
  /** 가져오기에서 시스템 필드로 매핑되지 않은 컬럼: 원본 헤더 이름 -> 값 */
  customFields?: Record<string, string>
}

export type StyleInput = {
  seasonId: string
  styleNo: string
  name: string
  category?: string
  gender?: 'W' | 'M' | 'U'
  colors?: string[]
  targetCost?: number | null
  plannedQty?: number | null
  retailPrice?: number | null
  status?: StyleStatus
  designer?: string
  planner?: string
  description?: string
  weightG?: number | null
  values?: Record<string, string>
  customFields?: Record<string, string>
}

/**
 * 기획안. 아직 상품이 아니라서 품번도 상품명도 미정일 수 있다.
 * 출시가 확정되면 상품으로 승격하고, 그때 품번이 발급된다.
 */
export type ProductDraftStatus = 'open' | 'confirmed' | 'dropped'

/** 기획 단계의 컬러 한 줄. 확정 시 SKU가 될 자리 */
export type DraftColorRow = {
  id: string
  name: string
  orderQty: number | null
}

/** 기획안에 함께 붙여 판매할 상품 한 줄 */
export type DraftOptionRow = {
  id: string
  styleId: string
  /** 상품이 나중에 바뀌거나 삭제되어도 보이게 하는 이름 스냅샷 */
  name: string
  price: number | null
}

/** 원가 통화. 중국 생산이 많아 위안이 기본이다. */
export type CostCurrency = 'CNY' | 'USD' | 'KRW'

/** 값과 "확인 완료" 표시가 함께 다니는 스펙 항목 */
export type DraftSpec = {
  value: string
  confirmed: boolean
  /** 정형 입력으로 담기 어려운 예외 설명 */
  note: string
}

export type DraftSpecKey = 'size' | 'weight' | 'fabric' | 'coating'

export type ProductDraft = {
  id: string
  brandId: string
  /** 회의에서 부르는 참조 번호. 품번이 아니며 품번이 되지도 않는다. */
  draftNo: string
  seasonId: string | null
  status: ProductDraftStatus
  owner: string
  nameKo: string
  nameEn: string
  /** data URL. 기획 시트의 실물 사진 */
  imageUrl: string | null
  colors: DraftColorRow[]
  /** 진척 체크. 서로 독립적으로 켜진다. */
  sampleDone: boolean
  orderDone: boolean
  photoSampleDone: boolean
  /** 진척과 달리 켜지면 멈추는 표시 */
  held: boolean
  holdReason: string
  heldAt: string | null
  targetCost: number | null
  costCurrency: CostCurrency
  /** 공장과 협의가 끝나 단가가 확정되었는지 */
  costConfirmed: boolean
  retailPrice: number | null
  /** 할인 판매가. 할인율은 화면에서 계산하지 않는다. */
  discountPrice: number | null
  originCountry: string
  registerType: string
  openType: string
  openTypeDetail: string
  releaseIssue: string
  specs: Record<DraftSpecKey, DraftSpec>
  hasOptions: boolean
  options: DraftOptionRow[]
  note: string
  /** 승격된 상품. 아직 없으면 null */
  promotedStyleId: string | null
  createdAt: string
  updatedAt: string
}

export type ProductDraftInput = Omit<
  ProductDraft,
  'id' | 'brandId' | 'draftNo' | 'createdAt' | 'updatedAt' | 'promotedStyleId'
>

export const DRAFT_STATUS_LABEL: Record<ProductDraftStatus, string> = {
  open: '검토중',
  confirmed: '출시 확정',
  dropped: '드롭',
}

export const DRAFT_SPEC_LABEL: Record<DraftSpecKey, string> = {
  size: 'Size',
  weight: 'Weight',
  fabric: 'Fabric',
  coating: 'Coating',
}

export const COST_CURRENCY_LABEL: Record<CostCurrency, string> = {
  CNY: '위안 (CNY)',
  USD: '달러 (USD)',
  KRW: '원 (KRW)',
}

/** 기획안 선택형 필드. 오타 방지용 고정 목록. 나중에 설정으로 옮길 수 있다. */
export const DRAFT_OWNER_OPTIONS = [
  '김기획',
  '이디자인',
  '박MD',
  '최물류',
] as const

export const DRAFT_ORIGIN_OPTIONS = [
  '중국 OEM',
  '국내 생산',
  '베트남 OEM',
  '미정',
] as const

export const DRAFT_REGISTER_TYPE_OPTIONS = [
  '모음등록',
  '단품등록',
  '세트등록',
] as const

export const DRAFT_OPEN_TYPE_OPTIONS = [
  '단독오픈',
  '동시오픈',
  '순차오픈',
] as const

export const DRAFT_OPEN_DETAIL_OPTIONS = [
  '카카오선물하기',
  '자사몰',
  '무신사',
  '29CM',
  '지그재그',
  '오프라인',
  '전체',
] as const

/** 자사 발급 바코드(88코드)와 거래처 부여 코드를 같은 구조로 다룬다 */
export type ProductCodeKind = 'own' | 'partner'

/** 코드 하나에 담기는 단품과 수량 */
export type ProductCodeComponent = {
  styleId: string
  /** 단품이 삭제되어도 목록에 남기기 위한 스냅샷 */
  styleNo: string
  qty: number
}

/**
 * 바코드 행의 시스템 항목. code·name은 등록 식별과 생성에 반드시 필요하다.
 * 나머지는 헤더 관리에서 숨겨도 DB 값은 보존한다.
 */
export type BarcodeFieldSystemKey =
  | 'code'
  | 'name'
  | 'components'
  | 'weightG'
  | 'widthCm'
  | 'depthCm'
  | 'heightCm'
  | 'note'

export type BarcodeFieldType = 'text' | 'number'

export type BarcodeField = {
  id: string
  brandId: string
  label: string
  systemKey: BarcodeFieldSystemKey | null
  type: BarcodeFieldType
  order: number
}

export type BarcodeFieldInput = {
  label: string
  type: BarcodeFieldType
}

/** 자사 바코드가 사용되는 판매처·납품처(면세점, 무신사 등) */
export type CodeUsageTarget = {
  id: string
  brandId: string
  name: string
  /** 사용 종료해도 기존 바코드 연결 이력은 보존한다. */
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export type CodeUsageTargetInput = {
  name: string
}

/** 사용처에 등록된 자사 바코드의 운영 상태 */
export type CodeUsageStatus = 'active' | 'paused'

/**
 * 사용처 × 자사 바코드 운영 기록.
 * 자사 바코드 마스터와 분리되어, 사용처 화면에서만 추가·상태 변경한다.
 */
export type CodeUsageAssignment = {
  id: string
  brandId: string
  productCodeId: string
  usageTargetId: string
  status: CodeUsageStatus
  createdAt: string
  updatedAt: string
}

export type CodeUsageAssignmentInput = {
  productCodeId: string
  usageTargetId: string
  status?: CodeUsageStatus
}

/**
 * 출고 거래 단위. 재고를 갖지 않고 "이 구성으로 묶어 이 라벨을 붙인다"를 정의한다.
 * 단품 하나만 나가는 경우도 구성 1줄인 코드로 취급한다.
 * 사용처 연결은 CodeUsageAssignment로 관리한다.
 */
export type ProductCode = {
  id: string
  brandId: string
  kind: ProductCodeKind
  code: string
  name: string
  /** 포장 후 실측 무게(g). 미입력이면 null */
  weightG: number | null
  /** 포장 규격(cm). 소수 첫째 자리까지 */
  widthCm: number | null
  depthCm: number | null
  heightCm: number | null
  note: string
  /** barcode_fields의 사용자 추가 항목 id -> 값 */
  values: Record<string, string>
  components: ProductCodeComponent[]
  createdAt: string
  updatedAt: string
}

export type ProductCodeInput = {
  kind: ProductCodeKind
  code: string
  name: string
  weightG: number | null
  widthCm: number | null
  depthCm: number | null
  heightCm: number | null
  note: string
  /** barcode_fields의 사용자 추가 항목 id -> 값 */
  values: Record<string, string>
  components: ProductCodeComponent[]
}

/** 사방넷 품목명을 찾을 때 적용하는 exact-match 단계 */
export type InvoiceNameRuleMatchType =
  'own_product_code' | 'product_name' | 'product_and_item'

export type InvoiceNameRuleAction = 'rename' | 'exception'

/** 데이터 시트 상품을 가리키는 가벼운 참조. 연결은 styleId, 표시는 styleNo·name. */
export type StyleRef = {
  styleId: string
  styleNo: string
  name: string
}

/** 품목·옵션 조합에서 나가는 구성의 역할 */
export type InvoiceOptionComponentRole =
  | 'main'
  | 'included'
  | 'required'
  | 'paid_add'

export const INVOICE_OPTION_COMPONENT_ROLE_LABEL: Record<
  InvoiceOptionComponentRole,
  string
> = {
  main: '본품',
  included: '기본포함',
  required: '필수옵션',
  paid_add: '유료추가',
}

export const INVOICE_OPTION_COMPONENT_ROLE_SHORT: Record<
  InvoiceOptionComponentRole,
  string
> = {
  main: '본품',
  included: '포함',
  required: '필수',
  paid_add: '추가',
}

/** 확정된 조합에서 실제로 나가는 M번호 1건 */
export type InvoiceOptionMapComponent = {
  id: string
  mapId: string
  style: StyleRef
  role: InvoiceOptionComponentRole
  quantity: number
  sortOrder: number
}

/**
 * 사방넷 원본 품목명·내품명 조합을 본품 + 구성품 M번호로 연결하는 기준.
 * 쇼핑몰명을 비우면 모든 쇼핑몰에 적용한다.
 */
export type InvoiceOptionMap = {
  id: string
  brandId: string
  mallName: string
  normalizedMallName: string
  productName: string
  normalizedProductName: string
  itemName: string
  normalizedItemName: string
  ownProductCode: string
  normalizedOwnProductCode: string
  /** 승인된 변환 내품명. 비우면 원문을 유지한다. */
  displayItemName: string
  isActive: boolean
  note: string
  components: InvoiceOptionMapComponent[]
  createdAt: string
  updatedAt: string
}

export type InvoiceItemNameRuleScope = 'global' | 'main_style' | 'lookup_key'
export type InvoiceItemNameRuleAction = 'delete' | 'components'

export const INVOICE_ITEM_NAME_RULE_SCOPE_LABEL: Record<
  InvoiceItemNameRuleScope,
  string
> = {
  global: '품목명 안 봐도 됨',
  main_style: '본품별로 봐야 함',
  lookup_key: '조회 키 선택',
}

export const INVOICE_ITEM_NAME_RULE_ACTION_LABEL: Record<
  InvoiceItemNameRuleAction,
  string
> = {
  delete: '지우기',
  components: '구성품으로 설정',
}

/** 내품명 부속품 인식 사전의 규칙 종류 */
export type InvoiceAccessoryRuleType =
  | 'label'
  | 'color'
  | 'token'
  | 'ignore'
  | 'default'

export const INVOICE_ACCESSORY_RULE_TYPE_LABEL: Record<
  InvoiceAccessoryRuleType,
  string
> = {
  label: '라벨 별칭',
  color: '색상 별칭',
  token: '문구 → M번호',
  ignore: '버릴 조각',
  default: '본품 기본 종류',
}

/**
 * 옵션 문구에서 부속품 M번호를 찾는 사전 1줄.
 * 인식 결과는 저장하지 않고 매 파일마다 다시 계산한다.
 */
export type InvoiceAccessoryRule = {
  id: string
  brandId: string
  ruleType: InvoiceAccessoryRuleType
  pattern: string
  normalizedPattern: string
  accessoryKind: string
  namePrefix: string
  colorName: string
  targetStyle: StyleRef | null
  isActive: boolean
  note: string
  createdAt: string
  updatedAt: string
}

/** 내품명 규칙이 추가하는 출고 구성품 1건 */
export type InvoiceItemNameRuleComponent = {
  id: string
  ruleId: string
  style: StyleRef
  role: Exclude<InvoiceOptionComponentRole, 'main'>
  quantity: number
  sortOrder: number
}

/**
 * 유효 내품명을 지우거나 구성품 M번호로 연결하는 기준.
 * global은 본품을 보지 않고, main_style은 확정 본품 styles.id로 나눈다.
 * lookup_key는 확정 본품과 품목명 단계 조회 키 exact 조합으로 나눈다.
 */
export type InvoiceItemNameRule = {
  id: string
  brandId: string
  scope: InvoiceItemNameRuleScope
  mainStyle: StyleRef | null
  itemName: string
  normalizedItemName: string
  productLookupKey: string
  normalizedProductLookupKey: string
  action: InvoiceItemNameRuleAction
  isActive: boolean
  note: string
  components: InvoiceItemNameRuleComponent[]
  createdAt: string
  updatedAt: string
}

/** 품목명 맨 앞 [태그]의 브랜드별 역할. 원문과 출고구성은 바꾸지 않는다. */
export type InvoiceProductNameTagRole =
  | 'product_composition'
  | 'event_marketing'
  | 'composition_gift'
  | 'identity_condition'
  | 'unknown'

export const INVOICE_PRODUCT_NAME_TAG_ROLE_LABEL: Record<
  InvoiceProductNameTagRole,
  string
> = {
  product_composition: '상품 구성',
  event_marketing: '행사/마케팅',
  composition_gift: '증정/사은',
  identity_condition: '상품 특징',
  unknown: '미분류',
}

export type InvoiceProductNameTagRoleEntry = {
  id: string
  brandId: string
  tagText: string
  normalizedTag: string
  role: InvoiceProductNameTagRole
  isActive: boolean
  note: string
  createdAt: string
  updatedAt: string
}

/**
 * 사방넷 원본 품목명(+내품명 문맥)을 본품 styles.id로 연결하는 품목명 전용 기준.
 * itemNameContext는 조회 키일 뿐 출력 내품명이 아니다.
 */
export type InvoiceProductNameMap = {
  id: string
  brandId: string
  mallName: string
  normalizedMallName: string
  productName: string
  normalizedProductName: string
  itemNameContext: string
  normalizedItemNameContext: string
  ownProductCode: string
  normalizedOwnProductCode: string
  /** 기존 원장 조회 키. 비우면 쇼핑몰+품목명+문맥 조합으로 매칭한다. */
  lookupKey: string
  normalizedLookupKey: string
  style: StyleRef
  isActive: boolean
  note: string
  createdAt: string
  updatedAt: string
}

/**
 * 사방넷 원본 쇼핑몰·품목명·내품명 exact 조합을 최종 송장에서 빼는 기준.
 * 본품 연결이 없고, 모든 쇼핑몰에 적용하는 규칙은 두지 않는다.
 */
export type InvoiceProductNameExclusion = {
  id: string
  brandId: string
  mallName: string
  normalizedMallName: string
  productName: string
  normalizedProductName: string
  itemName: string
  normalizedItemName: string
  isActive: boolean
  note: string
  createdAt: string
  updatedAt: string
}

/** 브랜드별 CJ 송장 품목명 변환 기준 */
export type InvoiceNameRule = {
  id: string
  brandId: string
  matchType: InvoiceNameRuleMatchType
  sourceValue: string
  normalizedSourceValue: string
  action: InvoiceNameRuleAction
  /** rename일 때 공식 상품. exception이면 null */
  targetStyleId: string | null
  /** styles.style_no (M번호). exception이면 null */
  targetStyleNo: string | null
  /** 연결된 상품의 현재 이름. exception이면 null */
  targetName: string | null
  isActive: boolean
  /** 기존 엑셀을 검증 중인 임시 규칙. 운영 확정 규칙과 구분한다. */
  isTest: boolean
  note: string
  createdAt: string
  updatedAt: string
}

/** 사은품 요청 건 안의 대상 원본 품목명 1건 */
export type InvoiceGiftItem = {
  id: string
  requestId: string
  productName: string
  normalizedProductName: string
  /** @deprecated 사은품은 별도 행으로 나가며 쓰지 않는다 */
  prefix: string
  /** 나갈 사은품 제품(M번호 참조) */
  outgoingProducts: StyleRef[]
  /** 나가는 제품이 여러 개일 때 랜덤 출고 여부 */
  isRandom: boolean
}

/** 사은품을 몇 개 낼지. 요청 건(행사) 단위로 정한다. */
export type InvoiceGiftCountBasis =
  | 'per_order'
  | 'per_product'
  | 'per_quantity'

/** 같은 합포장에서 사은품 개수를 줄이는 방식. */
export type InvoiceGiftMergeBasis = 'per_order' | 'per_shipment'

/** 선착순 행사 한도를 M번호별로 둘지, 모든 M번호의 실제 사은품 합계로 둘지. */
export type InvoiceGiftLimitMode = 'per_style' | 'shared_total'

/** 요청 건의 M번호별 선착순 행사 배정수량 */
export type InvoiceGiftQuota = {
  id: string
  requestId: string
  styleId: string
  styleNo: string
  styleName: string
  quantityLimit: number
  /** 활성 배정 수. 목록 조회 시 집계 */
  usedCount: number
  remainingCount: number
}

/**
 * 사은품 1개 단위 영속 배정.
 * 수령인·전화·주소는 저장하지 않는다.
 */
export type InvoiceGiftAllocation = {
  id: string
  requestId: string
  itemId: string
  styleId: string
  styleNo: string
  styleName: string
  mallName: string
  customerOrderNo: string
  /** YYYY-MM-DD HH:MM 또는 빈 문자열 */
  orderedAt: string
  orderFingerprint: string
  allocationKey: string
  giftSlotIndex: number
  sourceFileName: string
  cancelledAt: string | null
  createdAt: string
}

/**
 * 쇼핑몰 사은품 증정 요청 건.
 * 사방넷 주문일시가 행사 기간 안인 주문에만 사은품 행을 추가한다.
 */
export type InvoiceGiftRequest = {
  id: string
  brandId: string
  title: string
  taskNo: string
  mallName: string
  normalizedMallName: string
  /** YYYY-MM-DD HH:MM — 사방넷 주문일시와 같은 한국 벽시계 */
  startsAt: string
  /** YYYY-MM-DD HH:MM — 양끝 포함 */
  endsAt: string
  countBasis: InvoiceGiftCountBasis
  mergeBasis: InvoiceGiftMergeBasis
  /** true이면 선택한 한도 방식 안에서 주문일시 선착순으로 배정한다 */
  usesFirstCome: boolean
  firstComeLimitMode: InvoiceGiftLimitMode
  /** shared_total일 때 실제 사은품 전체 합계 한도 */
  firstComeTotalLimit: number | null
  /** 요청 건의 활성 배정 원장 행 수 */
  firstComeUsedCount: number
  /** 취소 이력을 포함해 배정 원장이 한 번이라도 생겼는지 */
  hasAllocationHistory: boolean
  isActive: boolean
  note: string
  items: InvoiceGiftItem[]
  quotas: InvoiceGiftQuota[]
  createdAt: string
  updatedAt: string
}

export type InvoiceGiftRequestStatus =
  | 'scheduled'
  | 'running'
  | 'ended'
  | 'paused'

/** @deprecated InvoiceGiftItem 사용 */
export type InvoicePrefixItem = InvoiceGiftItem
/** @deprecated InvoiceGiftCountBasis 사용 */
export type InvoicePrefixCountBasis = InvoiceGiftCountBasis
/** @deprecated InvoiceGiftMergeBasis 사용 */
export type InvoicePrefixMergeBasis = InvoiceGiftMergeBasis
/** @deprecated InvoiceGiftRequest 사용 */
export type InvoicePrefixRequest = InvoiceGiftRequest
/** @deprecated InvoiceGiftRequestStatus 사용 */
export type InvoicePrefixRequestStatus = InvoiceGiftRequestStatus

export const INVOICE_GIFT_REQUEST_STATUS_LABEL: Record<
  InvoiceGiftRequestStatus,
  string
> = {
  scheduled: '예정',
  running: '진행중',
  ended: '종료',
  paused: '중지',
}

/** @deprecated INVOICE_GIFT_REQUEST_STATUS_LABEL 사용 */
export const INVOICE_PREFIX_REQUEST_STATUS_LABEL =
  INVOICE_GIFT_REQUEST_STATUS_LABEL

export const INVOICE_GIFT_COUNT_BASIS_LABEL: Record<
  InvoiceGiftCountBasis,
  string
> = {
  per_order: '주문당 1개',
  per_product: '대상 상품 종류당 1개',
  per_quantity: '대상 수량만큼',
}

/** @deprecated INVOICE_GIFT_COUNT_BASIS_LABEL 사용 */
export const INVOICE_PREFIX_COUNT_BASIS_LABEL = INVOICE_GIFT_COUNT_BASIS_LABEL

export const INVOICE_GIFT_MERGE_BASIS_LABEL: Record<
  InvoiceGiftMergeBasis,
  string
> = {
  per_order: '주문 수만큼',
  per_shipment: '합포장당 1개만',
}

/** @deprecated INVOICE_GIFT_MERGE_BASIS_LABEL 사용 */
export const INVOICE_PREFIX_MERGE_BASIS_LABEL = INVOICE_GIFT_MERGE_BASIS_LABEL

/** 작업 지시 포장재 산정 단위 */
export type InvoiceWorkInstructionCountBasis =
  | 'per_shipment'
  | 'per_order'
  | 'per_row'
  | 'per_quantity'

export const INVOICE_WORK_INSTRUCTION_COUNT_BASIS_LABEL: Record<
  InvoiceWorkInstructionCountBasis,
  string
> = {
  per_shipment: '합포장당 1개',
  per_order: '주문건당 1개',
  per_row: '대상 행당 1개',
  per_quantity: '내품수량만큼',
}

/** 작업 지시 대상 원본 품목명 */
export type InvoiceWorkInstructionItem = {
  id: string
  instructionId: string
  productName: string
  normalizedProductName: string
}

/**
 * 포장·특이사항 작업 지시.
 * 원본 품목명 exact-match로 최종 품목명 앞에 표시 문구를 붙인다.
 * 적용 기간(startsAt/endsAt)이 있으면 주문일시가 그 안일 때만 적용하고,
 * 비어 있으면 중지 전까지 항상 적용한다.
 * outgoingProducts는 Gift box처럼 지시가 적용될 때 나가는 포장재다.
 */
export type InvoiceWorkInstruction = {
  id: string
  brandId: string
  title: string
  labelText: string
  isActive: boolean
  note: string
  startsAt: string | null
  endsAt: string | null
  countBasis: InvoiceWorkInstructionCountBasis
  outgoingProducts: StyleRef[]
  items: InvoiceWorkInstructionItem[]
  createdAt: string
  updatedAt: string
}

export const CODE_USAGE_STATUS_LABEL: Record<CodeUsageStatus, string> = {
  active: '사용중',
  paused: '일시중지',
}

export const STYLE_STATUS_LABEL: Record<StyleStatus, string> = {
  draft: '기획중',
  design: '디자인',
  sampling: '샘플링',
  confirmed: '확정',
  ordered: '발주',
  received: '입고',
}

export const SEASON_STATUS_LABEL: Record<SeasonStatus, string> = {
  active: '진행 중',
  archived: '마감',
}

export type AiProvider = 'openai' | 'anthropic' | 'gemini'

export type AiFeatureKey =
  | 'invoice_product_recommendation'
  | 'invoice_accessory_recommendation'

export type AiRecommendationPolicy = 'hybrid_auto' | 'always_ai' | 'local_only'

export type AiFeatureRoute = {
  id: string
  brandId: string
  featureKey: string
  provider: AiProvider
  modelId: string
  isActive: boolean
  recommendationPolicy: AiRecommendationPolicy
  decisionConfig: {
    high: number
    margin: number
    low: number
    aiTopN: number
  }
  createdAt: string
  updatedAt: string
}

export type AiProductCandidate = {
  source: string
  lookupKey: string
  styleId: string
  styleNo: string
  name: string
  score: number
  rank?: number
}

export type AiRecommendProduct = {
  styleId: string
  styleNo: string
  name: string
  reason: string
  confidence: number
}

export type AiRecommendationSource = 'local' | 'manual' | 'ai' | 'cache'

export type AiAccessorySuggestRule = {
  ruleType: InvoiceAccessoryRuleType
  pattern: string
  accessoryKind: string
  namePrefix: string
  colorName: string
  styleId: string
  styleNo: string
  name: string
  reason: string
  confidence: number
}

export type AiAccessoryContextDecision = {
  contextId: string
  action: 'components' | 'delete' | 'hold'
  components: Array<{
    styleId: string
    styleNo: string
    name: string
    quantity: number
  }>
  reason: string
  confidence: number
}

export type AiAccessoryRecommendation = {
  reason: string
  rules: AiAccessorySuggestRule[]
  contexts: AiAccessoryContextDecision[]
  provider: AiProvider
  modelId: string
  source: AiRecommendationSource
  cacheId: string | null
  skippedAi: boolean
  cacheHit: boolean
}

export type AiItemNameRecommendation = {
  reason: string
  contexts: AiAccessoryContextDecision[]
  provider: AiProvider
  modelId: string
  source: AiRecommendationSource
  cacheId: string | null
  skippedAi: boolean
  cacheHit: boolean
}

export type AiProductRecommendation = {
  lookupKey: string
  reason: string
  products: AiRecommendProduct[]
  provider: AiProvider
  modelId: string
  source: AiRecommendationSource
  cacheId: string | null
  skippedAi: boolean
  cacheHit: boolean
}

export type AiUsageSummary = {
  total: number
  localCount: number
  aiCount: number
  cacheCount: number
  skippedAiCount: number
  inputTokens: number
  outputTokens: number
  top1Rate: number | null
  top3Rate: number | null
  editRate: number | null
}
