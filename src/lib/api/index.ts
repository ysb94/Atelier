import type {
  Brand,
  DesignSpec,
  InventoryItem,
  MdSummary,
  Season,
  StockMovement,
  Style,
} from '@/lib/types'

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

export const brands: Brand[] = [
  {
    id: 'brand-atelier',
    slug: 'atelier',
    name: 'ATELIER',
    nameKo: '아틀리에',
    description: '시티 모던 여성복',
    color: '#2C3E50',
    styleCount: 24,
    seasonLabel: '26SS',
  },
  {
    id: 'brand-noir',
    slug: 'noir',
    name: 'NOIR',
    nameKo: '느와르',
    description: '미니멀 블랙 라인',
    color: '#1A1A1A',
    styleCount: 18,
    seasonLabel: '26SS',
  },
  {
    id: 'brand-lumen',
    slug: 'lumen',
    name: 'LUMEN',
    nameKo: '루멘',
    description: '라이트 캐주얼',
    color: '#6B7C6E',
    styleCount: 31,
    seasonLabel: '25FW',
  },
  {
    id: 'brand-form',
    slug: 'form',
    name: 'FORM',
    nameKo: '폼',
    description: '유틸리티 워크웨어',
    color: '#4A5568',
    styleCount: 15,
    seasonLabel: '26SS',
  },
]

export const seasons: Season[] = [
  {
    id: 'season-atelier-26ss',
    brandId: 'brand-atelier',
    code: '26SS',
    name: '2026 Spring/Summer',
    year: 2026,
    status: 'planning',
  },
  {
    id: 'season-atelier-25fw',
    brandId: 'brand-atelier',
    code: '25FW',
    name: '2025 Fall/Winter',
    year: 2025,
    status: 'selling',
  },
  {
    id: 'season-noir-26ss',
    brandId: 'brand-noir',
    code: '26SS',
    name: '2026 Spring/Summer',
    year: 2026,
    status: 'planning',
  },
  {
    id: 'season-noir-25fw',
    brandId: 'brand-noir',
    code: '25FW',
    name: '2025 Fall/Winter',
    year: 2025,
    status: 'in_production',
  },
  {
    id: 'season-lumen-25fw',
    brandId: 'brand-lumen',
    code: '25FW',
    name: '2025 Fall/Winter',
    year: 2025,
    status: 'selling',
  },
  {
    id: 'season-lumen-26ss',
    brandId: 'brand-lumen',
    code: '26SS',
    name: '2026 Spring/Summer',
    year: 2026,
    status: 'planning',
  },
  {
    id: 'season-form-26ss',
    brandId: 'brand-form',
    code: '26SS',
    name: '2026 Spring/Summer',
    year: 2026,
    status: 'planning',
  },
]

