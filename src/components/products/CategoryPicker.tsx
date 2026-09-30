import { useMemo, useState } from 'react'
import { Star, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { normalizeSelectOptionLabel } from '@/lib/products/brand-field-select'
import {
  CATEGORY_PATH_SEPARATOR,
  categoryPathLabel,
  findUnsavableCategoryIds,
  listLeafCategories,
  type CategoryTree,
} from '@/lib/products/product-categories'
import { cn } from '@/lib/utils'

type PickerItem = {
  id: string
  label: string
  path: string
  inactive: boolean
}

type PickerGroup = {
  rootId: string
  rootName: string
  items: PickerItem[]
}

/**
 * 최하위 카테고리 여러 개와 대표를 고른다. 첫 번째가 대표(카테고리별 집계 기준)다.
 * 사용 안 함 카테고리는 이미 고른 경우에만 보여 준다.
 */
export function CategoryPicker({
  tree,
  value,
  onChange,
  disabled,
  className,
}: {
  tree: CategoryTree
  value: readonly string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
}) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const byRoot = new Map<string, PickerGroup>()
    for (const leaf of listLeafCategories(tree)) {
      if (!leaf.isActive && !value.includes(leaf.id)) continue
      const names = tree.pathNamesById.get(leaf.id) ?? [leaf.name]
      const rootName = names[0] ?? leaf.name
      const group = byRoot.get(rootName) ?? {
        rootId: rootName,
        rootName,
        items: [],
      }
      group.items.push({
        id: leaf.id,
        label:
          names.length > 1
            ? names.slice(1).join(CATEGORY_PATH_SEPARATOR)
            : leaf.name,
        path: names.join(CATEGORY_PATH_SEPARATOR),
        inactive: !leaf.isActive,
      })
      byRoot.set(rootName, group)
    }
    return [...byRoot.values()]
  }, [tree, value])

  const keyword = normalizeSelectOptionLabel(query)
  const visibleGroups = useMemo(() => {
    if (!keyword) return groups
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          normalizeSelectOptionLabel(item.path).includes(keyword),
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [groups, keyword])

  const unsavable = useMemo(
    () => new Set(findUnsavableCategoryIds(tree, value)),
    [tree, value],
  )

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((item) => item !== id))
    else onChange([...value, id])
  }

  function makePrimary(id: string) {
    onChange([id, ...value.filter((item) => item !== id)])
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex min-h-8 flex-wrap items-center gap-1.5">
        {value.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            고른 카테고리가 없습니다. 저장하면 미분류가 됩니다.
          </span>
        ) : (
          value.map((id, index) => (
            <span
              key={id}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs',
                index === 0
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card',
                unsavable.has(id) && 'border-danger/40 bg-danger/5 text-danger',
              )}
            >
              {index === 0 ? (
                <Star
                  className="size-3 shrink-0 fill-current text-primary"
                  aria-label="대표"
                />
              ) : (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-50"
                  title="대표로 지정"
                  aria-label={`${categoryPathLabel(tree, id)} 대표로 지정`}
                  disabled={disabled}
                  onClick={() => makePrimary(id)}
                >
                  <Star className="size-3" />
                </button>
              )}
              <span className="truncate">
                {categoryPathLabel(tree, id) || '삭제된 카테고리'}
              </span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label={`${categoryPathLabel(tree, id) || '카테고리'} 빼기`}
                disabled={disabled}
                onClick={() => onChange(value.filter((item) => item !== id))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>
      {unsavable.size > 0 ? (
        <p className="text-xs text-danger">
          빨간 항목은 사용 안 함이거나 하위가 생겨 저장할 수 없습니다. 빼고 다시
          고르세요.
        </p>
      ) : value.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          ★가 대표입니다(카테고리별 집계 기준). 다른 항목의 ☆를 누르면 대표가
          바뀝니다.
        </p>
      ) : null}
      <Input
        value={query}
        placeholder="카테고리 검색 (예: tote, 크로스)"
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        {visibleGroups.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {groups.length === 0
              ? '고를 수 있는 최하위 카테고리가 없습니다. 상품 설정의 카테고리 관리에서 먼저 만드세요.'
              : '검색어와 맞는 카테고리가 없습니다.'}
          </p>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.rootId}>
              <div className="sticky top-0 z-[1] border-b border-border bg-muted/90 px-3 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground backdrop-blur">
                {group.rootName}
              </div>
              <ul>
                {group.items.map((item) => {
                  const position = value.indexOf(item.id)
                  return (
                    <li key={item.id}>
                      <label
                        className={cn(
                          'flex items-center gap-2 px-3 py-1.5 text-sm',
                          disabled
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer hover:bg-muted/60',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={position >= 0}
                          disabled={disabled}
                          onChange={() => toggle(item.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                        {position === 0 ? <Badge>대표</Badge> : null}
                        {item.inactive ? (
                          <Badge variant="muted">사용 안 함</Badge>
                        ) : null}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
