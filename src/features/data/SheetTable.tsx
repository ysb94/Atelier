import { useMemo } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { ProductThumb } from '@/components/products/ProductThumb'
import { OWNER_LABEL } from '@/lib/import/fields'
import { pickImageSources } from '@/lib/products/product-image'
import { fieldValueKey } from '@/lib/products/style-fields'
import type { BrandField, FieldOwner } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { SheetSort } from './sheet-sort'

export type SheetRow = {
  id: string
  styleNo: string
  /** fieldValueKey -> 화면에 보일 문자열 */
  values: Record<string, string>
}

/** 첫 열 너비. 두 번째 열의 고정 위치와 반드시 같아야 한다. */
const COL0_WIDTH = 140
const STICKY_COL_COUNT = 2

/** 긴 값이 열을 끝없이 넓히지 않도록 막는다. */
const MAX_CELL_WIDTH = 260

type OwnerGroup = {
  owner: FieldOwner | 'pin'
  label: string
  span: number
  startCol: number
}

function columnOwner(column: BrandField): FieldOwner | 'pin' {
  if (
    column.systemKey === 'styleNo' ||
    column.systemKey === 'name' ||
    column.systemKey === 'ownBarcode'
  ) {
    return 'pin'
  }
  return column.owner
}

/**
 * 소유자 그룹. 가로 고정 열과 스크롤 열을 한 칸으로 묶지 않는다.
 * 묶으면 고정 열 헤더는 남고 그룹 라벨만 밀려 헤더가 어긋난다.
 */
function buildOwnerGroups(columns: BrandField[]): OwnerGroup[] {
  const groups: OwnerGroup[] = []
  for (let i = 0; i < columns.length; i++) {
    const owner = columnOwner(columns[i])
    const label = owner === 'pin' ? '식별' : OWNER_LABEL[owner]
    const last = groups[groups.length - 1]
    const crossesFreeze =
      last !== undefined &&
      last.startCol < STICKY_COL_COUNT &&
      i >= STICKY_COL_COUNT
    if (last && last.owner === owner && !crossesFreeze) last.span += 1
    else groups.push({ owner, label, span: 1, startCol: i })
  }
  return groups
}

function stickyLeft(colIndex: number): number | undefined {
  if (colIndex === 0) return 0
  if (colIndex === 1) return COL0_WIDTH
  return undefined
}

function groupStickyLeft(group: OwnerGroup): number | undefined {
  if (group.startCol + group.span > STICKY_COL_COUNT) return undefined
  return stickyLeft(group.startCol)
}

/**
 * 상품 데이터 표.
 * 행 또는 수정 버튼으로 단건 편집 서랍을 열 수 있다.
 * 칸마다 선택·편집 상태를 들지 않아서 열이 많아도 스크롤이 가볍다.
 * 범위를 끌어 복사하면 표 그대로 엑셀에 붙는다.
 */
export function SheetTable({
  columns,
  rows,
  showOwnerGroups = false,
  onRowOpen,
  sort = null,
  onSort,
}: {
  columns: BrandField[]
  rows: SheetRow[]
  showOwnerGroups?: boolean
  /** 행을 누르면 단건 수정 화면으로 연다. */
  onRowOpen?: (row: SheetRow) => void
  /** 지금 정렬 중인 열. 없으면 서버가 주는 M번호 순이다. */
  sort?: SheetSort | null
  /** 헤더를 누르면 그 열을 오름차순, 한 번 더 누르면 내림차순으로 바꾼다. */
  onSort?: (key: string) => void
}) {
  const ownerGroups = useMemo(
    () => (showOwnerGroups ? buildOwnerGroups(columns) : []),
    [showOwnerGroups, columns],
  )
  const topOffset = ownerGroups.length > 0 ? 28 : 0

  return (
    <div className="overflow-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="min-w-full border-separate border-spacing-0 text-left text-[13px] tabular-nums">
        <thead>
          {ownerGroups.length > 0 ? (
            <tr>
              {ownerGroups.map((group, index) => {
                const left = groupStickyLeft(group)
                return (
                  <th
                    key={`${group.owner}-${index}`}
                    colSpan={group.span}
                    className={cn(
                      'sticky top-0 z-20 border-b border-border bg-muted px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground',
                      left !== undefined && 'z-30',
                    )}
                    style={left !== undefined ? { left } : undefined}
                  >
                    {group.label}
                  </th>
                )
              })}
              {onRowOpen ? (
                <th
                  className="sticky top-0 z-20 border-b border-border bg-muted px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  colSpan={1}
                >
                  수정
                </th>
              ) : null}
            </tr>
          ) : null}
          <tr>
            {columns.map((column, colIndex) => {
              const left = stickyLeft(colIndex)
              const key = fieldValueKey(column)
              const active = sort?.key === key
              const nextDirection =
                active && sort.direction === 'asc' ? '내림차순' : '오름차순'
              return (
                <th
                  key={key}
                  aria-sort={
                    active
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className={cn(
                    'sticky z-20 border-b border-border bg-muted p-0 font-medium',
                    left !== undefined && 'z-30',
                  )}
                  style={{
                    left,
                    top: topOffset,
                    minWidth: colIndex === 0 ? COL0_WIDTH : 96,
                  }}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 px-2 py-1.5 text-left hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={`${column.label} ${nextDirection}`}
                    onClick={() => onSort?.(key)}
                  >
                    <span className="whitespace-nowrap">{column.label}</span>
                    {active ? (
                      sort.direction === 'asc' ? (
                        <ChevronUp className="size-3.5 shrink-0" aria-hidden />
                      ) : (
                        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                      )
                    ) : null}
                  </button>
                </th>
              )
            })}
            {onRowOpen ? (
              <th className="sticky top-0 z-20 w-16 border-b border-border bg-muted px-2 py-1.5 text-center font-medium">
                수정
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={Math.max(columns.length + (onRowOpen ? 1 : 0), 1)}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                조건에 맞는 상품이 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  'group/row hover:bg-muted/20',
                  onRowOpen && 'cursor-pointer',
                )}
                onClick={onRowOpen ? () => onRowOpen(row) : undefined}
              >
                {columns.map((column, colIndex) => {
                  const key = fieldValueKey(column)
                  const left = stickyLeft(colIndex)
                  const display = row.values[key] ?? ''

                  return (
                    <td
                      key={key}
                      className={cn(
                        'border-b border-border px-0 py-0',
                        left !== undefined &&
                          'sticky z-10 bg-card group-hover/row:bg-[color-mix(in_srgb,var(--color-muted)_20%,var(--color-card))]',
                      )}
                      style={{ left }}
                    >
                      {column.type === 'image' ? (
                        <div className="flex h-8 items-center gap-2 px-2">
                          <ProductThumb
                            sources={pickImageSources(
                              display,
                              row.styleNo,
                              key,
                            )}
                            alt={row.styleNo}
                          />
                          <span className="truncate text-muted-foreground">
                            {display}
                          </span>
                        </div>
                      ) : (
                        <div
                          className="flex h-8 items-center truncate px-2"
                          style={{ maxWidth: MAX_CELL_WIDTH }}
                          title={display || undefined}
                        >
                          {display || (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </div>
                      )}
                    </td>
                  )
                })}
                {onRowOpen ? (
                  <td className="border-b border-border px-2 py-0 text-center">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(event) => {
                        event.stopPropagation()
                        onRowOpen(row)
                      }}
                    >
                      수정
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
