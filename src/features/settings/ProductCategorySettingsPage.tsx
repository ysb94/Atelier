import {
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ProductCategoryStoreError,
  createProductCategory,
  deleteProductCategory,
  getProductCategories,
  moveProductCategory,
  updateProductCategory,
} from '@/lib/api'
import { useRenderWatch } from '@/lib/diagnostics'
import type { ProductCategory } from '@/lib/types'
import { cn, emptyList, formatNumber } from '@/lib/utils'

type CreateTarget = {
  parentId: string | null
}

function categoryQueryKey(brandId: string) {
  return ['productCategories', brandId] as const
}

function categoryErrorMessage(error: unknown) {
  if (error instanceof ProductCategoryStoreError) return error.message
  if (error instanceof Error) return error.message
  return '카테고리를 저장하지 못했습니다.'
}

function sortCategories(categories: readonly ProductCategory[]) {
  return [...categories].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name, 'ko'),
  )
}

export function ProductCategorySettingsPage() {
  useRenderWatch('ProductCategorySettingsPage')
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string> | null>(null)
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null)
  const [newName, setNewName] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftActive, setDraftActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const categoriesQuery = useQuery({
    queryKey: categoryQueryKey(brand.id),
    queryFn: () => getProductCategories(brand.id),
  })
  const categories = useMemo(
    () => categoriesQuery.data ?? emptyList<ProductCategory>(),
    [categoriesQuery.data],
  )
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const childrenByParent = useMemo(() => {
    const index = new Map<string | null, ProductCategory[]>()
    for (const category of categories) {
      const group = index.get(category.parentId) ?? []
      group.push(category)
      index.set(category.parentId, group)
    }
    for (const [parentId, children] of index) {
      index.set(parentId, sortCategories(children))
    }
    return index
  }, [categories])
  const defaultExpandedIds = useMemo(
    () =>
      new Set(
        categories
          .filter(
            (category) => (childrenByParent.get(category.id)?.length ?? 0) > 0,
          )
          .map((category) => category.id),
      ),
    [categories, childrenByParent],
  )
  const openIds = expandedIds ?? defaultExpandedIds
  const selectedCategory = selectedId
    ? (categoryById.get(selectedId) ?? null)
    : null
  const selectedChildren = selectedCategory
    ? (childrenByParent.get(selectedCategory.id) ?? emptyList<ProductCategory>())
    : emptyList<ProductCategory>()

  useEffect(() => {
    if (categories.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!selectedId || !categoryById.has(selectedId)) {
      const firstRoot = childrenByParent.get(null)?.[0]
      setSelectedId(firstRoot?.id ?? sortCategories(categories)[0]?.id ?? null)
    }
  }, [categories, categoryById, childrenByParent, selectedId])

  useEffect(() => {
    if (!selectedCategory) return
    setDraftName(selectedCategory.name)
    setDraftActive(selectedCategory.isActive)
  }, [selectedCategory])

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: categoryQueryKey(brand.id),
    })
  }

  const createMutation = useMutation({
    mutationFn: ({
      name,
      parentId,
    }: {
      name: string
      parentId: string | null
    }) => createProductCategory(brand.id, { name, parentId }),
    onSuccess: async (created) => {
      queryClient.setQueryData<ProductCategory[]>(
        categoryQueryKey(brand.id),
        (current) => [...(current ?? emptyList<ProductCategory>()), created],
      )
      setSelectedId(created.id)
      setExpandedIds((current) => {
        const next = new Set(current ?? defaultExpandedIds)
        if (created.parentId) next.add(created.parentId)
        return next
      })
      setCreateTarget(null)
      setNewName('')
      setError(null)
      await invalidate()
    },
    onError: (mutationError) => setError(categoryErrorMessage(mutationError)),
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      name,
      isActive,
    }: {
      id: string
      name: string
      isActive: boolean
    }) => updateProductCategory(brand.id, id, { name, isActive }),
    onSuccess: async () => {
      setError(null)
      await invalidate()
    },
    onError: (mutationError) => setError(categoryErrorMessage(mutationError)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProductCategory(brand.id, id),
    onSuccess: async (_, deletedId) => {
      setSelectedId((current) => (current === deletedId ? null : current))
      setError(null)
      await invalidate()
    },
    onError: (mutationError) => setError(categoryErrorMessage(mutationError)),
  })

  const moveMutation = useMutation({
    mutationFn: ({
      id,
      direction,
    }: {
      id: string
      direction: -1 | 1
    }) => moveProductCategory(brand.id, id, direction),
    onSuccess: invalidate,
    onError: (mutationError) => setError(categoryErrorMessage(mutationError)),
  })

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    moveMutation.isPending

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current ?? defaultExpandedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openCreate(parentId: string | null) {
    setCreateTarget({ parentId })
    setNewName('')
    setError(null)
    if (parentId) {
      setExpandedIds((current) => {
        const next = new Set(current ?? defaultExpandedIds)
        next.add(parentId)
        return next
      })
    }
  }

  function pathFor(category: ProductCategory) {
    const names = [category.name]
    let parentId = category.parentId
    const visited = new Set([category.id])
    while (parentId) {
      if (visited.has(parentId)) break
      visited.add(parentId)
      const parent = categoryById.get(parentId)
      if (!parent) break
      names.unshift(parent.name)
      parentId = parent.parentId
    }
    return names.join(' › ')
  }

  function renderCategory(category: ProductCategory) {
    const children =
      childrenByParent.get(category.id) ?? emptyList<ProductCategory>()
    const hasChildren = children.length > 0
    const expanded = openIds.has(category.id)
    const siblings =
      childrenByParent.get(category.parentId) ?? emptyList<ProductCategory>()
    const siblingIndex = siblings.findIndex((item) => item.id === category.id)
    const selected = category.id === selectedId

    return (
      <li key={category.id}>
        <div
          className={cn(
            'group flex min-h-10 items-center gap-1 rounded-md pr-1',
            selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
            !category.isActive && 'opacity-60',
          )}
          style={{ paddingLeft: `${Math.max(0, category.depth - 1) * 20 + 4}px` }}
        >
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted"
            aria-label={
              hasChildren
                ? `${category.name} ${expanded ? '접기' : '펼치기'}`
                : `${category.name} 최하위 카테고리`
            }
            disabled={!hasChildren}
            onClick={() => {
              if (hasChildren) toggleExpanded(category.id)
            }}
          >
            {hasChildren ? (
              expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )
            ) : (
              <span className="size-1.5 rounded-full bg-muted-foreground/50" />
            )}
          </button>
          <button
            type="button"
            className="min-w-0 flex-1 py-2 text-left text-sm"
            onClick={() => {
              setSelectedId(category.id)
              setCreateTarget(null)
              setError(null)
            }}
          >
            <span className="truncate font-medium">{category.name}</span>
          </button>
          {!category.isActive ? <Badge variant="muted">중지</Badge> : null}
          {!hasChildren ? <Badge variant="outline">최하위</Badge> : null}
          <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`${category.name} 위로`}
              disabled={pending || siblingIndex <= 0}
              onClick={() =>
                moveMutation.mutate({ id: category.id, direction: -1 })
              }
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`${category.name} 아래로`}
              disabled={pending || siblingIndex >= siblings.length - 1}
              onClick={() =>
                moveMutation.mutate({ id: category.id, direction: 1 })
              }
            >
              <ArrowDown className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`${category.name} 하위 카테고리 추가`}
              disabled={pending || !category.isActive}
              onClick={() => openCreate(category.id)}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>
        {hasChildren && expanded ? (
          <ul>{children.map((child) => renderCategory(child))}</ul>
        ) : null}
      </li>
    )
  }

  const createParent = createTarget?.parentId
    ? (categoryById.get(createTarget.parentId) ?? null)
    : null

  return (
    <div>
      <PageHeader
        title="카테고리 관리"
        description={`${brand.name} 상품의 내부 분류 트리를 관리합니다. 카페24 번호와 ALL 메뉴는 사용하지 않습니다.`}
        actions={
          <Button type="button" onClick={() => openCreate(null)}>
            <Plus className="size-4" />
            최상위 카테고리
          </Button>
        }
      />

      <div className="mb-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        이번 단계는 카테고리 구성만 관리합니다. 상품 등록 연결은 다음 단계에서
        추가하며, 그때는 하위 항목이 없는 최하위 카테고리만 선택하게 됩니다.
      </div>

      {error ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button
            type="button"
            className="shrink-0"
            aria-label="오류 닫기"
            onClick={() => setError(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderTree className="size-4" />
                카테고리 구성
              </CardTitle>
              <CardDescription>
                {formatNumber(categories.length)}개 분류 · 이름을 눌러
                수정하거나 + 버튼으로 하위 분류를 추가하세요.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {categoriesQuery.isLoading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                카테고리를 불러오는 중...
              </p>
            ) : categoriesQuery.isError ? (
              <div className="py-10 text-center">
                <p className="text-sm text-danger">
                  {categoryErrorMessage(categoriesQuery.error)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => void categoriesQuery.refetch()}
                >
                  다시 불러오기
                </Button>
              </div>
            ) : categories.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  등록된 카테고리가 없습니다.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => openCreate(null)}
                >
                  첫 카테고리 추가
                </Button>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {(childrenByParent.get(null) ?? emptyList<ProductCategory>()).map(
                  (category) => renderCategory(category),
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {createTarget ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {createParent
                    ? `${createParent.name} 하위 카테고리 추가`
                    : '최상위 카테고리 추가'}
                </CardTitle>
                <CardDescription>
                  {createParent
                    ? `${pathFor(createParent)} 아래에 새 분류를 만듭니다.`
                    : '상품 분류의 첫 단계를 만듭니다.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!newName.trim()) return
                    createMutation.mutate({
                      name: newName,
                      parentId: createTarget.parentId,
                    })
                  }}
                >
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">카테고리 이름</span>
                    <Input
                      autoFocus
                      value={newName}
                      disabled={createMutation.isPending}
                      placeholder="예: WALLET"
                      onChange={(event) => {
                        setNewName(event.target.value)
                        setError(null)
                      }}
                    />
                  </label>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={createMutation.isPending}
                      onClick={() => {
                        setCreateTarget(null)
                        setNewName('')
                      }}
                    >
                      취소
                    </Button>
                    <Button
                      type="submit"
                      disabled={!newName.trim() || createMutation.isPending}
                    >
                      <Plus className="size-4" />
                      추가
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : selectedCategory ? (
            <Card>
              <CardHeader>
                <CardTitle>카테고리 수정</CardTitle>
                <CardDescription>{pathFor(selectedCategory)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">카테고리 이름</span>
                  <Input
                    value={draftName}
                    disabled={updateMutation.isPending}
                    onChange={(event) => {
                      setDraftName(event.target.value)
                      setError(null)
                    }}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={draftActive}
                    disabled={updateMutation.isPending}
                    onChange={(event) => setDraftActive(event.target.checked)}
                  />
                  신규 분류에서 사용
                </label>
                <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {selectedChildren.length > 0
                    ? `하위 카테고리 ${formatNumber(selectedChildren.length)}개가 있어 상위 분류로 사용됩니다.`
                    : '현재 최하위 카테고리입니다. 상품 연결 단계에서는 이 분류를 선택할 수 있습니다.'}
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending || selectedChildren.length > 0}
                    title={
                      selectedChildren.length > 0
                        ? '하위 카테고리부터 삭제하세요.'
                        : undefined
                    }
                    onClick={() => {
                      const ok = window.confirm(
                        `"${selectedCategory.name}" 카테고리를 삭제할까요?`,
                      )
                      if (ok) deleteMutation.mutate(selectedCategory.id)
                    }}
                  >
                    <Trash2 className="size-4" />
                    삭제
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending || !selectedCategory.isActive}
                      onClick={() => openCreate(selectedCategory.id)}
                    >
                      <Plus className="size-4" />
                      하위 추가
                    </Button>
                    <Button
                      type="button"
                      disabled={!draftName.trim() || pending}
                      onClick={() =>
                        updateMutation.mutate({
                          id: selectedCategory.id,
                          name: draftName,
                          isActive: draftActive,
                        })
                      }
                    >
                      <Save className="size-4" />
                      저장
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                왼쪽에서 카테고리를 선택하세요.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">운영 원칙</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs leading-5 text-muted-foreground">
              <p>• ALL은 저장하지 않고 각 상위 분류의 전체 보기로 계산합니다.</p>
              <p>• 카페24 카테고리 번호는 저장하거나 관리하지 않습니다.</p>
              <p>• 하위 분류가 있는 카테고리는 하위 항목을 먼저 삭제해야 합니다.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
