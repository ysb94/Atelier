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

export type Season = {
  id: string
  brandId: string
  code: string
  name: string
  year: number
  status: 'planning' | 'in_production' | 'selling' | 'closed'
}

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
}

/** 사용자 추가 항목 입력 */
export type BrandFieldInput = {
  label: string
  type: FieldType
  owner: FieldOwner
  required?: boolean
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
  targetCost: number
  plannedQty: number
  retailPrice: number
  status: StyleStatus
  designer?: string
  planner?: string
  thumbnailColor: string
  description?: string
  /** 단품 실중량(g). 코드 포장 무게 제안의 기준값 */
  weightG?: number | null
  /** 가져오기에서 시스템 필드로 매핑되지 않은 컬럼: 원본 헤더 이름 -> 값 */
  customFields?: Record<string, string>
}

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

export type DesignSpec = {
  styleId: string
  fabric: string
  lining?: string
  trimNotes: string
  sizeRange: string
  sampleRound: number
  sampleStatus: 'pending' | 'in_review' | 'approved' | 'rejected'
  workOrderNotes: string
  measurements: { part: string; size: string; value: string }[]
}

export type MdSummary = {
  styleId: string
  orderQty: number
  soldQty: number
  sellThrough: number
  marginRate: number
  reorderFlag: boolean
  channel: string
}

export type InventoryItem = {
  id: string
  styleId: string
  warehouse: string
  onHand: number
  reserved: number
  available: number
}

export type StockMovement = {
  id: string
  styleId: string
  date: string
  type: 'in' | 'out' | 'transfer' | 'return'
  qty: number
  warehouse: string
  note: string
}

export const STYLE_STATUS_LABEL: Record<StyleStatus, string> = {
  draft: '기획중',
  design: '디자인',
  sampling: '샘플링',
  confirmed: '확정',
  ordered: '발주',
  received: '입고',
}

export const SEASON_STATUS_LABEL: Record<Season['status'], string> = {
  planning: '기획',
  in_production: '생산',
  selling: '판매',
  closed: '종료',
}

export const MOVEMENT_TYPE_LABEL: Record<StockMovement['type'], string> = {
  in: '입고',
  out: '출고',
  transfer: '이동',
  return: '반품',
}
