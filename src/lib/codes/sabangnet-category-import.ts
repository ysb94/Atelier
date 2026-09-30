import {
  CATEGORY_LIST_SEPARATOR,
  categoryListLabel,
  parseMallCategoryCell,
  resolveCategoryPath,
  sameCategoryIds,
  type CategoryTree,
  type ResolvedCategoryPath,
} from '@/lib/products/product-categories'
import type { SabangnetProduct } from '@/lib/types'

export const SABANGNET_CATEGORY_HEADERS = ['사방넷 코드', '카테고리'] as const

const CODE_ALIASES = ['사방넷 코드', '품번코드', '상품코드', '코드']
const CATEGORY_ALIASES = ['카테고리', '카테고리 경로', '분류', '상품 분류']
const HEADER_SCAN_ROWS = 10

export type SabangnetCategoryImportStatus =
  | 'ready'
  | 'unchanged'
  | 'empty'
  | 'conflict'
  | 'mid'
  | 'missing'
  | 'inactive'
  | 'unknownCode'
  | 'noStyles'

/** 미리보기 표시 순서 */
export const SABANGNET_CATEGORY_STATUS_ORDER: SabangnetCategoryImportStatus[] = [
  'ready',
  'unchanged',
  'empty',
  'mid',
  'missing',
  'inactive',
  'conflict',
  'noStyles',
  'unknownCode',
]

export const SABANGNET_CATEGORY_STATUS_LABEL: Record<
  SabangnetCategoryImportStatus,
  string
> = {
  ready: '적용 가능',
  unchanged: '이미 같음',
  empty: '카테고리 없음',
  conflict: '코드 중복·내용 다름',
  mid: '중간 분류에서 멈춤',
  missing: '트리에 없음',
  inactive: '사용 안 함 카테고리',
  unknownCode: '없는 사방넷 코드',
  noStyles: 'M번호 미연결',
}

export type SabangnetCategoryHeader = {
  headerIndex: number
  codeIdx: number
  categoryIdx: number
}

export type PreparedSabangnetCategoryRow = {
  /** 파일 행 번호(1부터). 같은 코드가 여러 번이면 모두 적는다. */
  lineNos: number[]
  code: string
  productName: string
  raw: string
  paths: ResolvedCategoryPath[]
  /** 적용할 최하위 카테고리 id. 첫 번째가 대표다. */
  categoryIds: string[]
  styleCount: number
  status: SabangnetCategoryImportStatus
  message: string
}

export type PreparedSabangnetCategoryImport =
  | { ok: false; error: string }
  | {
      ok: true
      rows: PreparedSabangnetCategoryRow[]
      counts: Record<SabangnetCategoryImportStatus, number>
      /** 같은 코드가 같은 내용으로 반복돼 합친 행 수 */
      mergedLines: number
      /** 적용 대상 M번호 수(적용 가능 행 합계) */
      readyStyleCount: number
    }

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

function findAlias(headers: string[], aliases: readonly string[]): number {
  const normalized = headers.map((header) => normalizeHeader(header ?? ''))
  for (const alias of aliases.map(normalizeHeader)) {
    const index = normalized.indexOf(alias)
    if (index >= 0) return index
  }
  for (const alias of aliases.map(normalizeHeader)) {
    const index = normalized.findIndex((header) => header.startsWith(alias))
    if (index >= 0) return index
  }
  return -1
}

export function findSabangnetCategoryHeader(
  rows: string[][],
): SabangnetCategoryHeader | null {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length)
  for (let i = 0; i < limit; i += 1) {
    const headers = rows[i] ?? []
    const codeIdx = findAlias(headers, CODE_ALIASES)
    const categoryIdx = findAlias(headers, CATEGORY_ALIASES)
    if (codeIdx < 0 || categoryIdx < 0 || codeIdx === categoryIdx) continue
    return { headerIndex: i, codeIdx, categoryIdx }
  }
  return null
}

function emptyCounts(): Record<SabangnetCategoryImportStatus, number> {
  return {
    ready: 0,
    unchanged: 0,
    empty: 0,
    conflict: 0,
    mid: 0,
    missing: 0,
    inactive: 0,
    unknownCode: 0,
    noStyles: 0,
  }
}

function pathLabels(paths: ResolvedCategoryPath[], status: string) {
  return paths
    .filter((path) => path.status === status)
    .map((path) => path.label)
    .join(', ')
}

type FileLine = { lineNo: number; raw: string; paths: ResolvedCategoryPath[] }

function linesKey(line: FileLine) {
  return line.paths.map((path) => path.key).join('|')
}

/**
 * `사방넷 코드 | 카테고리` 파일을 코드별로 판정한다.
 * 모든 경로가 사용 중인 최하위 카테고리일 때만 적용 가능이고, 하나라도 문제면 행 전체를
 * 보류한다. 카테고리 칸이 비었거나 진열용 칸만 있으면 기존 값을 유지한다.
 */