export const styles: Style[] = [
  {
    id: 'style-a1',
    brandId: 'brand-atelier',
    seasonId: 'season-atelier-26ss',
    styleNo: 'AT-26SS-001',
    name: '오버사이즈 트렌치',
    category: '아우터',
    gender: 'W',
    colors: ['Ivory', 'Black'],
    targetCost: 89000,
    plannedQty: 400,
    retailPrice: 289000,
    status: 'design',
    designer: '김서연',
    planner: '박민지',
    thumbnailColor: '#E8E0D5',
    description: '코튼 혼방 오버사이즈 트렌치. 벨트 디테일.',
  },
  {
    id: 'style-a2',
    brandId: 'brand-atelier',
    seasonId: 'season-atelier-26ss',
    styleNo: 'AT-26SS-002',
    name: '실크 블라우스',
    category: '상의',
    gender: 'W',
    colors: ['Cream', 'Sage'],
    targetCost: 42000,
    plannedQty: 600,
    retailPrice: 149000,
    status: 'sampling',
    designer: '김서연',
    planner: '박민지',
    thumbnailColor: '#D4C5B0',
    description: '실크 블렌드 블라우스. 히든 플acket.',
  },
  {
    id: 'style-a3',
    brandId: 'brand-atelier',
    seasonId: 'season-atelier-26ss',
    styleNo: 'AT-26SS-003',
    name: '와이드 슬랙스',
    category: '하의',
    gender: 'W',
    colors: ['Charcoal', 'Stone'],
    targetCost: 38000,
    plannedQty: 800,
    retailPrice: 129000,
    status: 'confirmed',
    designer: '이하늘',
    planner: '박민지',
    thumbnailColor: '#6B6B6B',
  },
  {
    id: 'style-a4',
    brandId: 'brand-atelier',
    seasonId: 'season-atelier-25fw',
    styleNo: 'AT-25FW-014',
    name: '울 블렌드 코트',
    category: '아우터',
    gender: 'W',
    colors: ['Camel', 'Navy'],
    targetCost: 120000,
    plannedQty: 280,
    retailPrice: 420000,
    status: 'received',
    designer: '김서연',
    planner: '박민지',
    thumbnailColor: '#C4A484',
  },
  {
    id: 'style-a5',
    brandId: 'brand-atelier',
    seasonId: 'season-atelier-26ss',
    styleNo: 'AT-26SS-004',
    name: '니트 카디건',
    category: '니트',
    gender: 'W',
    colors: ['Oatmeal', 'Navy'],
    targetCost: 35000,
    plannedQty: 500,
    retailPrice: 119000,
    status: 'draft',
    designer: '이하늘',
    planner: '박민지',
    thumbnailColor: '#E5D5C0',
  },
  {
    id: 'style-n1',
    brandId: 'brand-noir',
    seasonId: 'season-noir-26ss',
    styleNo: 'NR-26SS-001',
    name: '블랙 테일러드 자켓',
    category: '아우터',
    gender: 'U',
    colors: ['Black'],
    targetCost: 95000,
    plannedQty: 320,
    retailPrice: 320000,
    status: 'design',
    designer: '최유진',
    planner: '정호준',
    thumbnailColor: '#222222',
  },
  {
    id: 'style-n2',
    brandId: 'brand-noir',
    seasonId: 'season-noir-26ss',
    styleNo: 'NR-26SS-002',
    name: '스트레이트 팬츠',
    category: '하의',
    gender: 'U',
    colors: ['Black', 'Ink'],
    targetCost: 40000,
    plannedQty: 500,
    retailPrice: 145000,
    status: 'confirmed',
    designer: '최유진',
    planner: '정호준',
    thumbnailColor: '#111111',
  },
  {
    id: 'style-n3',
    brandId: 'brand-noir',
    seasonId: 'season-noir-25fw',
    styleNo: 'NR-25FW-008',
    name: '롱 울 코트',
    category: '아우터',
    gender: 'U',
    colors: ['Black', 'Graphite'],
    targetCost: 140000,
    plannedQty: 200,
    retailPrice: 480000,
    status: 'ordered',
    designer: '최유진',
    planner: '정호준',
    thumbnailColor: '#2B2B2B',
  },
  {
    id: 'style-l1',
    brandId: 'brand-lumen',
    seasonId: 'season-lumen-26ss',
    styleNo: 'LM-26SS-001',
    name: '라이트 코튼 셔츠',
    category: '상의',
    gender: 'U',
    colors: ['White', 'Sky'],
    targetCost: 22000,
    plannedQty: 1200,
    retailPrice: 79000,
    status: 'design',
    designer: '한소희',
    planner: '오세훈',
    thumbnailColor: '#E8F0F5',
  },
  {
    id: 'style-l2',
    brandId: 'brand-lumen',
    seasonId: 'season-lumen-25fw',
    styleNo: 'LM-25FW-012',
    name: '플리스 후디',
    category: '상의',
    gender: 'U',
    colors: ['Grey', 'Olive'],
    targetCost: 28000,
    plannedQty: 900,
    retailPrice: 99000,
    status: 'received',
    designer: '한소희',
    planner: '오세훈',
    thumbnailColor: '#A8B0A0',
  },
  {
    id: 'style-f1',
    brandId: 'brand-form',
    seasonId: 'season-form-26ss',
    styleNo: 'FM-26SS-001',
    name: '카고 팬츠',
    category: '하의',
    gender: 'U',
    colors: ['Olive', 'Sand'],
    targetCost: 36000,
    plannedQty: 700,
    retailPrice: 135000,
    status: 'sampling',
    designer: '배수진',
    planner: '윤재민',
    thumbnailColor: '#6B705C',
  },
  {
    id: 'style-f2',
    brandId: 'brand-form',
    seasonId: 'season-form-26ss',
    styleNo: 'FM-26SS-002',
    name: '유틸 필드 자켓',
    category: '아우터',
    gender: 'U',
    colors: ['Khaki', 'Black'],
    targetCost: 72000,
    plannedQty: 350,
    retailPrice: 248000,
    status: 'design',
    designer: '배수진',
    planner: '윤재민',
    thumbnailColor: '#8B7E66',
  },
]

