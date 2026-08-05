import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Download, Plus, Rows3 } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  BrandFieldStoreError,
  StyleStoreError,
  createBrandField,
  createStyle,
  deleteBrandField,
  getBrandFields,
  getSeasonsByBrand,
  getStylesByBrand,
  updateBrandField,
  updateStyleFields,
  updateStyleFieldsBulk,
} from '@/lib/api'
import {
  OWNER_LABEL,
  type FieldOwner,
} from '@/lib/import/fields'
import {
  columnsForSheet,
  downloadStylesExport,
  sheetOwnerLabel,
  type DataSheetOwner,
} from '@/lib/export/styles-export'
import {
  fieldValueKey,
  getStyleFieldRaw,
} from '@/lib/products/style-fields'
import {
  STYLE_STATUS_LABEL,
  formatSeasonLabel,
  type BrandField,
  type FieldType,
  type Style,
  type StyleStatus,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import {
  SheetGrid,
  cellErrorKey,
  type CellErrorMap,
  type SheetRowModel,
} from './SheetGrid'

const DATA_OWNERS: DataSheetOwner[] = [
  'planning',
  'design',
  'md',
  'logistics',
  'all',
]

const PAGE_SIZES = [50, 100, 200] as const

type DraftRow = {
  id: string
  styleNo: string
  name: string
  seasonId: string
  values: Record<string, string>
  error?: string
}

function parseOwner(raw: string | undefined): DataSheetOwner | null {
  if (!raw) return null
  if (DATA_OWNERS.includes(raw as DataSheetOwner)) {
    return raw as DataSheetOwner
  }
  return null
}

function parsePageSize(raw: string | null): number {
  const value = Number(raw)
  if (PAGE_SIZES.includes(value as (typeof PAGE_SIZES)[number])) return value
  return 100
}

function parsePage(raw: string | null): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 1) return 1
  return Math.trunc(value)
}

function newDraftId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `draft-${crypto.randomUUID()}`
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function styleToValues(
  style: Style,
  columns: BrandField[],
  seasonCode?: string,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const column of columns) {
    const key = fieldValueKey(column)
    values[key] = getStyleFieldRaw(style, column, { seasonCode })
  }
  return values
}

