import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { applyProductImport, getSeasonsByBrand, getStylesByBrand } from '@/lib/api'
import { guessField, type FieldOwner } from '@/lib/import/fields'
import type { ParsedSheet } from '@/lib/import/parse'
import { prepareRows, type ColumnMapping } from '@/lib/import/transform'
import { cn, formatNumber } from '@/lib/utils'
import { UploadStep } from './UploadStep'
import { MappingStep } from './MappingStep'
import { PreviewStep } from './PreviewStep'

const STEPS = ['업로드', '컬럼 매핑', '검증 및 확정'] as const

export function ImportPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()

  const [step, setStep] = useState(0)
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [hasHeader, setHasHeader] = useState(true)
  const [sourceOwner, setSourceOwner] = useState<FieldOwner>('planning')
  const [allowCrossDepartment, setAllowCrossDepartment] = useState(false)
  const [mapping, setMapping] = useState<ColumnMapping>([])
  const [result, setResult] = useState<{
    created: number
    updated: number
    skipped: number
  } | null>(null)

  const stylesQuery = useQuery({
    queryKey: ['styles', brand.id, 'import'],
    queryFn: () => getStylesByBrand(brand.id),
  })
  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })

  const activeSheet = sheets[activeSheetIndex]

  // 시트나 헤더 설정이 바뀌면 컬럼 매핑을 다시 추측한다.
  useEffect(() => {
    if (!activeSheet) return
    const columnCount = Math.max(
      ...activeSheet.rows.slice(0, 20).map((row) => row.length),
      0,
    )
    const headerRow = hasHeader ? (activeSheet.rows[0] ?? []) : []
    const next: ColumnMapping = Array.from({ length: columnCount }, () => null)
    const taken = new Set<string>()

    for (let i = 0; i < columnCount; i += 1) {
      const guessed = hasHeader ? guessField(headerRow[i] ?? '') : null
      if (guessed && !taken.has(guessed.key)) {
        next[i] = guessed.key
        taken.add(guessed.key)
      }
    }
    setMapping(next)
  }, [activeSheet, hasHeader])

  const preparedRows = useMemo(() => {
    if (!activeSheet) return []
    return prepareRows({
      rows: activeSheet.rows,
      mapping,
      hasHeader,
      sourceOwner,
      allowCrossDepartment,
      existingStyles: stylesQuery.data ?? [],
      seasons: seasonsQuery.data ?? [],
    })
  }, [
    activeSheet,
    mapping,
    hasHeader,
    sourceOwner,
    allowCrossDepartment,
    stylesQuery.data,
    seasonsQuery.data,
  ])

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = preparedRows.filter((row) => row.status !== 'error')
      return applyProductImport(
        brand.id,
        rows.map((row) => ({
          styleNo: row.styleNo,
          matchKey: row.matchKey,
          targetStyleId: row.targetStyleId,
          applied: row.applied,
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

  function reset() {
    setStep(0)
    setSheets([])
    setActiveSheetIndex(0)
    setMapping([])
    setResult(null)
  }

  if (result) {
    return (
      <div>
        <PageHeader title="데이터 가져오기" />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
              <Check className="size-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">가져오기 완료</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                새로 등록 {formatNumber(result.created)}건 · 갱신{' '}
                {formatNumber(result.updated)}건 · 건너뜀{' '}
                {formatNumber(result.skipped)}건
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={reset}>
                다른 시트 가져오기
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
        title="데이터 가져오기"
        description={`부서별 시트를 ${brand.name} 상품 마스터로 합칩니다. 품번을 기준으로 기존 상품과 연결됩니다.`}
      />

      <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5',
                index === step
                  ? 'bg-primary text-primary-foreground'
                  : index < step
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground',
              )}
            >
              <span className="tabular-nums">{index + 1}</span>
              {label}
            </span>
            {index < STEPS.length - 1 ? (
              <span className="text-muted-foreground">→</span>
            ) : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <UploadStep
          sheets={sheets}
          activeSheetIndex={activeSheetIndex}
          onSheetsLoaded={(loaded) => {
            setSheets(loaded)
            setActiveSheetIndex(0)
          }}
          onSelectSheet={setActiveSheetIndex}
          hasHeader={hasHeader}
          onHasHeaderChange={setHasHeader}
          sourceOwner={sourceOwner}
          onSourceOwnerChange={setSourceOwner}
          onNext={() => setStep(1)}
        />
      ) : null}

      {step === 1 && activeSheet ? (
        <MappingStep
          sheet={activeSheet}
          hasHeader={hasHeader}
          mapping={mapping}
          onMappingChange={setMapping}
          sourceOwner={sourceOwner}
          allowCrossDepartment={allowCrossDepartment}
          onAllowCrossDepartmentChange={setAllowCrossDepartment}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      ) : null}

      {step === 2 ? (
        <PreviewStep
          rows={preparedRows}
          isApplying={applyMutation.isPending}
          onBack={() => setStep(1)}
          onApply={() => applyMutation.mutate()}
        />
      ) : null}
    </div>
  )
}
