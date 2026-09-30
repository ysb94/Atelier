import type { ProductCategory, StyleCategoryLink } from '@/lib/types'
import { normalizeSelectOptionLabel } from '@/lib/products/brand-field-select'

/** 한 경로 안의 단계 구분. 자사몰 표기와 같다. */
export const CATEGORY_PATH_SEPARATOR = ' > '
/** 여러 경로를 한 칸에 적을 때의 구분. 자사몰 표기와 같아 그대로 다시 올릴 수 있다. */
export const CATEGORY_LIST_SEPARATOR = ' | '
/** 카테고리 필터에서 연결이 하나도 없는 M번호를 고르는 값 */
export const UNCATEGORIZED_FILTER = 'none'

const MALL_PATH_DELIMITER = '|'
const MALL_SEGMENT_DELIMITER = '>'
/** 자사몰 진열용 칸. 내부 트리에 두지 않으므로 이 이름으로 시작하는 경로는 버린다. */
const MALL_DISPLAY_ROOTS = new Set(['all', '홈 메뉴 all', 'new arrival'])
/** 자사몰이 분류마다 두는 전체 보기 칸(`BAG > ALL`, `BAG > TOTE > All`) */
const MALL_ALL_SEGMENT = 'all'

export type CategoryTree = {
  byId: Map<string, ProductCategory>
  childrenByParent: Map<string | null, ProductCategory[]>
  /** 최상위부터의 이름 목록 */
  pathNamesById: Map<string, string[]>
  /** categoryPathKey(이름 목록) → 카테고리 */
  byPathKey: Map<string, ProductCategory>
  /** 부모 다음 자식 순서(깊이 우선). 선택 목록 표시용 */
  ordered: ProductCategory[]
}

export type StyleCategoryIndex = {
  tree: CategoryTree
  /** M번호(style id) → 카테고리 id. 대표가 먼저다. */
  byStyle: Map<string, string[]>
}

export type CategoryPathStatus = 'ok' | 'mid' | 'missing' | 'inactive'

export type MallCategoryPath = {
  names: string[]
  label: string
  key: string
}

export type ResolvedCategoryPath = MallCategoryPath & {
  status: CategoryPathStatus
  categoryId: string | null
}

const NO_IDS: readonly string[] = []

/** 대소문자·공백 차이를 무시한 경로 비교 키. DB normalized_name과 같은 규칙이다. */
export function categoryPathKey(names: readonly string[]): string {
  return names.map((name) => normalizeSelectOptionLabel(name)).join('>')
}

function compareSiblings(left: ProductCategory, right: ProductCategory) {
  return (
    left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ko')
  )
}

export function buildCategoryTree(
  categories: readonly ProductCategory[],
): CategoryTree {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const childrenByParent = new Map<string | null, ProductCategory[]>()
  for (const category of categories) {
    const parentId =
      category.parentId && byId.has(category.parentId) ? category.parentId : null
    const siblings = childrenByParent.get(parentId)
    if (siblings) siblings.push(category)
    else childrenByParent.set(parentId, [category])
  }
  for (const siblings of childrenByParent.values()) siblings.sort(compareSiblings)

  const pathNamesById = new Map<string, string[]>()
  const byPathKey = new Map<string, ProductCategory>()
  const ordered: ProductCategory[] = []
  const visit = (parentId: string | null, prefix: string[]) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (pathNamesById.has(child.id)) continue
      const names = [...prefix, child.name]
      pathNamesById.set(child.id, names)
      byPathKey.set(categoryPathKey(names), child)
      ordered.push(child)
      visit(child.id, names)
    }
  }
  visit(null, [])

  return { byId, childrenByParent, pathNamesById, byPathKey, ordered }
}

export function hasChildCategories(tree: CategoryTree, id: string): boolean {
  return (tree.childrenByParent.get(id)?.length ?? 0) > 0
}

export function isLeafCategory(tree: CategoryTree, id: string): boolean {
  return tree.byId.has(id) && !hasChildCategories(tree, id)
}