export function prepareSabangnetCategoryImport(options: {
  rows: string[][]
  tree: CategoryTree
  products: readonly SabangnetProduct[]
  categoriesByStyle: ReadonlyMap<string, readonly string[]>
}): PreparedSabangnetCategoryImport {
  const { rows, tree, products, categoriesByStyle } = options
  const header = findSabangnetCategoryHeader(rows)
  if (!header) {
    return {
      ok: false,
      error:
        '첫 행에 「사방넷 코드」와 「카테고리」 헤더가 있어야 합니다. 현재 카테고리 내려받기 파일 형식을 참고하세요.',
    }
  }

  const productByCode = new Map(
    products.map((product) => [product.code.trim(), product]),
  )
  const linesByCode = new Map<string, FileLine[]>()
  const blankCodeLines: FileLine[] = []
  for (let i = header.headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const code = String(row[header.codeIdx] ?? '').trim()
    const raw = String(row[header.categoryIdx] ?? '').trim()
    if (!code && !raw) continue
    const line: FileLine = {
      lineNo: i + 1,
      raw,
      paths: parseMallCategoryCell(raw).map((path) =>
        resolveCategoryPath(tree, path),
      ),
    }
    if (!code) {
      blankCodeLines.push(line)
      continue
    }
    const list = linesByCode.get(code)
    if (list) list.push(line)
    else linesByCode.set(code, [line])
  }

  const prepared: PreparedSabangnetCategoryRow[] = []
  const counts = emptyCounts()
  let mergedLines = 0
  let readyStyleCount = 0

  const push = (row: PreparedSabangnetCategoryRow) => {
    prepared.push(row)
    counts[row.status] += 1
    if (row.status === 'ready') readyStyleCount += row.styleCount
  }

  for (const line of blankCodeLines) {
    push({
      lineNos: [line.lineNo],
      code: '',
      productName: '',
      raw: line.raw,
      paths: line.paths,
      categoryIds: [],
      styleCount: 0,
      status: 'unknownCode',
      message: '사방넷 코드가 비어 있습니다.',
    })
  }

  for (const [code, lines] of linesByCode) {
    const product = productByCode.get(code)
    const styleIds = product?.styles.map((style) => style.styleId) ?? []
    const base = {
      lineNos: lines.map((line) => line.lineNo),
      code,
      productName: product?.name ?? '',
      styleCount: styleIds.length,
      categoryIds: [] as string[],
    }

    const filled = lines.filter((line) => line.paths.length > 0)
    const distinct = new Set(filled.map(linesKey))
    if (distinct.size > 1) {
      push({
        ...base,
        raw: filled.map((line) => line.raw).join('\n'),
        paths: filled[0]!.paths,
        status: 'conflict',
        message: `파일 안에 같은 코드가 다른 카테고리로 ${filled.length}번 있습니다. 한 줄로 정리해 주세요.`,
      })
      continue
    }
    mergedLines += lines.length - 1
    const line = filled[0] ?? lines[0]!

    if (line.paths.length === 0) {
      push({
        ...base,
        raw: line.raw,
        paths: [],
        status: 'empty',
        message: line.raw
          ? '진열용 칸(ALL·NEW ARRIVAL 등)만 있어 기존 카테고리를 유지합니다.'
          : '카테고리 칸이 비어 기존 카테고리를 유지합니다.',
      })
      continue
    }

    const problem = (['mid', 'missing', 'inactive'] as const).find((status) =>
      line.paths.some((path) => path.status === status),
    )
    if (problem) {
      const labels = pathLabels(line.paths, problem)
      push({
        ...base,
        raw: line.raw,
        paths: line.paths,
        status: problem,
        message:
          problem === 'mid'
            ? `하위 카테고리가 있는 분류에서 멈췄습니다: ${labels}. 최하위 카테고리를 적어 주세요.`
            : problem === 'missing'
              ? `카테고리 관리에 없는 경로입니다: ${labels}.`
              : `사용 안 함 상태인 카테고리입니다: ${labels}.`,
      })
      continue
    }

    const categoryIds = line.paths.map((path) => path.categoryId!)
    if (!product) {
      push({
        ...base,
        raw: line.raw,
        paths: line.paths,
        categoryIds,
        status: 'unknownCode',
        message: '등록되지 않은 사방넷 코드입니다.',
      })
      continue
    }
    if (styleIds.length === 0) {
      push({
        ...base,
        raw: line.raw,
        paths: line.paths,
        categoryIds,
        status: 'noStyles',
        message: 'M번호가 연결되지 않아 적용할 곳이 없습니다. M번호를 먼저 연결하세요.',
      })
      continue
    }
    const unchanged = styleIds.every((styleId) =>
      sameCategoryIds(categoriesByStyle.get(styleId) ?? [], categoryIds),
    )
    push({
      ...base,
      raw: line.raw,
      paths: line.paths,
      categoryIds,
      status: unchanged ? 'unchanged' : 'ready',
      message: unchanged
        ? '연결된 M번호가 이미 같은 카테고리입니다.'
        : `연결된 M번호 ${styleIds.length}종에 적용합니다.`,
    })
  }

  return { ok: true, rows: prepared, counts, mergedLines, readyStyleCount }
}

