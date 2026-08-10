import { useMemo } from 'react'
import { ProductThumb } from '@/components/products/ProductThumb'
import { OWNER_LABEL } from '@/lib/import/fields'
import { pickImageSources } from '@/lib/products/product-image'
import { fieldValueKey } from '@/lib/products/style-fields'
import type { BrandField, FieldOwner } from '@/lib/types'
import { cn } from '@/lib/utils'

export type SheetRow = {
  id: string
  styleNo: string
  /** fieldValueKey -> 화면에 보일 문자열 */
  values: Record<string, string>
}

type OwnerGroup = {
  owner: FieldOwner | 'pin'
  label: string
  span: number
}

function buildOwnerGroups(columns: BrandField[]): OwnerGroup[] {
  const groups: OwnerGroup[] = []
  for (const column of columns) {
    const owner: FieldOwner | 'pin' =
      column.systemKey === 'styleNo' || column.systemKey === 'name'
        ? 'pin'
        : column.owner
    const label = owner === 'pin' ? '식별' : OWNER_LABEL[owner]
    const last = groups[groups.length - 1]
    if (last && last.owner === owner) last.span += 1
    else groups.push({ owner, label, span: 1 })
  }
  return groups
}

/** 첫 열 너비. 두 번째 열의 고정 위치와 반드시 같아야 한다. */
const COL0_WIDTH = 140

/** 긴 값이 열을 끝없이 넓히지 않도록 막는다. */
const MAX_CELL_WIDTH = 260

function stickyLeft(colIndex: number): number | undefined {
  if (colIndex === 0) return 0
  if (colIndex === 1) return COL0_WIDTH
  return undefined
}

/**
 * 읽기 전용 상품 표.
 * 값 수정은 내보내기 → 엑셀 → 일괄 업로드로만 한다.
 * 칸마다 선택·편집 상태를 들지 않아서 열이 많아도 스크롤이 가볍다.
 * 범위를 끌어 복사하면 표 그대로 엑셀에 붙는다.
 */
export function SheetTable({
  columns,
  rows,
  showOwnerGroups = false,
}: {
  columns: BrandField[]
  rows: SheetRow[]
  showOwnerGroups?: boolean
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
              {ownerGroups.map((group, index) => (
                <th
                  key={`${group.owner}-${index}`}
                  colSpan={group.span}
                  className="sticky top-0 z-20 border-b border-border bg-muted px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {group.label}
                </th>
              ))}
            </tr>
          ) : null}
          <tr>
            {columns.map((column, colIndex) => {
              const left = stickyLeft(colIndex)
              return (
                <th
                  key={fieldValueKey(column)}
                  className={cn(
                    'sticky z-20 border-b border-border bg-muted/90 px-2 py-1.5 font-medium backdrop-blur',
                    left !== undefined && 'z-30',
                  )}
                  style={{
                    left,
                    top: topOffset,
                    minWidth: colIndex === 0 ? COL0_WIDTH : 96,
                  }}
                >
                  <span className="whitespace-nowrap">{column.label}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={Math.max(columns.length, 1)}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                조건에 맞는 상품이 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="group/row hover:bg-muted/20">
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
                          'sticky z-10 bg-card group-hover/row:bg-muted/20',
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
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