/** 선택 목록에 쓰는 최하위 카테고리. 트리 순서를 따른다. */
export function listLeafCategories(tree: CategoryTree): ProductCategory[] {
  return tree.ordered.filter((category) => !hasChildCategories(tree, category.id))
}

export function categoryPathLabel(tree: CategoryTree, id: string): string {
  return (tree.pathNamesById.get(id) ?? []).join(CATEGORY_PATH_SEPARATOR)
}

/** DB가 받지 않는 선택(삭제됨·사용 안 함·그 사이 하위가 생긴 분류) */
export function findUnsavableCategoryIds(
  tree: CategoryTree,
  ids: readonly string[],
): string[] {
  return ids.filter((id) => {
    const category = tree.byId.get(id)
    return !category || !category.isActive || hasChildCategories(tree, id)
  })
}

export type CategoryFilterOption = {
  id: string
  label: string
  depth: number
}

/** 필터 선택 목록. 트리 순서대로 깊이만큼 들여 쓴다. */
export function listCategoryFilterOptions(
  tree: CategoryTree,
): CategoryFilterOption[] {
  return tree.ordered.map((category) => {
    const depth = tree.pathNamesById.get(category.id)?.length ?? 1
    return {
      id: category.id,
      depth,
      label: `${'\u00a0\u00a0'.repeat(depth - 1)}${category.name}${category.isActive ? '' : ' (사용 안 함)'}`,
    }
  })
}

/** 자기 자신과 모든 하위 카테고리 id */
export function collectCategoryIds(tree: CategoryTree, rootId: string): Set<string> {
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    for (const child of tree.childrenByParent.get(id) ?? []) stack.push(child.id)
  }
  return ids
}

export function groupStyleCategoryLinks(
  links: readonly StyleCategoryLink[],
): Map<string, string[]> {
  const grouped = new Map<string, StyleCategoryLink[]>()
  for (const link of links) {
    const list = grouped.get(link.styleId)
    if (list) list.push(link)
    else grouped.set(link.styleId, [link])
  }
  const result = new Map<string, string[]>()
  for (const [styleId, list] of grouped) {
    list.sort(
      (left, right) =>
        Number(right.isPrimary) - Number(left.isPrimary) ||
        left.sortOrder - right.sortOrder,
    )
    result.set(
      styleId,
      list.map((link) => link.categoryId),
    )
  }
  return result
}

export function buildStyleCategoryIndex(
  categories: readonly ProductCategory[],
  links: readonly StyleCategoryLink[],
): StyleCategoryIndex {
  return {
    tree: buildCategoryTree(categories),
    byStyle: groupStyleCategoryLinks(links),
  }
}

export function styleCategoryIds(
  index: StyleCategoryIndex,
  styleId: string,
): readonly string[] {
  return index.byStyle.get(styleId) ?? NO_IDS
}

export function sameCategoryIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((id, i) => id === right[i])
  )
}

/** 카테고리 목록을 한 칸 글자로. 대표가 먼저이고 경로는 ` | `로 잇는다. */
export function categoryListLabel(
  tree: CategoryTree,
  ids: readonly string[],
): string {
  return ids
    .map((id) => categoryPathLabel(tree, id) || '삭제된 카테고리')
    .join(CATEGORY_LIST_SEPARATOR)
}

export function styleCategoryLabel(
  index: StyleCategoryIndex,
  styleId: string,
): string {
  return categoryListLabel(index.tree, styleCategoryIds(index, styleId))
}

/** 트리가 있는 브랜드면 `카테고리` 항목은 M번호 연결로만 보고 고친다. */
export function hasCategoryTree(
  index: StyleCategoryIndex | null | undefined,
): index is StyleCategoryIndex {
  return Boolean(index && index.tree.byId.size > 0)
}