export type SabangnetCategorySummary =
  | { kind: 'noStyles' }
  | { kind: 'none' }
  | { kind: 'same'; categoryIds: readonly string[] }
  /** M번호마다 다름. categoryIds는 등장 순서대로 합친 목록이다. */
  | { kind: 'mixed'; categoryIds: readonly string[] }

export function summarizeSabangnetCategories(
  product: Pick<SabangnetProduct, 'styles'>,
  categoriesByStyle: ReadonlyMap<string, readonly string[]>,
): SabangnetCategorySummary {
  if (product.styles.length === 0) return { kind: 'noStyles' }
  const lists = product.styles.map(
    (style) => categoriesByStyle.get(style.styleId) ?? [],
  )
  const first = lists[0]!
  if (lists.every((list) => sameCategoryIds(list, first))) {
    return first.length === 0
      ? { kind: 'none' }
      : { kind: 'same', categoryIds: first }
  }
  const union: string[] = []
  for (const list of lists) {
    for (const id of list) if (!union.includes(id)) union.push(id)
  }
  return { kind: 'mixed', categoryIds: union }
}

/**
 * 현재 카테고리를 가져오기와 같은 형식으로 만든다. M번호마다 다른 코드는 카테고리 칸을
 * 비워 다시 올려도 덮어쓰지 않게 하고, 확인 칸에 M번호별 값을 적는다.
 */
export function buildSabangnetCategoryExportRows(options: {
  products: readonly SabangnetProduct[]
  tree: CategoryTree
  categoriesByStyle: ReadonlyMap<string, readonly string[]>
}): string[][] {
  const { products, tree, categoriesByStyle } = options
  const header = [...SABANGNET_CATEGORY_HEADERS, '사방넷 상품명', '확인']
  const body = [...products]
    .sort((left, right) => left.code.localeCompare(right.code, 'ko', { numeric: true }))
    .map((product) => {
      const summary = summarizeSabangnetCategories(product, categoriesByStyle)
      if (summary.kind === 'noStyles') {
        return [product.code, '', product.name, 'M번호 미연결']
      }
      if (summary.kind === 'none') {
        return [product.code, '', product.name, '미분류']
      }
      if (summary.kind === 'mixed') {
        const detail = product.styles
          .map((style) => {
            const label = categoryListLabel(
              tree,
              categoriesByStyle.get(style.styleId) ?? [],
            )
            return `${style.styleNo}: ${label || '미분류'}`
          })
          .join(' / ')
        return [product.code, '', product.name, `M번호마다 다름 · ${detail}`]
      }
      return [
        product.code,
        categoryListLabel(tree, summary.categoryIds),
        product.name,
        '',
      ]
    })
  return [header, ...body]
}

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function safeFilePart(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'brand'
}

export async function downloadSabangnetCategories(options: {
  brandName: string
  products: readonly SabangnetProduct[]
  tree: CategoryTree
  categoriesByStyle: ReadonlyMap<string, readonly string[]>
}) {
  const XLSX = await import('xlsx')
  const rows = buildSabangnetCategoryExportRows(options)
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [{ wch: 14 }, { wch: 56 }, { wch: 36 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(workbook, sheet, '카테고리')
  const guide = XLSX.utils.aoa_to_sheet([
    ['항목', '설명'],
    ['사방넷 코드', '등록된 사방넷 코드. 이 코드에 연결된 M번호 전체에 카테고리를 적용합니다.'],
    [
      '카테고리',
      `최하위 카테고리 경로. 여러 개면 "${CATEGORY_LIST_SEPARATOR.trim()}"로 구분하고 첫 번째가 대표입니다. 예: BAG > CROSS > Halfmoon | BAG > SHOULDER > Etc`,
    ],
    ['', '카페24 자사몰 표기(ALL | 홈 메뉴 ALL | BAG > …)를 그대로 붙여 넣어도 됩니다.'],
    ['', '칸을 비우면 그 코드의 기존 카테고리를 유지합니다.'],
    ['사방넷 상품명·확인', '참고용이며 가져오기에서는 읽지 않습니다.'],
  ])
  guide['!cols'] = [{ wch: 18 }, { wch: 96 }]
  XLSX.utils.book_append_sheet(workbook, guide, '작성안내')
  XLSX.writeFile(
    workbook,
    `${safeFilePart(options.brandName)}_사방넷카테고리_${todayStamp()}.xlsx`,
  )
}
