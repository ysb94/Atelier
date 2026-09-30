import { useMemo } from 'react'
import { useQueries, useQuery, type QueryClient } from '@tanstack/react-query'
import { getProductCategories, getStyleCategories } from '@/lib/api'
import {
  buildStyleCategoryIndex,
  type StyleCategoryIndex,
} from '@/lib/products/product-categories'
import { combineListQueries } from '@/lib/query/list-queries'
import type { ProductCategory, StyleCategoryLink } from '@/lib/types'

/** 상품 설정 카테고리 관리 화면과 같은 키다. 이름을 바꾸면 모든 화면이 함께 갱신된다. */
export function productCategoriesQueryKey(brandId: string) {
  return ['productCategories', brandId] as const
}

export function styleCategoriesQueryKey(brandId: string) {
  return ['styleCategories', brandId] as const
}

export async function invalidateStyleCategories(
  queryClient: QueryClient,
  brandId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: styleCategoriesQueryKey(brandId),
  })
}

export function useStyleCategoryIndex(
  brandId: string | null | undefined,
  enabled = true,
) {
  const active = enabled && Boolean(brandId)
  const categoriesQuery = useQuery({
    queryKey: productCategoriesQueryKey(brandId ?? ''),
    queryFn: () => getProductCategories(brandId!),
    enabled: active,
  })
  const linksQuery = useQuery({
    queryKey: styleCategoriesQueryKey(brandId ?? ''),
    queryFn: () => getStyleCategories(brandId!),
    enabled: active,
  })
  const index = useMemo<StyleCategoryIndex | null>(
    () =>
      categoriesQuery.data && linksQuery.data
        ? buildStyleCategoryIndex(categoriesQuery.data, linksQuery.data)
        : null,
    [categoriesQuery.data, linksQuery.data],
  )
  return {
    index,
    loading: active && (categoriesQuery.isLoading || linksQuery.isLoading),
    error: categoriesQuery.error ?? linksQuery.error ?? null,
  }
}

/** 회사 화면처럼 여러 브랜드를 함께 볼 때. 브랜드 id → 인덱스 */
export function useStyleCategoryIndexes(brandIds: readonly string[]) {
  const idsKey = brandIds.join(',')
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey])
  const categoryQueries = useQueries({
    queries: ids.map((brandId) => ({
      queryKey: productCategoriesQueryKey(brandId),
      queryFn: () => getProductCategories(brandId),
    })),
    combine: combineListQueries<ProductCategory>,
  })
  const linkQueries = useQueries({
    queries: ids.map((brandId) => ({
      queryKey: styleCategoriesQueryKey(brandId),
      queryFn: () => getStyleCategories(brandId),
    })),
    combine: combineListQueries<StyleCategoryLink>,
  })
  const indexes = useMemo(() => {
    const map = new Map<string, StyleCategoryIndex>()
    ids.forEach((brandId, i) => {
      const categories = categoryQueries.data[i]
      const links = linkQueries.data[i]
      if (categories && links) {
        map.set(brandId, buildStyleCategoryIndex(categories, links))
      }
    })
    return map
  }, [ids, categoryQueries.data, linkQueries.data])
  return {
    indexes,
    loading: categoryQueries.loading || linkQueries.loading,
    failed:
      categoryQueries.errorIndexes.length > 0 ||
      linkQueries.errorIndexes.length > 0,
  }
}
