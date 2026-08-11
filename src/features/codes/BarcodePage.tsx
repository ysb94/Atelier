import { Fragment, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  FileSpreadsheet,
  Pencil,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  ProductCodeStoreError,
  createProductCode,
  deleteProductCode,
  getBarcodeFields,
  getCodeUsageAssignments,
  getCodeUsageTargets,
  getProductCodes,
  getStylesByBrand,
  updateProductCode,
} from '@/lib/api'
import { barcodePrefix } from '@/lib/codes/ean'
import type {
  BarcodeField,
  CodeUsageAssignment,
  CodeUsageTarget,
  ProductCode,
  ProductCodeInput,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { BarcodeBulkUploadPanel } from './BarcodeBulkUploadPanel'
import { BarcodeInfoBulkPanel } from './BarcodeInfoBulkPanel'
import { BarcodeFieldManager } from './BarcodeFieldManager'
import { PendingBarcodePanel } from './PendingBarcodePanel'
import {
  ProductCodeDialog,
  type ProductCodeDialogMode,
} from './ProductCodeDialog'

type DialogState = {
  mode: ProductCodeDialogMode
  source: ProductCode | null
}

type ListTab = 'all' | 'pending'
type BulkPanel = 'create' | 'info' | 'fields'

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
const DEFAULT_PAGE_SIZE = 50

export function BarcodePage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<ListTab>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [bulkPanel, setBulkPanel] = useState<BulkPanel | null>(null)

  const codesQuery = useQuery({
    queryKey: ['productCodes', brand.id, 'own'],
    queryFn: () => getProductCodes(brand.id, 'own'),
  })
  const allCodesQuery = useQuery({
    queryKey: ['productCodes', brand.id, 'all'],
    queryFn: () => getProductCodes(brand.id),
    enabled: bulkPanel === 'create',
  })
  const fieldsQuery = useQuery({
    queryKey: ['barcodeFields', brand.id],
    queryFn: () => getBarcodeFields(brand.id),
  })
  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'codes'],
    queryFn: () => getStylesByBrand(brand.id),
  })
  const targetsQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })
  const assignmentsQuery = useQuery({
    queryKey: ['codeUsageAssignments', brand.id],
    queryFn: () => getCodeUsageAssignments(brand.id),
  })

  const codes = useMemo(() => codesQuery.data ?? [], [codesQuery.data])
  const fields = useMemo<BarcodeField[]>(
    () => fieldsQuery.data ?? [],
    [fieldsQuery.data],
  )
  const customFields = useMemo(
    () => fields.filter((field) => field.systemKey === null),
    [fields],
  )
  const styles = useMemo(() => stylesQuery.data ?? [], [stylesQuery.data])
  const hasStyles = styles.length > 0
  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const assignments = useMemo(
    () => assignmentsQuery.data ?? [],
    [assignmentsQuery.data],
  )
  const pendingCodes = useMemo(
    () => codes.filter((code) => code.components.length === 0),
    [codes],
  )

  const targetMap = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  )

  const assignmentsByCode = useMemo(() => {
    const map = new Map<string, CodeUsageAssignment[]>()
    for (const row of assignments) {
      const list = map.get(row.productCodeId) ?? []
      list.push(row)
      map.set(row.productCodeId, list)
    }
    return map
  }, [assignments])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return codes
    return codes.filter((code) => {
      if (code.code.toLowerCase().includes(keyword)) return true
      if (code.name.toLowerCase().includes(keyword)) return true
      if (
        Object.values(code.values).some((value) =>
          value.toLowerCase().includes(keyword),
        )
      ) {
        return true
      }
      const codeAssignments = assignmentsByCode.get(code.id) ?? []
      if (
        codeAssignments.some((row) => {
          const target = targetMap.get(row.usageTargetId)
          return target?.name.toLowerCase().includes(keyword)
        })
      ) {
        return true
      }
      return code.components.some((component) =>
        component.styleNo.toLowerCase().includes(keyword),
      )
    })
  }, [codes, search, assignmentsByCode, targetMap])

  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize) || 1)
  const safePage = Math.min(page, totalPages)
  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, safePage, pageSize])
  const rangeStart = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeEnd = Math.min(safePage * pageSize, totalCount)
  const pageItems = useMemo(
    () => buildPageItems(safePage, totalPages),
    [safePage, totalPages],
  )

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  useEffect(() => {
    setPage(1)
    setExpandedId(null)
  }, [search, pageSize])

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['productCodes', brand.id],
    })
  }

  const saveMutation = useMutation({
    mutationFn: async (input: ProductCodeInput) => {
      if (dialog?.mode === 'edit' && dialog.source) {
        return updateProductCode(dialog.source.id, input)
      }
      return createProductCode(brand.id, input)
    },
    onSuccess: async () => {
      setDialog(null)
      setSaveError(null)
      await invalidate()
    },
    onError: (error) => {
      setSaveError(
        error instanceof ProductCodeStoreError
          ? error.message
          : '코드를 저장하지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProductCode(id),
    onSuccess: () => invalidate(),
  })

  function openCreate() {
    setSaveError(null)
    setDialog({ mode: 'create', source: null })
  }

  function openEdit(code: ProductCode) {
    setSaveError(null)
    setDialog({ mode: 'edit', source: code })
  }

  function openDuplicate(code: ProductCode) {
    setSaveError(null)
    setDialog({ mode: 'create', source: code })
  }

  return (
    <div>
      <PageHeader
        title="자사 바코드"
        description={`${brand.name}이 직접 발급하는 88코드 마스터입니다. 업체 프리픽스는 ${barcodePrefix(brand.id)}입니다. 사용처 등록은 사용처별 바코드 메뉴에서 합니다.`}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={fieldsQuery.isLoading}
              onClick={() =>
                setBulkPanel((current) =>
                  current === 'fields' ? null : 'fields',
                )
              }
            >
              <Settings2 className="size-3.5" />
              {bulkPanel === 'fields' ? '항목 관리 닫기' : '항목 관리'}
            </Button>
            {hasStyles ? (
              <>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setBulkPanel((current) =>
                    current === 'info' ? null : 'info',
                  )
                }
              >
                <FileSpreadsheet className="size-3.5" />
                {bulkPanel === 'info' ? '정보 수정 닫기' : '정보 일괄 수정'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setBulkPanel((current) =>
                    current === 'create' ? null : 'create',
                  )
                }
              >
                <Upload className="size-3.5" />
                {bulkPanel === 'create' ? '일괄 등록 닫기' : '일괄 등록'}
              </Button>
              <Button type="button" onClick={openCreate}>
                + 바코드 등록
              </Button>
              </>
            ) : (
              <Link to={`/b/${brand.slug}/data/upload?mode=single`}>
                <Button type="button" variant="outline">
                  상품 먼저 등록
                </Button>
              </Link>
            )}
          </>
        }
      />

      {bulkPanel === 'fields' ? (
        <BarcodeFieldManager
          brandId={brand.id}
          fields={fields}
          onClose={() => setBulkPanel(null)}
        />
      ) : null}

      {bulkPanel === 'create' && hasStyles ? (
        <div className="mb-4">
          <BarcodeBulkUploadPanel
            brandName={brand.name}
            brandId={brand.id}
            styles={styles}
            fields={fields}
            existingCodes={allCodesQuery.data ?? codes}
            onApplied={async () => {
              await invalidate()
              await queryClient.invalidateQueries({
                queryKey: ['productCodes', brand.id, 'all'],
              })
            }}
            onClose={() => setBulkPanel(null)}
          />
        </div>
      ) : null}

      {bulkPanel === 'info' ? (
        <div className="mb-4">
          <BarcodeInfoBulkPanel
            brandName={brand.name}
            codes={codes}
            fields={fields}
            onApplied={invalidate}
            onClose={() => setBulkPanel(null)}
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTab('all')}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            tab === 'all'
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          전체 ({formatNumber(codes.length)})
        </button>
        <button
          type="button"
          onClick={() => setTab('pending')}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            tab === 'pending'
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          M번호 미지정 ({formatNumber(pendingCodes.length)})
        </button>
      </div>

      {tab === 'pending' ? (
        <PendingBarcodePanel
          brandName={brand.name}
          codes={codes}
          styles={styles}
          fields={fields}
          onChanged={invalidate}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="sm:max-w-sm"
              placeholder="바코드, 코드명, 구성품 품번, 사용처 검색..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              className="sm:w-auto"
              value={String(pageSize)}
              onChange={(event) => setPageSize(Number(event.target.value))}
              aria-label="페이지당 행 수"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}건씩
                </option>
              ))}
            </Select>
            <div className="text-sm text-muted-foreground sm:ml-auto">
              {totalCount === 0
                ? '0건'
                : `전체 ${formatNumber(totalCount)}건 중 ${formatNumber(rangeStart)}–${formatNumber(rangeEnd)}건`}
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 px-4 py-3" />
                    <th className="px-4 py-3 font-medium">바코드</th>
                    <th className="px-4 py-3 font-medium">코드명</th>
                    <th className="px-4 py-3 font-medium">사용처 현황</th>
                    <th className="px-4 py-3 font-medium">구성</th>
                    <th className="px-4 py-3 font-medium">무게</th>
                    <th className="px-4 py-3 font-medium">규격</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {codesQuery.isLoading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-muted-foreground"
                      >
                        불러오는 중...
                      </td>
                    </tr>
                  ) : codesQuery.isError ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        <div className="mx-auto max-w-md space-y-3">
                          <p className="text-sm font-medium text-danger">
                            바코드 목록을 불러오지 못했습니다
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {codesQuery.error instanceof Error
                              ? codesQuery.error.message
                              : '잠시 후 다시 시도해 주세요.'}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void codesQuery.refetch()}
                          >
                            다시 시도
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : totalCount === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-muted-foreground"
                      >
                        {codes.length === 0 ? (
                          <div className="mx-auto max-w-md space-y-3">
                            <p className="text-sm font-medium text-foreground">
                              {hasStyles
                                ? '등록된 바코드가 없습니다'
                                : '상품이 없어 바코드를 만들 수 없습니다'}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {hasStyles
                                ? '자사 바코드는 확정된 단품·세트 구성으로 등록합니다. 첫 코드를 만들어 보세요.'
                                : '바코드 구성품은 품번이 부여된 상품에서 고릅니다. 가져오기나 상품 등록으로 단품을 먼저 추가하세요.'}
                            </p>
                            {hasStyles ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={openCreate}
                              >
                                + 바코드 등록
                              </Button>
                            ) : (
                              <Link
                                to={`/b/${brand.slug}/data/upload?mode=single`}
                              >
                                <Button type="button" size="sm">
                                  상품 등록
                                </Button>
                              </Link>
                            )}
                          </div>
                        ) : (
                          '조건에 맞는 코드가 없습니다.'
                        )}
                      </td>
                    </tr>
                  ) : (
                    paged.map((code) => {
                      const isExpanded = expandedId === code.id
                      const totalQty = code.components.reduce(
                        (sum, component) => sum + component.qty,
                        0,
                      )
                      const codeAssignments =
                        assignmentsByCode.get(code.id) ?? []
                      return (
                        <Fragment key={code.id}>
                          <tr
                            onClick={() =>
                              setExpandedId(isExpanded ? null : code.id)
                            }
                            className={cn(
                              'cursor-pointer border-b border-border transition-colors',
                              isExpanded ? 'bg-accent/50' : 'hover:bg-muted/40',
                            )}
                          >
                            <td className="px-4 py-3">
                              <ChevronDown
                                className={cn(
                                  'size-4 text-muted-foreground transition-transform',
                                  isExpanded && 'rotate-180',
                                )}
                              />
                            </td>
                            <td className="px-4 py-3 font-medium tabular-nums">
                              {code.code}
                            </td>
                            <td className="px-4 py-3">{code.name}</td>
                            <td className="max-w-[280px] px-4 py-3">
                              <UsageSummary
                                assignments={codeAssignments}
                                targetMap={targetMap}
                              />
                            </td>
                            <td className="px-4 py-3">
                              {code.components.length === 0 ? (
                                <Badge variant="warning">M번호 미지정</Badge>
                              ) : (
                                <Badge variant="muted">
                                  {code.components.length}종 ·{' '}
                                  {formatNumber(totalQty)}개
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {code.weightG ? (
                                `${formatNumber(code.weightG)}g`
                              ) : (
                                <span className="text-warning">미입력</span>
                              )}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-muted-foreground">
                              {code.widthCm && code.depthCm && code.heightCm
                                ? `${code.widthCm}×${code.depthCm}×${code.heightCm}cm`
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`${code.code} 복제 등록`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openDuplicate(code)
                                  }}
                                >
                                  <Copy className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`${code.code} 수정`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openEdit(code)
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-danger hover:bg-danger/10"
                                  aria-label={`${code.code} 삭제`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    if (
                                      window.confirm(
                                        `"${code.name}" (${code.code}) 코드를 삭제할까요?`,
                                      )
                                    ) {
                                      deleteMutation.mutate(code.id)
                                    }
                                  }}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="border-b border-border bg-muted/20">
                              <td />
                              <td colSpan={7} className="px-4 py-4">
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  구성품
                                </div>
                                {code.components.length === 0 ? (
                                  <p className="mb-3 text-sm text-muted-foreground">
                                    M번호가 아직 없습니다. 미지정 탭에서
                                    채우거나 수정으로 구성품을 담으세요.
                                  </p>
                                ) : (
                                  <ul className="mb-3 space-y-1">
                                    {code.components.map((component) => (
                                      <li
                                        key={component.styleId}
                                        className="flex items-center gap-3"
                                      >
                                        <span className="font-medium tabular-nums">
                                          {component.styleNo}
                                        </span>
                                        <span className="text-muted-foreground">
                                          {styles.find(
                                            (style) =>
                                              style.id === component.styleId,
                                          )?.name ?? '삭제된 단품'}
                                        </span>
                                        <span className="ml-auto tabular-nums">
                                          {formatNumber(component.qty)}개
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {customFields.length > 0 ? (
                                  <>
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                      추가 정보
                                    </div>
                                    <dl className="mb-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                                      {customFields.map((field) => (
                                        <div
                                          key={field.id}
                                          className="flex min-w-0 gap-2"
                                        >
                                          <dt className="shrink-0 text-muted-foreground">
                                            {field.label}
                                          </dt>
                                          <dd className="truncate">
                                            {code.values[field.id] || '—'}
                                          </dd>
                                        </div>
                                      ))}
                                    </dl>
                                  </>
                                ) : null}
                                {codeAssignments.length > 0 ? (
                                  <>
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                      사용처
                                    </div>
                                    <ul className="mb-3 space-y-1">
                                      {codeAssignments.map((row) => {
                                        const target = targetMap.get(
                                          row.usageTargetId,
                                        )
                                        return (
                                          <li
                                            key={row.id}
                                            className="flex items-center gap-2 text-sm"
                                          >
                                            <span>
                                              {target?.name ??
                                                '알 수 없는 사용처'}
                                            </span>
                                            <Badge
                                              variant={
                                                row.status === 'active'
                                                  ? 'success'
                                                  : 'muted'
                                              }
                                            >
                                              {row.status === 'active'
                                                ? '사용중'
                                                : '일시중지'}
                                            </Badge>
                                          </li>
                                        )
                                      })}
                                    </ul>
                                  </>
                                ) : null}
                                {code.note ? (
                                  <p className="rounded-md bg-card px-3 py-2 text-muted-foreground">
                                    {code.note}
                                  </p>
                                ) : null}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {totalCount > 0 ? (
              <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {safePage} / {formatNumber(totalPages)} 페이지
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="첫 페이지"
                    disabled={safePage <= 1}
                    onClick={() => setPage(1)}
                  >
                    <ChevronsLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="이전 페이지"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  {pageItems.map((item, index) =>
                    item === 'ellipsis' ? (
                      <span
                        key={`ellipsis-${index}`}
                        className="px-2 text-sm text-muted-foreground"
                      >
                        …
                      </span>
                    ) : (
                      <Button
                        key={item}
                        type="button"
                        variant={item === safePage ? 'default' : 'outline'}
                        size="sm"
                        className="min-w-8 px-2"
                        onClick={() => setPage(item)}
                      >
                        {item}
                      </Button>
                    ),
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="다음 페이지"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="마지막 페이지"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(totalPages)}
                  >
                    <ChevronsRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </>
      )}

      <ProductCodeDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'create'}
        kind="own"
        brandId={brand.id}
        source={dialog?.source ?? null}
        styles={styles}
        fields={fields}
        existingCodes={codes}
        isSubmitting={saveMutation.isPending}
        errorMessage={saveError}
        onClose={() => {
          setDialog(null)
          setSaveError(null)
        }}
        onSubmit={(input) => saveMutation.mutate(input)}
      />
    </div>
  )
}

function buildPageItems(
  current: number,
  total: number,
): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const items: Array<number | 'ellipsis'> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  if (start > 2) items.push('ellipsis')
  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    items.push(pageNumber)
  }
  if (end < total - 1) items.push('ellipsis')
  items.push(total)
  return items
}

function UsageSummary({
  assignments,
  targetMap,
}: {
  assignments: CodeUsageAssignment[]
  targetMap: Map<string, CodeUsageTarget>
}) {
  if (assignments.length === 0) {
    return <Badge variant="outline">미등록</Badge>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {assignments.map((row) => {
        const target = targetMap.get(row.usageTargetId)
        const label = target?.name ?? '알 수 없는 사용처'
        if (row.status === 'active') {
          return (
            <Badge key={row.id} variant="outline">
              {label}
            </Badge>
          )
        }
        return (
          <Badge key={row.id} variant="muted">
            {label} · 중지
          </Badge>
        )
      })}
    </div>
  )
}
