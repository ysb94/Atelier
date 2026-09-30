import type {
  SabangnetCategoryApplyResult,
  StyleCategoryLink,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const COLUMNS = 'style_id, category_id, is_primary, sort_order'
const PAGE_SIZE = 1000
/** apply_sabangnet_style_categories가 한 번에 받는 최대 행 수 */
export const SABANGNET_CATEGORY_CHUNK_SIZE = 200

type StyleCategoryRow = {
  style_id: string
  category_id: string
  is_primary: boolean
  sort_order: number
}

type ApplyResultRow = {
  applied?: number
  styles?: number
  no_styles?: number
  missing?: number
}

export type SabangnetCategoryRowInput = {
  code: string
  /** 최하위 카테고리 id. 첫 번째가 대표다. */
  categoryIds: string[]
}

export class StyleCategoryStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StyleCategoryStoreError'
  }
}

function toLink(row: StyleCategoryRow): StyleCategoryLink {
  return {
    styleId: row.style_id,
    categoryId: row.category_id,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
  }
}

export async function listStyleCategories(
  brandId: string,
): Promise<StyleCategoryLink[]> {
  const supabase = getSupabase()
  const rows = await fetchAllPages<StyleCategoryRow>({
    pageSize: PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await supabase
        .from('style_categories')
        .select(COLUMNS, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('style_id')
        .order('sort_order')
        .order('id')
        .range(from, to)
      if (error) {
        throw new StyleCategoryStoreError(
          errorMessage(error, '상품 카테고리 연결을 불러오지 못했습니다.'),
        )
      }
      return {
        rows: (data as StyleCategoryRow[]) ?? [],
        count: count ?? null,
      }
    },
  })
  return rows.map(toLink)
}

/** M번호들의 카테고리를 같은 목록으로 교체한다. 빈 목록은 연결 해제다. */
export async function setStyleCategories(
  brandId: string,
  styleIds: string[],
  categoryIds: string[],
): Promise<number> {
  if (styleIds.length === 0) return 0
  const { data, error } = await getSupabase().rpc('set_style_categories', {
    p_brand_id: brandId,
    p_style_ids: styleIds,
    p_category_ids: categoryIds,
  })
  if (error) {
    throw new StyleCategoryStoreError(
      errorMessage(error, '상품 카테고리를 저장하지 못했습니다.'),
    )
  }
  return typeof data === 'number' ? data : 0
}

/**
 * 사방넷 코드별 카테고리를 200행씩 나눠 적용한다. 앞 묶음은 이미 저장되므로
 * 중간에 실패하면 몇 행까지 반영됐는지 오류 문구에 남긴다.
 */
export async function applySabangnetStyleCategories(
  brandId: string,
  rows: SabangnetCategoryRowInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<SabangnetCategoryApplyResult> {
  const total: SabangnetCategoryApplyResult = {
    applied: 0,
    styles: 0,
    noStyles: 0,
    missing: 0,
  }
  for (
    let start = 0;
    start < rows.length;
    start += SABANGNET_CATEGORY_CHUNK_SIZE
  ) {
    const chunk = rows.slice(start, start + SABANGNET_CATEGORY_CHUNK_SIZE)
    const { data, error } = await getSupabase().rpc(
      'apply_sabangnet_style_categories',
      {
        p_brand_id: brandId,
        p_rows: chunk.map((row) => ({
          code: row.code,
          category_ids: row.categoryIds,
        })),
      },
    )
    if (error) {
      const message = errorMessage(error, '카테고리를 적용하지 못했습니다.')
      throw new StyleCategoryStoreError(
        start > 0
          ? `${message} 앞의 ${start.toLocaleString('ko-KR')}행은 이미 적용했습니다. 같은 파일로 다시 적용하면 나머지를 이어서 반영합니다.`
          : message,
      )
    }
    const result = (data ?? {}) as ApplyResultRow
    total.applied += result.applied ?? 0
    total.styles += result.styles ?? 0
    total.noStyles += result.no_styles ?? 0
    total.missing += result.missing ?? 0
    onProgress?.(Math.min(start + chunk.length, rows.length), rows.length)
  }
  return total
}