function styleMatchesSearch(
  style: Style,
  keyword: string,
  seasonCode?: string,
): boolean {
  if (!keyword) return true
  const haystack = [
    style.styleNo,
    style.name,
    style.category,
    style.status,
    STYLE_STATUS_LABEL[style.status],
    style.planner,
    style.designer,
    style.description,
    style.colors.join(' '),
    seasonCode,
    ...Object.values(style.values ?? {}),
    ...Object.values(style.customFields ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(keyword)
}

export function DataSheetPage() {
  const { brand } = useBrand()
  const { owner: ownerParam } = useParams()
  const owner = parseOwner(ownerParam)
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const search = searchParams.get('q') ?? ''
  const seasonId = searchParams.get('season') ?? 'all'
  const statusFilter = searchParams.get('status') ?? 'all'
  const pageSize = parsePageSize(searchParams.get('size'))
  const page = parsePage(searchParams.get('page'))

  const [draftRows, setDraftRows] = useState<DraftRow[]>([])
  const [cellErrors, setCellErrors] = useState<CellErrorMap>(() => new Map())
  const [banner, setBanner] = useState<string | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColLabel, setNewColLabel] = useState('')
  const [newColType, setNewColType] = useState<FieldType>('text')
  const [saving, setSaving] = useState(false)

  const fieldsQuery = useQuery({
    queryKey: ['brand-fields', brand.id],
    queryFn: () => getBrandFields(brand.id),
  })
  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })
  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id],
    queryFn: () => getStylesByBrand(brand.id),
  })

  const fields = useMemo(
    () => fieldsQuery.data ?? [],
    [fieldsQuery.data],
  )
  const seasons = useMemo(
    () => seasonsQuery.data ?? [],
    [seasonsQuery.data],
  )
  const allStyles = useMemo(
    () => stylesQuery.data ?? [],
    [stylesQuery.data],
  )

  const columns = useMemo(
    () => (owner ? columnsForSheet(fields, owner) : []),
    [fields, owner],
  )

  const seasonById = useMemo(
    () => new Map(seasons.map((s) => [s.id, s])),
    [seasons],
  )

  const filteredStyles = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return allStyles.filter((style) => {
      if (seasonId !== 'all' && style.seasonId !== seasonId) return false
      if (statusFilter !== 'all' && style.status !== statusFilter) return false
      const season = seasonById.get(style.seasonId)
      return styleMatchesSearch(style, keyword, season?.code)
    })
  }, [allStyles, search, seasonId, statusFilter, seasonById])

  const totalPages = Math.max(1, Math.ceil(filteredStyles.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStyles = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredStyles.slice(start, start + pageSize)
  }, [filteredStyles, safePage, pageSize])

  useEffect(() => {
    if (page !== safePage) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (safePage <= 1) next.delete('page')
          else next.set('page', String(safePage))
          return next
        },
        { replace: true },
      )
    }
  }, [page, safePage, setSearchParams])

  const defaultSeasonId = useMemo(() => {
    if (seasonId !== 'all') return seasonId
    return seasons[0]?.id ?? ''
  }, [seasonId, seasons])

  const sheetRows: SheetRowModel[] = useMemo(() => {
    const styleRows: SheetRowModel[] = pageStyles.map((style) => {
      const season = seasonById.get(style.seasonId)
      return {
        id: style.id,
        styleId: style.id,
        values: styleToValues(style, columns, season?.code),
      }
    })
    const drafts: SheetRowModel[] = draftRows.map((draft) => {
      const season = seasonById.get(draft.seasonId)
      const values: Record<string, string> = { ...draft.values }
      values.styleNo = draft.styleNo
      values.name = draft.name
      if (columns.some((c) => c.systemKey === 'seasonCode')) {
        values.seasonCode = season?.code ?? ''
      }
      return {
        id: draft.id,
        styleId: null,
        values,
        rowError: draft.error,
      }
    })
    return [...styleRows, ...drafts]
  }, [pageStyles, draftRows, columns, seasonById])

  function patchParams(patch: Record<string, string | null>) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      let resetPage = false
      for (const [key, value] of Object.entries(patch)) {
        if (key !== 'page') resetPage = true
        if (value == null || value === '' || value === 'all') {
          if (key === 'q' || key === 'page' || key === 'size') next.delete(key)
          else if (
            (key === 'season' || key === 'status') &&
            (value == null || value === 'all')
          ) {
            next.delete(key)
          } else if (value == null || value === '') {
            next.delete(key)
          } else {
            next.set(key, value)
          }
        } else if (key === 'size' && value === '100') {
          next.delete(key)
        } else if (key === 'page' && value === '1') {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      }
      if (resetPage && !('page' in patch)) next.delete('page')
      return next
    })
  }

  async function invalidateStyles() {
    await queryClient.invalidateQueries({ queryKey: ['styles', brand.id] })
  }

  async function invalidateFields() {
    await queryClient.invalidateQueries({
      queryKey: ['brand-fields', brand.id],
    })
    await queryClient.invalidateQueries({
      queryKey: ['brandFields', brand.id],
    })
  }

  const setCellError = useCallback(
    (rowId: string, colKey: string, message: string | null) => {
      setCellErrors((prev) => {
        const next = new Map(prev)
        const key = cellErrorKey(rowId, colKey)
        if (!message) next.delete(key)
        else next.set(key, message)
        return next
      })
    },
    [],
  )

  async function saveDraftRow(draft: DraftRow) {
    const styleNo = draft.styleNo.trim()
    const name = draft.name.trim()
    if (!styleNo || !name) return
    if (!draft.seasonId) {
      setDraftRows((prev) =>
        prev.map((row) =>
          row.id === draft.id
            ? { ...row, error: '출시 기획을 선택하세요.' }
            : row,
        ),
      )
      return
    }
    try {
      setSaving(true)
      const created = await createStyle(brand.id, {
        styleNo,
        name,
        seasonId: draft.seasonId,
      })
      const patch: Record<string, string> = {}
      for (const [key, value] of Object.entries(draft.values)) {
        if (key === 'styleNo' || key === 'name' || key === 'seasonCode') continue
        if (value.trim()) patch[key] = value
      }
      if (Object.keys(patch).length > 0) {
        await updateStyleFields(created.id, patch)
      }
      setDraftRows((prev) => prev.filter((row) => row.id !== draft.id))
      setBanner(null)
      await invalidateStyles()
    } catch (error) {
      const message =
        error instanceof StyleStoreError
          ? error.message
          : error instanceof Error
            ? error.message
            : '저장에 실패했습니다.'
      setDraftRows((prev) =>
        prev.map((row) =>
          row.id === draft.id ? { ...row, error: message } : row,
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleCommitCell(
    row: SheetRowModel,
    column: BrandField,
    value: string,
  ) {
    const key = fieldValueKey(column)
    setCellError(row.id, key, null)
    setBanner(null)

    if (!row.styleId) {
      setDraftRows((prev) => {
        const next = prev.map((draft) => {
          if (draft.id !== row.id) return draft
          if (column.systemKey === 'styleNo') {
            return { ...draft, styleNo: value, error: undefined }
          }
          if (column.systemKey === 'name') {
            return { ...draft, name: value, error: undefined }
          }
          if (
            column.systemKey === 'seasonCode' ||
            column.systemKey === 'seasonId'
          ) {
            const season =
              seasons.find(
                (s) => s.code.toUpperCase() === value.trim().toUpperCase(),
              ) ?? seasons.find((s) => s.id === value)
            return {
              ...draft,
              seasonId: season?.id ?? draft.seasonId,
              error: undefined,
            }
          }
          return {
            ...draft,
            values: { ...draft.values, [key]: value },
            error: undefined,
          }
        })
        const updated = next.find((d) => d.id === row.id)
        if (updated?.styleNo.trim() && updated.name.trim()) {
          void saveDraftRow(updated)
        }
        return next
      })
      return
    }

    try {
      setSaving(true)
      await updateStyleFields(row.styleId, { [key]: value })
      await invalidateStyles()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '저장에 실패했습니다.'
      setCellError(row.id, key, message)
      setBanner(message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePasteMatrix(args: {
    startRow: number
    startCol: number
    matrix: string[][]
  }) {
    const { startRow, startCol, matrix } = args
    if (matrix.length === 0 || columns.length === 0) return

    const neededExtra = startRow + matrix.length - sheetRows.length
    if (neededExtra > 0) {
      const ok = window.confirm(
        `붙여넣기 범위가 ${neededExtra}행 더 필요합니다. 새 행을 추가할까요?`,
      )
      if (!ok) return
      setDraftRows((prev) => [
        ...prev,
        ...Array.from({ length: neededExtra }, () => ({
          id: newDraftId(),
          styleNo: '',
          name: '',
          seasonId: defaultSeasonId,
          values: {},
        })),
      ])
      // Parent re-render will include new rows; ask user to paste again
      setBanner(
        `새 행 ${neededExtra}개를 추가했습니다. 다시 붙여넣기 해 주세요.`,
      )
      return
    }

    setSaving(true)
    setBanner(null)
    const bulkEdits: { styleId: string; patch: Record<string, string> }[] = []
    const draftUpdates = new Map<string, DraftRow>()
    const nextErrors = new Map(cellErrors)

    for (let r = 0; r < matrix.length; r += 1) {
      const row = sheetRows[startRow + r]
      if (!row) continue
      const line = matrix[r] ?? []
      for (let c = 0; c < line.length; c += 1) {
        const colIndex = startCol + c
        const column = columns[colIndex]
        if (!column) continue
        if (column.systemKey === 'styleNo' && row.styleId) continue
        const key = fieldValueKey(column)
        const value = line[c] ?? ''
        nextErrors.delete(cellErrorKey(row.id, key))

        if (!row.styleId) {
          const existing =
            draftUpdates.get(row.id) ??
            draftRows.find((d) => d.id === row.id) ?? {
              id: row.id,
              styleNo: row.values.styleNo ?? '',
              name: row.values.name ?? '',
              seasonId: defaultSeasonId,
              values: { ...row.values },
            }
          if (column.systemKey === 'styleNo') existing.styleNo = value
          else if (column.systemKey === 'name') existing.name = value
          else if (
            column.systemKey === 'seasonCode' ||
            column.systemKey === 'seasonId'
          ) {
            const season = seasons.find(
              (s) => s.code.toUpperCase() === value.trim().toUpperCase(),
            )
            if (season) existing.seasonId = season.id
          } else {
            existing.values = { ...existing.values, [key]: value }
          }
          draftUpdates.set(row.id, existing)
        } else {
          const found = bulkEdits.find((e) => e.styleId === row.styleId)
          if (found) found.patch[key] = value
          else bulkEdits.push({ styleId: row.styleId, patch: { [key]: value } })
        }
      }
    }

    setCellErrors(nextErrors)

    if (draftUpdates.size > 0) {
      setDraftRows((prev) => {
        const mapped = prev.map((d) => draftUpdates.get(d.id) ?? d)
        for (const draft of draftUpdates.values()) {
          if (!mapped.some((d) => d.id === draft.id)) mapped.push(draft)
        }
        return mapped
      })
      for (const draft of draftUpdates.values()) {
        if (draft.styleNo.trim() && draft.name.trim()) {
          void saveDraftRow(draft)
        }
      }
    }

    if (bulkEdits.length > 0) {
      try {
        const result = await updateStyleFieldsBulk(brand.id, bulkEdits)
        if (result.failures.length > 0) {
          setCellErrors((prev) => {
            const next = new Map(prev)
            for (const fail of result.failures) {
              next.set(cellErrorKey(fail.styleId, '_row'), fail.message)
            }
            return next
          })
          setBanner(
            `${result.failures.length}건 저장 실패 · ${result.updated}건 저장됨`,
          )
        } else {
          setBanner(`${result.updated}건 저장됨`)
        }
        await invalidateStyles()
      } catch (error) {
        setBanner(
          error instanceof Error ? error.message : '붙여넣기 저장에 실패했습니다.',
        )
      }
    }

    setSaving(false)
  }

  async function handleClearRange(args: {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
  }) {
    const matrix: string[][] = []
    for (let r = args.rowStart; r <= args.rowEnd; r += 1) {
      const line: string[] = []
      for (let c = args.colStart; c <= args.colEnd; c += 1) {
        const column = columns[c]
        const row = sheetRows[r]
        if (!column || !row) {
          line.push('')
          continue
        }
        if (column.systemKey === 'styleNo' && row.styleId) {
          line.push(row.values.styleNo ?? '')
        } else {
          line.push('')
        }
      }
      matrix.push(line)
    }
    await handlePasteMatrix({
      startRow: args.rowStart,
      startCol: args.colStart,
      matrix,
    })
  }

  function handleAddRow() {
    if (!defaultSeasonId) {
      setBanner('출시 기획이 없습니다. 설정에서 먼저 추가하세요.')
      return
    }
    setDraftRows((prev) => [
      ...prev,
      {
        id: newDraftId(),
        styleNo: '',
        name: '',
        seasonId: defaultSeasonId,
        values: {},
      },
    ])
  }

  const createColumnMutation = useMutation({
    mutationFn: () => {
      if (!owner || owner === 'all') {
        throw new Error('취합 탭에서는 열을 추가할 수 없습니다. 부서 탭에서 추가하세요.')
      }
      return createBrandField(brand.id, {
        label: newColLabel.trim(),
        type: newColType,
        owner: owner as FieldOwner,
      })
    },
    onSuccess: async () => {
      setAddingColumn(false)
      setNewColLabel('')
      setNewColType('text')
      setBanner(null)
      await invalidateFields()
    },
    onError: (error) => {
      setBanner(
        error instanceof BrandFieldStoreError || error instanceof Error
          ? error.message
          : '열 추가에 실패했습니다.',
      )
    },
  })

  const renameColumnMutation = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      updateBrandField(id, { label }),
    onSuccess: async () => {
      await invalidateFields()
    },
    onError: (error) => {
      setBanner(
        error instanceof Error ? error.message : '이름 변경에 실패했습니다.',
      )
    },
  })

  const deleteColumnMutation = useMutation({
    mutationFn: (id: string) => deleteBrandField(id),
    onSuccess: async () => {
      await invalidateFields()
    },
    onError: (error) => {
      setBanner(
        error instanceof Error ? error.message : '열 삭제에 실패했습니다.',
      )
    },
  })

  async function handleExport() {
    if (!owner) return
    try {
      await downloadStylesExport({
        brandName: brand.name,
        owner,
        fields,
        styles: filteredStyles,
        seasons,
      })
    } catch (error) {
      setBanner(
        error instanceof Error ? error.message : '내보내기에 실패했습니다.',
      )
    }
  }

  if (!owner) {
    return <Navigate to="../data/planning" replace />
  }

  const loading =
    fieldsQuery.isLoading || seasonsQuery.isLoading || stylesQuery.isLoading

  return (
    <div>
      <PageHeader
        title={`데이터 · ${sheetOwnerLabel(owner)}`}
        description="품번·상품명은 고정이고, 부서 열만 엑셀처럼 입력합니다. 취합에서 한 번에 내보낼 수 있습니다."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddRow}
            >
              <Rows3 className="size-3.5" />
              행 추가
            </Button>
            {owner !== 'all' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddingColumn(true)}
              >
                <Plus className="size-3.5" />
                열 추가
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
            >
              <Download className="size-3.5" />
              내보내기
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {DATA_OWNERS.map((item) => (
          <Link
            key={item}
            to={`/b/${brand.slug}/data/${item}?${searchParams.toString()}`}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              item === owner
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {sheetOwnerLabel(item)}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="h-9 max-w-xs"
          placeholder="검색 (품번, 상품명…)"
          value={search}
          onChange={(e) => patchParams({ q: e.target.value || null })}
        />
        <Select
          value={seasonId}
          onChange={(e) => patchParams({ season: e.target.value })}
        >
          <option value="all">전체 출시 기획</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {formatSeasonLabel(s)}
              {s.status === 'archived' ? ' · 마감' : ''}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => patchParams({ status: e.target.value })}
        >
          <option value="all">전체 상태</option>
          {(Object.keys(STYLE_STATUS_LABEL) as StyleStatus[]).map((status) => (
            <option key={status} value={status}>
              {STYLE_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
        <Select
          value={String(pageSize)}
          onChange={(e) => patchParams({ size: e.target.value })}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}행
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">
          {formatNumber(filteredStyles.length)}건
          {draftRows.length > 0 ? ` · 작성중 ${draftRows.length}` : ''}
        </span>
      </div>

      {addingColumn ? (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-accent bg-accent/20 p-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">열 이름</span>
            <Input
              className="h-8 w-48"
              value={newColLabel}
              placeholder="예: 원산지"
              onChange={(e) => setNewColLabel(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">유형</span>
            <Select
              className="h-8"
              value={newColType}
              onChange={(e) => setNewColType(e.target.value as FieldType)}
            >
              <option value="text">텍스트</option>
              <option value="number">숫자</option>
              <option value="list">목록</option>
              <option value="gender">성별</option>
              <option value="season">출시 기획</option>
            </Select>
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!newColLabel.trim() || createColumnMutation.isPending}
            onClick={() => createColumnMutation.mutate()}
          >
            추가
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setAddingColumn(false)
              setNewColLabel('')
            }}
          >
            취소
          </Button>
          {owner !== 'all' ? (
            <span className="text-xs text-muted-foreground">
              {OWNER_LABEL[owner as FieldOwner]} 부서 열로 추가됩니다.
            </span>
          ) : null}
        </div>
      ) : null}

      {banner ? (
        <p className="mb-3 text-sm text-muted-foreground">{banner}</p>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          불러오는 중...
        </p>
      ) : (
        <SheetGrid
          columns={columns}
          rows={sheetRows}
          seasons={seasons}
          cellErrors={cellErrors}
          saving={saving}
          onCommitCell={handleCommitCell}
          onPasteMatrix={handlePasteMatrix}
          onClearRange={handleClearRange}
          onAddColumn={
            owner === 'all' ? undefined : () => setAddingColumn(true)
          }
          onRenameColumn={(field, label) =>
            renameColumnMutation.mutate({ id: field.id, label })
          }
          onDeleteColumn={(field) => {
            const ok = window.confirm(`"${field.label}" 열을 삭제할까요?`)
            if (!ok) return
            deleteColumnMutation.mutate(field.id)
          }}
        />
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage <= 1}
            onClick={() => patchParams({ page: String(safePage - 1) })}
          >
            이전
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {safePage} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage >= totalPages}
            onClick={() => patchParams({ page: String(safePage + 1) })}
          >
            다음
          </Button>
        </div>
      ) : null}
    </div>
  )
}
