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
  | 'draft'
  | 'design'
  | 'sampling'
  | 'confirmed'
  | 'ordered'
  | 'received'

export type FieldOwner = 'common' | 'planning' | 'design' | 'md' | 'logistics'

export type FieldType = 'text' | 'number' | 'list' | 'gender' | 'season'

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
  /** 포장 규격(mm) */
  widthMm: number | null
  depthMm: number | null
  heightMm: number | null
  note: string
  components: ProductCodeComponent[]
  createdAt: string
  updatedAt: string
}

export type ProductCodeInput = {
  kind: ProductCodeKind
  code: string
  name: string
  weightG: number | null
  widthMm: number | null
  depthMm: number | null
  heightMm: number | null
  note: string
  components: ProductCodeComponent[]
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
