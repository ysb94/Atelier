import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CategoryPicker } from '@/components/products/CategoryPicker'
import { Button } from '@/components/ui/button'
import { setStyleCategories } from '@/lib/api'
import {
  findUnsavableCategoryIds,
  sameCategoryIds,
  type CategoryTree,
} from '@/lib/products/product-categories'
import { invalidateStyleCategories } from '@/lib/products/use-style-category-index'

/**
 * 상품 상세에서 M번호 하나의 카테고리를 고친다.
 * 같은 사방넷 코드에 묶인 다른 M번호(다른 색상·사이즈)는 건드리지 않는다.
 */
export function StyleCategoryEditor({
  brandId,
  styleId,
  tree,
  savedIds,
  sabangnetCode,
}: {
  brandId: string
  styleId: string
  tree: CategoryTree
  savedIds: readonly string[]
  sabangnetCode?: string
}) {
  const queryClient = useQueryClient()
  /** 고치는 중일 때만 값이 있다. 없으면 저장된 연결을 그대로 보인다. */
  const [draft, setDraft] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const value = draft ?? savedIds
  const dirty = draft !== null && !sameCategoryIds(draft, savedIds)
  const unsavable = findUnsavableCategoryIds(tree, value)

  const mutation = useMutation({
    mutationFn: (ids: string[]) => setStyleCategories(brandId, [styleId], ids),
    onSuccess: async () => {
      setError(null)
      await invalidateStyleCategories(queryClient, brandId)
      setDraft(null)
      setSaved(true)
    },
    onError: (err) => {
      console.warn('[product-detail] 카테고리 저장 실패', {
        brandId,
        styleId,
        err,
      })
      setError(
        err instanceof Error ? err.message : '카테고리를 저장하지 못했습니다.',
      )
    },
  })

  return (
    <div className="space-y-2">
      <CategoryPicker
        tree={tree}
        value={value}
        disabled={mutation.isPending}
        onChange={(next) => {
          setDraft(next)
          setSaved(false)
          setError(null)
        }}
      />
      <p className="text-xs text-muted-foreground">
        이 M번호에만 저장합니다.
        {sabangnetCode
          ? ` 사방넷 코드 ${sabangnetCode}에 묶인 M번호를 한 번에 바꾸려면 사방넷 코드 관리에서 수정하세요.`
          : ''}
      </p>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {dirty || saved ? (
        <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => {
                  setDraft(null)
                  setError(null)
                }}
              >
                되돌리기
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={mutation.isPending || unsavable.length > 0}
                onClick={() => mutation.mutate([...value])}
              >
                {mutation.isPending ? '저장 중...' : '카테고리 저장'}
              </Button>
            </>
          ) : (
            <span className="text-xs text-success">저장했습니다.</span>
          )}
        </div>
      ) : null}
    </div>
  )
}
