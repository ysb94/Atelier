import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, TriangleAlert } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  applyProductImport,
  getBrandFields,
  getSeasonsByBrand,
  getStylesByBrand,
  type ImportFailure,
} from '@/lib/api'
import type { ParsedSheet } from '@/lib/import/parse'
import { prepareRows } from '@/lib/import/transform'
import { cn, formatNumber } from '@/lib/utils'
import { BulkUploadStep } from '@/features/upload/BulkUploadStep'
import { PreviewStep } from '@/features/upload/PreviewStep'
import { SingleEntryForm } from '@/features/upload/SingleEntryForm'

type Mode = 'bulk' | 'single'

const TABS: { id: Mode; label: string }[] = [
  { id: 'bulk', label: '일괄 등록' },
  { id: 'single', label: '한건 등록' },
]

export function ImportSettingsPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const modeParam = searchParams.get('mode')
  const mode: Mode = modeParam === 'single' ? 'single' : 'bulk'

  const [bulkStep, setBulkStep] = useState(0)
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [result, setResult] = useState<{
    created: number
    updated: number
    skipped: number
    failures: ImportFailure[]
  } | null>(null)

  const fieldsQuery = useQuery({
    queryKey: ['brandFields', brand.id],
    queryFn: () => getBrandFields(brand.id),
  })
  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'upload'],
    queryFn: () => getStylesByBrand(brand.id),
  })
  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data])
  const activeSheet = sheets[activeSheetIndex]

  const preparedRows = useMemo(() => {
    if (!activeSheet) return []
    return prepareRows({
      rows: activeSheet.rows,
      fields,
      existingStyles: stylesQuery.data ?? [],
      seasons: seasonsQuery.data ?? [],
    })
  }, [activeSheet, fields, stylesQuery.data, seasonsQuery.data])

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = preparedRows.filter((row) => row.status !== 'error')
      return applyProductImport(
        brand.id,
        rows.map((row) => ({
          lineNo: row.lineNo,
          styleNo: row.styleNo,
          matchKey: row.matchKey,
          targetStyleId: row.targetStyleId,
          applied: row.applied,
          customFields: row.customFields,
        })),
      )
    },
    onSuccess: async (data) => {
      setResult({
        ...data,
        skipped: preparedRows.filter((row) => row.status === 'error').length,
      })
      await queryClient.invalidateQueries()
    },
  })

  function setMode(next: Mode) {
    setSearchParams(next === 'bulk' ? {} : { mode: next })
    if (next !== 'bulk') {
      setBulkStep(0)
      setSheets([])
      setResult(null)
    }
  }

  function resetBulk() {
    setBulkStep(0)
    setSheets([])
    setActiveSheetIndex(0)
    setResult(null)
  }

  if (result && mode === 'bulk') {
    const hasFailures = result.failures.length > 0
    return (
      <div>
        <PageHeader title="가져오기" />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <div
              className={cn(
                'flex size-12 items-center justify-center rounded-full',
                hasFailures
                  ? 'bg-warning/15 text-warning'
                  : 'bg-success/15 text-success',
              )}
            >
              {hasFailures ? (
                <TriangleAlert className="size-6" />
              ) : (
                <Check className="size-6" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {hasFailures ? '일부만 등록되었습니다' : '일괄 등록 완료'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                새로 등록 {formatNumber(result.created)}건 · 갱신{' '}
                {formatNumber(result.updated)}건 · 건너뜀{' '}
                {formatNumber(result.skipped)}건
                {hasFailures
                  ? ` · 실패 ${formatNumber(result.failures.length)}건`
                  : ''}
              </p>
            </div>

            {hasFailures ? (
              <div className="w-full max-w-xl space-y-1.5 rounded-md border border-warning/40 bg-warning/5 p-4 text-left">
                <p className="text-sm font-medium">
                  아래 행은 반영되지 않았습니다. 값을 고쳐서 다시 올려주세요.
                </p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {result.failures.map((failure) => (
                    <li key={`${failure.lineNo}-${failure.styleNo}`}>
                      <span className="tabular-nums">{failure.lineNo}행</span>
                      {failure.styleNo ? ` · ${failure.styleNo}` : ''} —{' '}
                      {failure.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={resetBulk}>
                다른 파일 등록
              </Button>
              <Link to={`/b/${brand.slug}/products`}>
                <Button type="button">전체 상품 보기</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="가져오기"
        description={`${brand.name} 상품을 양식 기반 일괄 등록 또는 한건 등록으로 가져옵니다.`}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              mode === tab.id
                ? 'border-foreground/30 bg-primary text-primary-foreground'
                : 'border-border hover:bg-muted',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {fieldsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">항목을 불러오는 중...</div>
      ) : null}

      {mode === 'bulk' ? (
        <div className="space-y-4">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {['파일 업로드', '검증 및 확정'].map((label, index) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5',
                    index === bulkStep
                      ? 'bg-primary text-primary-foreground'
                      : index < bulkStep
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground',
                  )}
                >
                  <span className="tabular-nums">{index + 1}</span>
                  {label}
                </span>
                {index === 0 ? (
                  <span className="text-muted-foreground">→</span>
                ) : null}
              </li>
            ))}
          </ol>

          {bulkStep === 0 ? (
            <BulkUploadStep
              brandName={brand.name}
              fields={fields}
              sheets={sheets}
              activeSheetIndex={activeSheetIndex}
              onSheetsLoaded={(loaded) => {
                setSheets(loaded)
                setActiveSheetIndex(0)
              }}
              onSelectSheet={setActiveSheetIndex}
              onNext={() => setBulkStep(1)}
            />
          ) : (
            <PreviewStep
              rows={preparedRows}
              isApplying={applyMutation.isPending}
              onBack={() => setBulkStep(0)}
              onApply={() => applyMutation.mutate()}
            />
          )}
        </div>
      ) : null}

      {mode === 'single' ? (
        <SingleEntryForm
          brandId={brand.id}
          brandSlug={brand.slug}
          fields={fields}
          seasons={seasonsQuery.data ?? []}
          existingStyles={stylesQuery.data ?? []}
        />
      ) : null}
    </div>
  )
}
