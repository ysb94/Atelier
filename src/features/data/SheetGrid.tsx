import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type { BrandField, Season } from '@/lib/types'
import { formatSeasonLabel } from '@/lib/types'
import { fieldValueKey } from '@/lib/products/style-fields'
import { cn } from '@/lib/utils'

export type SheetRowModel = {
  id: string
  styleId: string | null
  /** fieldValueKey -> raw string */
  values: Record<string, string>
  rowError?: string
}

export type CellErrorMap = Map<string, string>

export function cellErrorKey(rowId: string, colKey: string) {
  return `${rowId}::${colKey}`
}

function parseTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n')
  if (lines.length === 1 && lines[0] === '') return [[]]
  return lines.map((line) => line.split('\t'))
}

function toTsv(matrix: string[][]): string {
  return matrix.map((row) => row.join('\t')).join('\n')
}

type SheetGridProps = {
  columns: BrandField[]
  rows: SheetRowModel[]
  seasons: Season[]
  cellErrors: CellErrorMap
  saving?: boolean
  onCommitCell: (
    row: SheetRowModel,
    column: BrandField,
    value: string,
  ) => void | Promise<void>
  onPasteMatrix: (args: {
    startRow: number
    startCol: number
    matrix: string[][]
  }) => void | Promise<void>
  onClearRange: (args: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  }) => void | Promise<void>
  onAddColumn?: () => void
  onRenameColumn?: (field: BrandField, label: string) => void
  onDeleteColumn?: (field: BrandField) => void
}