const designSpecs: DesignSpec[] = [
  {
    styleId: 'style-a1',
    fabric: 'Cotton-nylon blend 180g',
    lining: 'Cupro',
    trimNotes: '메탈 버튼 / 코튼 벨트',
    sizeRange: 'XS–L',
    sampleRound: 1,
    sampleStatus: 'in_review',
    workOrderNotes: '카라 각 라인 보정 필요. 소매 기장 +1cm 검토.',
    measurements: [
      { part: '가슴둘레', size: 'M', value: '108' },
      { part: '총기장', size: 'M', value: '112' },
      { part: '소매기장', size: 'M', value: '58' },
    ],
  },
  {
    styleId: 'style-a2',
    fabric: 'Silk blend georgette',
    trimNotes: '히든 플acket / 진주 버튼',
    sizeRange: 'XS–L',
    sampleRound: 2,
    sampleStatus: 'approved',
    workOrderNotes: '2차 샘플 승인. 본생산 패턴 반영 완료.',
    measurements: [
      { part: '가슴둘레', size: 'M', value: '96' },
      { part: '총기장', size: 'M', value: '64' },
    ],
  },
  {
    styleId: 'style-n1',
    fabric: 'Wool blend 240g',
    lining: 'Cupro',
    trimNotes: '블랙 호른 버튼',
    sizeRange: 'S–XL',
    sampleRound: 1,
    sampleStatus: 'pending',
    workOrderNotes: '1차 샘플 진행 중.',
    measurements: [
      { part: '가슴둘레', size: 'M', value: '104' },
      { part: '총기장', size: 'M', value: '72' },
    ],
  },
  {
    styleId: 'style-f1',
    fabric: 'Ripstop cotton',
    trimNotes: '벨크로 포켓 / YKK 지퍼',
    sizeRange: 'S–XXL',
    sampleRound: 1,
    sampleStatus: 'in_review',
    workOrderNotes: '포켓 위치 조정 요청.',
    measurements: [
      { part: '허리', size: 'M', value: '80' },
      { part: '총기장', size: 'M', value: '102' },
    ],
  },
]

const mdSummaries: MdSummary[] = [
  {
    styleId: 'style-a3',
    orderQty: 800,
    soldQty: 0,
    sellThrough: 0,
    marginRate: 0.58,
    reorderFlag: false,
    channel: '온라인',
  },
  {
    styleId: 'style-a4',
    orderQty: 280,
    soldQty: 196,
    sellThrough: 0.7,
    marginRate: 0.52,
    reorderFlag: true,
    channel: '자사몰/편집샵',
  },
  {
    styleId: 'style-n2',
    orderQty: 500,
    soldQty: 0,
    sellThrough: 0,
    marginRate: 0.55,
    reorderFlag: false,
    channel: '온라인',
  },
  {
    styleId: 'style-n3',
    orderQty: 200,
    soldQty: 0,
    sellThrough: 0,
    marginRate: 0.48,
    reorderFlag: false,
    channel: '편집샵',
  },
  {
    styleId: 'style-l2',
    orderQty: 900,
    soldQty: 720,
    sellThrough: 0.8,
    marginRate: 0.6,
    reorderFlag: true,
    channel: '전 채널',
  },
  {
    styleId: 'style-f1',
    orderQty: 0,
    soldQty: 0,
    sellThrough: 0,
    marginRate: 0.54,
    reorderFlag: false,
    channel: '미정',
  },
]

const inventory: InventoryItem[] = [
  {
    id: 'inv-1',
    styleId: 'style-a4',
    warehouse: '김포 물류센터',
    onHand: 84,
    reserved: 12,
    available: 72,
  },
  {
    id: 'inv-2',
    styleId: 'style-a4',
    warehouse: '강남 플래그십',
    onHand: 18,
    reserved: 3,
    available: 15,
  },
  {
    id: 'inv-3',
    styleId: 'style-l2',
    warehouse: '김포 물류센터',
    onHand: 180,
    reserved: 40,
    available: 140,
  },
  {
    id: 'inv-4',
    styleId: 'style-n3',
    warehouse: '김포 물류센터',
    onHand: 0,
    reserved: 0,
    available: 0,
  },
  {
    id: 'inv-5',
    styleId: 'style-a3',
    warehouse: '김포 물류센터',
    onHand: 0,
    reserved: 0,
    available: 0,
  },
]