/**
 * 화면의 `카테고리` 항목 값. 트리가 있는 브랜드면 연결 경로(미분류는 빈 문자열)이고,
 * 트리가 없거나 아직 못 불러왔으면 undefined라 예전 `styles.category` 글자를 쓴다.
 */
export function styleCategoryFieldLabel(
  index: StyleCategoryIndex | null | undefined,
  styleId: string,
): string | undefined {
  return hasCategoryTree(index) ? styleCategoryLabel(index, styleId) : undefined
}

/**
 * 카테고리 필터 값(`all`, `none`, 카테고리 id)을 M번호 판정 함수로 바꾼다.
 * 고른 분류의 하위까지 포함하고 대표·추가 분류를 모두 본다.
 * 트리에 없는 값은 걸러내지 않는다(null).
 */
export function createStyleCategoryFilter(
  index: StyleCategoryIndex,
  value: string,
): ((styleId: string) => boolean) | null {
  if (!value || value === 'all') return null
  if (value === UNCATEGORIZED_FILTER) {
    return (styleId) => styleCategoryIds(index, styleId).length === 0
  }
  if (!index.tree.byId.has(value)) return null
  const ids = collectCategoryIds(index.tree, value)
  return (styleId) => styleCategoryIds(index, styleId).some((id) => ids.has(id))
}

export function isKnownCategoryFilter(
  tree: CategoryTree | null | undefined,
  value: string,
): boolean {
  if (!value || value === 'all') return false
  if (value === UNCATEGORIZED_FILTER) return true
  return Boolean(tree?.byId.has(value))
}

/** 카테고리마다 하위까지 합친 연결 M번호 수(대표·추가 분류 모두, M번호당 한 번) */
export function countStylesByCategory(
  index: StyleCategoryIndex,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const ids of index.byStyle.values()) {
    const touched = new Set<string>()
    for (const id of ids) {
      let current = index.tree.byId.get(id)
      while (current && !touched.has(current.id)) {
        touched.add(current.id)
        current = current.parentId ? index.tree.byId.get(current.parentId) : undefined
      }
    }
    for (const id of touched) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * 카페24 자사몰 카테고리 칸(`ALL | 홈 메뉴 ALL | BAG > TOTE > String`)을
 * 내부 트리에 연결할 경로 목록으로 바꾼다.
 * 진열용 칸(ALL·홈 메뉴 ALL·NEW ARRIVAL·`… > All`)과 더 깊은 경로가 있는 상위 경로는
 * 버리고, 남은 경로를 칸에 적힌 순서대로 돌려준다. 첫 번째가 대표다.
 */
export function parseMallCategoryCell(raw: string): MallCategoryPath[] {
  const paths: MallCategoryPath[] = []
  const seen = new Set<string>()
  for (const part of raw.split(MALL_PATH_DELIMITER)) {
    const names = part
      .split(MALL_SEGMENT_DELIMITER)
      .map((name) => name.trim())
      .filter(Boolean)
    if (names.length === 0) continue
    if (MALL_DISPLAY_ROOTS.has(normalizeSelectOptionLabel(names[0]!))) continue
    if (normalizeSelectOptionLabel(names[names.length - 1]!) === MALL_ALL_SEGMENT) {
      continue
    }
    const key = categoryPathKey(names)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push({ names, label: names.join(CATEGORY_PATH_SEPARATOR), key })
  }
  return paths.filter(
    (path) => !paths.some((other) => other.key.startsWith(`${path.key}>`)),
  )
}

export function resolveCategoryPath(
  tree: CategoryTree,
  path: MallCategoryPath,
): ResolvedCategoryPath {
  const category = tree.byPathKey.get(path.key)
  if (!category) return { ...path, status: 'missing', categoryId: null }
  if (hasChildCategories(tree, category.id)) {
    return { ...path, status: 'mid', categoryId: category.id }
  }
  if (!category.isActive) {
    return { ...path, status: 'inactive', categoryId: category.id }
  }
  return { ...path, status: 'ok', categoryId: category.id }
}