export function SheetGrid({
  columns,
  rows,
  seasons,
  cellErrors,
  saving,
  onCommitCell,
  onPasteMatrix,
  onClearRange,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
}: SheetGridProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)
  const [focus, setFocus] = useState({ row: 0, col: 0 })
  const [anchor, setAnchor] = useState({ row: 0, col: 0 })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [renamingCol, setRenamingCol] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const seasonOptions = useMemo(
    () =>
      seasons.map((s) => ({
        value: s.code,
        label: formatSeasonLabel(s),
      })),
    [seasons],
  )

  const selection = useMemo(() => {
    const rowStart = Math.min(focus.row, anchor.row)
    const rowEnd = Math.max(focus.row, anchor.row)
    const colStart = Math.min(focus.col, anchor.col)
    const colEnd = Math.max(focus.col, anchor.col)
    return { rowStart, rowEnd, colStart, colEnd }
  }, [focus, anchor])

  const isReadonly = useCallback(
    (row: SheetRowModel, column: BrandField) => {
      if (column.systemKey === 'styleNo' && row.styleId) return true
      return false
    },
    [],
  )

  const clampPos = useCallback(
    (row: number, col: number) => ({
      row: Math.max(0, Math.min(Math.max(rows.length - 1, 0), row)),
      col: Math.max(0, Math.min(Math.max(columns.length - 1, 0), col)),
    }),
    [rows.length, columns.length],
  )

  function moveFocus(nextRow: number, nextCol: number, extend: boolean) {
    if (rows.length === 0 || columns.length === 0) return
    const next = clampPos(nextRow, nextCol)
    setFocus(next)
    if (!extend) setAnchor(next)
    setEditing(false)
  }

  function beginEdit(seed?: string, at?: { row: number; col: number }) {
    if (rows.length === 0 || columns.length === 0) return
    const pos = at ?? focus
    const row = rows[pos.row]
    const column = columns[pos.col]
    if (!row || !column) return
    if (isReadonly(row, column)) return
    if (at) {
      setFocus(at)
      setAnchor(at)
    }
    const key = fieldValueKey(column)
    setDraft(seed !== undefined ? seed : (row.values[key] ?? ''))
    setEditing(true)
  }

  async function commitEdit(value: string) {
    if (!editing) return
    const row = rows[focus.row]
    const column = columns[focus.col]
    setEditing(false)
    if (!row || !column) return
    if (isReadonly(row, column)) return
    const key = fieldValueKey(column)
    if ((row.values[key] ?? '') === value) return
    await onCommitCell(row, column, value)
  }

  function cancelEdit() {
    setEditing(false)
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    } else {
      rootRef.current?.focus({ preventScroll: true })
    }
  }, [editing])

  useEffect(() => {
    if (focus.row >= rows.length && rows.length > 0) {
      const next = clampPos(rows.length - 1, focus.col)
      setFocus(next)
      setAnchor(next)
    }
  }, [rows.length, focus.row, focus.col, clampPos])

  async function copySelection() {
    const matrix: string[][] = []
    for (let r = selection.rowStart; r <= selection.rowEnd; r += 1) {
      const row = rows[r]
      const line: string[] = []
      for (let c = selection.colStart; c <= selection.colEnd; c += 1) {
        const column = columns[c]
        if (!row || !column) {
          line.push('')
          continue
        }
        line.push(row.values[fieldValueKey(column)] ?? '')
      }
      matrix.push(line)
    }
    try {
      await navigator.clipboard.writeText(toTsv(matrix))
    } catch {
      // ignore clipboard denial
    }
  }

  async function pasteAtFocus(text: string) {
    const matrix = parseTsv(text)
    if (matrix.length === 0) return
    await onPasteMatrix({
      startRow: focus.row,
      startCol: focus.col,
      matrix,
    })
  }

  async function clearSelection() {
    await onClearRange(selection)
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (editing) return
    if (rows.length === 0 || columns.length === 0) return

    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      void copySelection()
      return
    }
    if (ctrl && e.key.toLowerCase() === 'v') {
      e.preventDefault()
      void navigator.clipboard
        .readText()
        .then((text) => pasteAtFocus(text))
        .catch(() => undefined)
      return
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      void clearSelection()
      return
    }

    if (e.key === 'F2') {
      e.preventDefault()
      beginEdit()
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) moveFocus(focus.row - 1, focus.col, false)
      else moveFocus(focus.row + 1, focus.col, false)
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) moveFocus(focus.row, focus.col - 1, false)
      else moveFocus(focus.row, focus.col + 1, false)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(focus.row - 1, focus.col, e.shiftKey)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(focus.row + 1, focus.col, e.shiftKey)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moveFocus(focus.row, focus.col - 1, e.shiftKey)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveFocus(focus.row, focus.col + 1, e.shiftKey)
      return
    }

    if (e.key.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault()
      beginEdit(e.key)
    }
  }

  function handleCellMouseDown(
    e: ReactMouseEvent,
    row: number,
    col: number,
  ) {
    e.preventDefault()
    rootRef.current?.focus({ preventScroll: true })
    if (editing) void commitEdit(draft)
    const next = { row, col }
    setFocus(next)
    if (!e.shiftKey) setAnchor(next)
    setEditing(false)
  }

  function handleCellDoubleClick(row: number, col: number) {
    beginEdit(undefined, { row, col })
  }

  function stickyLeft(colIndex: number): number | undefined {
    if (colIndex === 0) return 0
    if (colIndex === 1) return 140
    return undefined
  }

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="outline-none"
      onKeyDown={handleKeyDown}
      onPaste={(e) => {
        if (editing) return
        const text = e.clipboardData.getData('text/plain')
        if (!text) return
        e.preventDefault()
        void pasteAtFocus(text)
      }}
    >
      <div className="overflow-auto rounded-xl border border-border bg-card">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              {columns.map((column, colIndex) => {
                const key = fieldValueKey(column)
                const left = stickyLeft(colIndex)
                const canEditHeader =
                  !column.systemKey && Boolean(onRenameColumn)
                const canDelete =
                  !column.systemKey && Boolean(onDeleteColumn)
                const renaming = renamingCol === column.id

                return (
                  <th
                    key={key}
                    className={cn(
                      'group sticky top-0 z-20 border-b border-border bg-muted/80 px-2 py-2 font-medium backdrop-blur',
                      left !== undefined && 'z-30',
                    )}
                    style={{
                      left,
                      minWidth: colIndex === 0 ? 140 : 120,
                      maxWidth: colIndex <= 1 ? 220 : 280,
                    }}
                  >
                    {renaming ? (
                      <Input
                        className="h-7"
                        value={renameDraft}
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => {
                          const next = renameDraft.trim()
                          setRenamingCol(null)
                          if (next && next !== column.label) {
                            onRenameColumn?.(column, next)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            ;(e.target as HTMLInputElement).blur()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setRenamingCol(null)
                          }
                        }}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="truncate">{column.label}</span>
                        {canEditHeader || canDelete ? (
                          <span className="ml-auto hidden shrink-0 gap-0.5 group-hover:flex">
                            {canEditHeader ? (
                              <button
                                type="button"
                                className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                                title="이름 변경"
                                onClick={() => {
                                  setRenamingCol(column.id)
                                  setRenameDraft(column.label)
                                }}
                              >
                                <Pencil className="size-3" />
                              </button>
                            ) : null}
                            {canDelete ? (
                              <button
                                type="button"
                                className="rounded p-0.5 text-danger hover:bg-danger/10"
                                title="열 삭제"
                                onClick={() => onDeleteColumn?.(column)}
                              >
                                <Trash2 className="size-3" />
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </th>
                )
              })}
              {onAddColumn ? (
                <th className="sticky top-0 z-20 w-10 border-b border-border bg-muted/80 px-1 py-2 backdrop-blur">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="열 추가"
                    onClick={onAddColumn}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </th>
              ) : (
                <th className="sticky top-0 z-20 w-6 border-b border-border bg-muted/80" />
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  표시할 상품이 없습니다. 행 추가로 새 상품을 만들 수 있습니다.
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={row.id} className="group/row">
                  {columns.map((column, colIndex) => {
                    const key = fieldValueKey(column)
                    const left = stickyLeft(colIndex)
                    const selected =
                      rowIndex >= selection.rowStart &&
                      rowIndex <= selection.rowEnd &&
                      colIndex >= selection.colStart &&
                      colIndex <= selection.colEnd
                    const focused =
                      focus.row === rowIndex && focus.col === colIndex
                    const isEditing = focused && editing
                    const readonly = isReadonly(row, column)
                    const err = cellErrors.get(cellErrorKey(row.id, key))
                    const display = row.values[key] ?? ''

                    return (
                      <td
                        key={key}
                        className={cn(
                          'relative border-b border-border px-0 py-0',
                          left !== undefined &&
                            'sticky z-10 bg-card group-hover/row:bg-muted/20',
                          selected && 'bg-accent/40',
                          focused && 'ring-2 ring-inset ring-ring',
                          err && 'ring-2 ring-inset ring-danger',
                          readonly && 'text-muted-foreground',
                        )}
                        style={{ left }}
                        title={err || row.rowError || undefined}
                        onMouseDown={(e) =>
                          handleCellMouseDown(e, rowIndex, colIndex)
                        }
                        onDoubleClick={() =>
                          handleCellDoubleClick(rowIndex, colIndex)
                        }
                      >
                        {isEditing ? (
                          column.type === 'season' ? (
                            <Select
                              ref={
                                inputRef as RefObject<HTMLSelectElement>
                              }
                              className="h-8 rounded-none border-0 bg-transparent focus-visible:ring-0"
                              value={draft}
                              disabled={saving}
                              onChange={(e) => {
                                const next = e.target.value
                                setDraft(next)
                                setEditing(false)
                                void onCommitCell(row, column, next)
                              }}
                              onBlur={() => setEditing(false)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  cancelEdit()
                                }
                              }}
                            >
                              <option value="">선택</option>
                              {seasonOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </Select>
                          ) : column.type === 'gender' ? (
                            <Select
                              ref={
                                inputRef as RefObject<HTMLSelectElement>
                              }
                              className="h-8 rounded-none border-0 bg-transparent focus-visible:ring-0"
                              value={draft}
                              disabled={saving}
                              onChange={(e) => {
                                const next = e.target.value
                                setDraft(next)
                                setEditing(false)
                                void onCommitCell(row, column, next)
                              }}
                              onBlur={() => setEditing(false)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  cancelEdit()
                                }
                              }}
                            >
                              <option value="W">여성</option>
                              <option value="M">남성</option>
                              <option value="U">유니섹스</option>
                            </Select>
                          ) : (
                            <Input
                              ref={
                                inputRef as RefObject<HTMLInputElement>
                              }
                              className="h-8 rounded-none border-0 bg-transparent px-2 focus-visible:ring-0"
                              value={draft}
                              disabled={saving}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => void commitEdit(draft)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  void commitEdit(draft).then(() =>
                                    moveFocus(
                                      focus.row + 1,
                                      focus.col,
                                      false,
                                    ),
                                  )
                                }
                                if (e.key === 'Tab') {
                                  e.preventDefault()
                                  void commitEdit(draft).then(() =>
                                    moveFocus(
                                      focus.row,
                                      focus.col + (e.shiftKey ? -1 : 1),
                                      false,
                                    ),
                                  )
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  cancelEdit()
                                }
                              }}
                            />
                          )
                        ) : (
                          <div className="flex h-8 items-center truncate px-2">
                            {column.type === 'gender' && display
                              ? display === 'W'
                                ? '여성'
                                : display === 'M'
                                  ? '남성'
                                  : display === 'U'
                                    ? '유니섹스'
                                    : display
                              : display || (
                                  <span className="text-muted-foreground/50">
                                    —
                                  </span>
                                )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td className="border-b border-border px-2 text-xs text-danger">
                    {row.rowError ? row.rowError : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {saving ? (
        <p className="mt-2 text-xs text-muted-foreground">저장 중...</p>
      ) : null}
    </div>
  )
}