const movements: StockMovement[] = [
  {
    id: 'mv-1',
    styleId: 'style-a4',
    date: '2026-03-12',
    type: 'in',
    qty: 280,
    warehouse: '김포 물류센터',
    note: '본생산 1차 입고',
  },
  {
    id: 'mv-2',
    styleId: 'style-a4',
    date: '2026-03-15',
    type: 'transfer',
    qty: 30,
    warehouse: '강남 플래그십',
    note: '매장 이동',
  },
  {
    id: 'mv-3',
    styleId: 'style-a4',
    date: '2026-03-20',
    type: 'out',
    qty: 12,
    warehouse: '강남 플래그십',
    note: '판매 출고',
  },
  {
    id: 'mv-4',
    styleId: 'style-l2',
    date: '2025-11-02',
    type: 'in',
    qty: 900,
    warehouse: '김포 물류센터',
    note: '본생산 입고',
  },
  {
    id: 'mv-5',
    styleId: 'style-l2',
    date: '2026-01-18',
    type: 'out',
    qty: 720,
    warehouse: '김포 물류센터',
    note: '채널 출고 합산',
  },
  {
    id: 'mv-6',
    styleId: 'style-l2',
    date: '2026-02-01',
    type: 'return',
    qty: 18,
    warehouse: '김포 물류센터',
    note: '고객 반품',
  },
]

export async function getBrands(): Promise<Brand[]> {
  await delay()
  return brands
}

export async function getBrandBySlug(slug: string): Promise<Brand | undefined> {
  await delay()
  return brands.find((b) => b.slug === slug)
}

export async function getSeasonsByBrand(brandId: string): Promise<Season[]> {
  await delay()
  return seasons.filter((s) => s.brandId === brandId)
}

export async function getStylesByBrand(
  brandId: string,
  seasonId?: string,
): Promise<Style[]> {
  await delay()
  return styles.filter(
    (s) => s.brandId === brandId && (!seasonId || s.seasonId === seasonId),
  )
}

export async function getStyleById(styleId: string): Promise<Style | undefined> {
  await delay()
  return styles.find((s) => s.id === styleId)
}

export async function getDesignSpec(
  styleId: string,
): Promise<DesignSpec | undefined> {
  await delay()
  return designSpecs.find((d) => d.styleId === styleId)
}

export async function getMdSummariesByBrand(
  brandId: string,
): Promise<(MdSummary & { style: Style })[]> {
  await delay()
  const brandStyles = styles.filter((s) => s.brandId === brandId)
  return brandStyles
    .map((style) => {
      const summary = mdSummaries.find((m) => m.styleId === style.id)
      if (!summary) return null
      return { ...summary, style }
    })
    .filter((x): x is MdSummary & { style: Style } => x !== null)
}

export async function getInventoryByBrand(
  brandId: string,
): Promise<(InventoryItem & { style: Style })[]> {
  await delay()
  const brandStyles = styles.filter((s) => s.brandId === brandId)
  const styleMap = new Map(brandStyles.map((s) => [s.id, s]))
  return inventory
    .filter((i) => styleMap.has(i.styleId))
    .map((i) => ({ ...i, style: styleMap.get(i.styleId)! }))
}

