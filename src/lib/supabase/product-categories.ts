import type {
  ProductCategory,
  ProductCategoryInput,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const COLUMNS =
  'id, brand_id, parent_id, name, depth, sort_order, is_active, created_at, updated_at'
const PAGE_SIZE = 1000

type ProductCategoryRow = {
  id: string
  brand_id: string
  parent_id: string | null
  name: string
  depth: number
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export class ProductCategoryStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductCategoryStoreError'
  }
}

function toProductCategory(row: ProductCategoryRow): ProductCategory {
  return {
    id: row.id,
    brandId: row.brand_id,
    parentId: row.parent_id,
    name: row.name,
    depth: row.depth,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function categoryError(
  error: { code?: string; message?: string } | null,
  fallback: string,
) {
  if (error && isUniqueViolation(error)) {
    return new ProductCategoryStoreError(
      '같은 상위 분류에 같은 이름의 카테고리가 이미 있습니다.',
    )
  }
  if (
    error?.code === '23503' ||
    /product_categories_parent_fkey/i.test(error?.message ?? '')
  ) {
    return new ProductCategoryStoreError(
      '하위 카테고리가 있어 삭제할 수 없습니다. 하위 카테고리부터 삭제하세요.',
    )
  }
  return new ProductCategoryStoreError(errorMessage(error, fallback))
}

function categoryName(input: string) {
  const name = input.trim()
  if (!name) {
    throw new ProductCategoryStoreError('카테고리 이름을 입력하세요.')
  }
  return name
}

export async function listProductCategories(
  brandId: string,
): Promise<ProductCategory[]> {
  const supabase = getSupabase()
  const rows = await fetchAllPages<ProductCategoryRow>({
    pageSize: PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await supabase
        .from('product_categories')
        .select(COLUMNS, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('depth')
        .order('sort_order')
        .order('name')
        .range(from, to)
      if (error) {
        throw categoryError(error, '카테고리를 불러오지 못했습니다.')
      }
      return {
        rows: (data as ProductCategoryRow[]) ?? [],
        count: count ?? null,
      }
    },
  })
  return rows.map(toProductCategory)
}

export async function createProductCategory(
  brandId: string,
  input: ProductCategoryInput,
): Promise<ProductCategory> {
  const name = categoryName(input.name)
  const parentId = input.parentId ?? null
  const current = await listProductCategories(brandId)
  if (parentId && !current.some((category) => category.id === parentId)) {
    throw new ProductCategoryStoreError('상위 카테고리를 찾을 수 없습니다.')
  }
  const sortOrder =
    current
      .filter((category) => category.parentId === parentId)
      .reduce(
        (highest, category) => Math.max(highest, category.sortOrder),
        -1,
      ) + 1

  const { data, error } = await getSupabase()
    .from('product_categories')
    .insert({
      brand_id: brandId,
      parent_id: parentId,
      name,
      sort_order: sortOrder,
      is_active: input.isActive ?? true,
    })
    .select(COLUMNS)
    .single()

  if (error || !data) {
    throw categoryError(error, '카테고리를 추가하지 못했습니다.')
  }
  return toProductCategory(data as ProductCategoryRow)
}

export async function updateProductCategory(
  brandId: string,
  categoryId: string,
  input: Pick<ProductCategoryInput, 'name' | 'isActive'>,
): Promise<ProductCategory> {
  const payload: { name: string; is_active?: boolean } = {
    name: categoryName(input.name),
  }
  if (input.isActive !== undefined) payload.is_active = input.isActive

  const { data, error } = await getSupabase()
    .from('product_categories')
    .update(payload)
    .eq('brand_id', brandId)
    .eq('id', categoryId)
    .select(COLUMNS)
    .maybeSingle()

  if (error) {
    throw categoryError(error, '카테고리를 수정하지 못했습니다.')
  }
  if (!data) {
    throw new ProductCategoryStoreError(
      '수정할 카테고리를 찾지 못했거나 권한이 없습니다.',
    )
  }
  return toProductCategory(data as ProductCategoryRow)
}

export async function deleteProductCategory(
  brandId: string,
  categoryId: string,
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('product_categories')
    .delete()
    .eq('brand_id', brandId)
    .eq('id', categoryId)
    .select('id')

  if (error) {
    throw categoryError(error, '카테고리를 삭제하지 못했습니다.')
  }
  if (!data?.length) {
    throw new ProductCategoryStoreError(
      '삭제할 카테고리를 찾지 못했거나 권한이 없습니다.',
    )
  }
}

export async function moveProductCategory(
  brandId: string,
  categoryId: string,
  direction: -1 | 1,
): Promise<void> {
  const { error } = await getSupabase().rpc('move_product_category', {
    p_brand_id: brandId,
    p_category_id: categoryId,
    p_direction: direction,
  })
  if (error) {
    throw categoryError(error, '카테고리 순서를 바꾸지 못했습니다.')
  }
}