export async function getMovementsByBrand(
  brandId: string,
): Promise<(StockMovement & { style: Style })[]> {
  await delay()
  const brandStyles = styles.filter((s) => s.brandId === brandId)
  const styleMap = new Map(brandStyles.map((s) => [s.id, s]))
  return movements
    .filter((m) => styleMap.has(m.styleId))
    .map((m) => ({ ...m, style: styleMap.get(m.styleId)! }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

const THUMBNAIL_PALETTE = [
  '#D8CFC0',
  '#B9C2B0',
  '#C7B8A6',
  '#A9B4C0',
  '#CBBEB4',
  '#9FA9A0',
]

function pickThumbnailColor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000
  }
  return THUMBNAIL_PALETTE[hash % THUMBNAIL_PALETTE.length]
}

let importCounter = 0

export type ImportApplyRow = {
  styleNo: string
  matchKey: string
  targetStyleId?: string
  applied: Record<string, unknown>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function applyStyleFields(style: Style, applied: Record<string, unknown>) {
  const name = asString(applied.name)
  if (name) style.name = name

  const category = asString(applied.category)
  if (category) style.category = category

  const seasonId = asString(applied.seasonId)
  if (seasonId) style.seasonId = seasonId

  const gender = asString(applied.gender)
  if (gender === 'W' || gender === 'M' || gender === 'U') style.gender = gender

  if (Array.isArray(applied.colors) && applied.colors.length > 0) {
    style.colors = applied.colors as string[]
  }

  const plannedQty = asNumber(applied.plannedQty)
  if (plannedQty !== undefined) style.plannedQty = plannedQty

  const targetCost = asNumber(applied.targetCost)
  if (targetCost !== undefined) style.targetCost = targetCost

  const retailPrice = asNumber(applied.retailPrice)
  if (retailPrice !== undefined) style.retailPrice = retailPrice

  const planner = asString(applied.planner)
  if (planner) style.planner = planner

  const designer = asString(applied.designer)
  if (designer) style.designer = designer

  const description = asString(applied.description)
  if (description) style.description = description
}

function applyDesignFields(styleId: string, applied: Record<string, unknown>) {
  const fabric = asString(applied.fabric)
  if (!fabric) return

  const spec = designSpecs.find((d) => d.styleId === styleId)
  if (spec) {
    spec.fabric = fabric
    return
  }
  designSpecs.push({
    styleId,
    fabric,
    trimNotes: '',
    sizeRange: '',
    sampleRound: 1,
    sampleStatus: 'pending',
    workOrderNotes: '',
    measurements: [],
  })
}

function applyMdFields(styleId: string, applied: Record<string, unknown>) {
  const orderQty = asNumber(applied.orderQty)
  const channel = asString(applied.channel)
  if (orderQty === undefined && !channel) return

  const summary = mdSummaries.find((m) => m.styleId === styleId)
  if (summary) {
    if (orderQty !== undefined) summary.orderQty = orderQty
    if (channel) summary.channel = channel
    return
  }
  mdSummaries.push({
    styleId,
    orderQty: orderQty ?? 0,
    soldQty: 0,
    sellThrough: 0,
    marginRate: 0,
    reorderFlag: false,
    channel: channel ?? '미정',
  })
}

function applyLogisticsFields(
  styleId: string,
  applied: Record<string, unknown>,
) {
  const onHand = asNumber(applied.onHand)
  const warehouse = asString(applied.warehouse)
  if (onHand === undefined && !warehouse) return

  const location = warehouse ?? '미지정'
  const item = inventory.find(
    (i) => i.styleId === styleId && i.warehouse === location,
  )
  if (item) {
    if (onHand !== undefined) {
      item.onHand = onHand
      item.available = Math.max(onHand - item.reserved, 0)
    }
    return
  }
  inventory.push({
    id: `inv-import-${(importCounter += 1)}`,
    styleId,
    warehouse: location,
    onHand: onHand ?? 0,
    reserved: 0,
    available: onHand ?? 0,
  })
}

/**
 * 품번으로 기존 상품을 찾아 병합하고, 없으면 새로 만든다.
 * 목업 단계라 메모리 배열을 직접 갱신한다. Supabase 합류 시 이 함수만 교체하면 된다.
 */
export async function applyProductImport(
  brandId: string,
  rows: ImportApplyRow[],
): Promise<{ created: number; updated: number }> {
  await delay(200)

  let created = 0
  let updated = 0

  for (const row of rows) {
    let target = row.targetStyleId
      ? styles.find((s) => s.id === row.targetStyleId)
      : undefined

    if (!target) {
      const seasonId =
        asString(row.applied.seasonId) ??
        seasons.find((s) => s.brandId === brandId)?.id
      if (!seasonId) continue

      target = {
        id: `style-import-${(importCounter += 1)}`,
        brandId,
        seasonId,
        styleNo: row.styleNo.trim(),
        name: asString(row.applied.name) ?? row.styleNo.trim(),
        category: '미분류',
        gender: 'U',
        colors: [],
        targetCost: 0,
        plannedQty: 0,
        retailPrice: 0,
        status: 'draft',
        thumbnailColor: pickThumbnailColor(row.matchKey),
      }
      styles.push(target)
      created += 1
    } else {
      updated += 1
    }

    applyStyleFields(target, row.applied)
    applyDesignFields(target.id, row.applied)
    applyMdFields(target.id, row.applied)
    applyLogisticsFields(target.id, row.applied)
  }

  for (const brand of brands) {
    if (brand.id !== brandId) continue
    brand.styleCount = styles.filter((s) => s.brandId === brandId).length
  }

  return { created, updated }
}
