import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, FolderTree, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { applySabangnetStyleCategories } from '@/lib/api'
import {
  SABANGNET_CATEGORY_STATUS_LABEL,
  SABANGNET_CATEGORY_STATUS_ORDER,
  downloadSabangnetCategories,
  prepareSabangnetCategoryImport,
  type PreparedSabangnetCategoryImport,
  type PreparedSabangnetCategoryRow,
  type SabangnetCategoryImportStatus,
} from '@/lib/codes/sabangnet-category-import'
import { timeSabangnetWork } from '@/lib/codes/sabangnet-import'
import { useRenderWatch } from '@/lib/diagnostics'
import { parseFile } from '@/lib/import/parse'
import type { StyleCategoryIndex } from '@/lib/products/product-categories'
import type { SabangnetProduct } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

const DETAIL_LIMIT = 100

const PROBLEM_STATUSES: SabangnetCategoryImportStatus[] = [
  'mid',
  'missing',
  'inactive',
  'conflict',
  'noStyles',
  'unknownCode',
]

function chipTone(status: SabangnetCategoryImportStatus) {
  if (status === 'ready') return 'success'
  if (status === 'unchanged' || status === 'empty') return 'muted'
  if (status === 'noStyles' || status === 'unknownCode') return 'warning'
  return 'danger'
}

export function SabangnetCategoryImportPanel({
  brandId,
  brandName,
  products,
  index,
  indexLoading,
  onApplied,
  onClose,
}: {
  brandId: string
  brandName: string
  products: SabangnetProduct[]
  index: StyleCategoryIndex | null
  indexLoading: boolean
  onApplied: () => void | Promise<void>
  onClose: () => void
}) {
  useRenderWatch('SabangnetCategoryImportPanel')
  const [prepared, setPrepared] =
    useState<PreparedSabangnetCategoryImport | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [detailStatus, setDetailStatus] =
    useState<SabangnetCategoryImportStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const [downloading, setDownloading] = useState(false)

  const ready = prepared?.ok ? prepared : null
  const readyRows = useMemo(
    () => (ready ? ready.rows.filter((row) => row.status === 'ready') : []),
    [ready],
  )
  const detailRows = useMemo(
    () =>
      ready && detailStatus
        ? ready.rows.filter((row) => row.status === detailStatus)
        : [],
    [ready, detailStatus],
  )

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (readyRows.length === 0) throw new Error('적용할 행이 없습니다.')
      setProgress({ done: 0, total: readyRows.length })
      return applySabangnetStyleCategories(
        brandId,
        readyRows.map((row) => ({ code: row.code, categoryIds: row.categoryIds })),
        (done, total) => setProgress({ done, total }),
      )
    },
    onSuccess: async (result) => {
      setProgress(null)
      setPrepared(null)
      setFileName(null)
      setDetailStatus(null)
      setError(null)
      const skipped = [
        result.noStyles > 0
          ? `그 사이 M번호 연결이 빠진 코드 ${formatNumber(result.noStyles)}개`
          : '',
        result.missing > 0
          ? `그 사이 삭제된 코드 ${formatNumber(result.missing)}개`
          : '',
      ].filter(Boolean)
      setSummary(
        `사방넷 코드 ${formatNumber(result.applied)}개 · M번호 ${formatNumber(result.styles)}개에 카테고리를 적용했습니다.` +
          (skipped.length > 0 ? ` 건너뜀: ${skipped.join(', ')}.` : ''),
      )
      await onApplied()
    },
    onError: (err) => {
      setProgress(null)
      setError(err instanceof Error ? err.message : '카테고리를 적용하지 못했습니다.')
    },
  })

  async function handleFile(file: File) {
    setError(null)
    setSummary(null)
    if (!index) {
      setError('카테고리 정보를 아직 불러오지 못했습니다. 잠시 후 다시 올려 주세요.')
      return
    }
    try {
      const sheets = await parseFile(file)
      const sheet = sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      const result = timeSabangnetWork('카테고리 파일 미리보기', () =>
        prepareSabangnetCategoryImport({
          rows: sheet.rows,
          tree: index.tree,
          products,
          categoriesByStyle: index.byStyle,
        }),
      )
      setFileName(file.name)
      setPrepared(result)
      if (!result.ok) {
        setDetailStatus(null)
        setError(result.error)
        return
      }
      const firstProblem = PROBLEM_STATUSES.find(
        (status) => result.counts[status] > 0,
      )
      setDetailStatus(firstProblem ?? (result.counts.ready > 0 ? 'ready' : null))
    } catch (err) {
      console.warn('[sabangnet] 카테고리 파일을 읽지 못함', {
        fileName: file.name,
        err,
      })
      setError(err instanceof Error ? err.message : '파일을 읽지 못했습니다.')
    }
  }

  async function handleDownload() {
    if (!index) return
    setDownloading(true)
    setError(null)
    try {
      await downloadSabangnetCategories({
        brandName,
        products,
        tree: index.tree,
        categoriesByStyle: index.byStyle,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '파일을 내려받지 못했습니다.')
    } finally {
      setDownloading(false)
    }
  }

  function confirmApply() {
    if (!ready) return
    const others = ready.rows.length - readyRows.length
    const ok = window.confirm(
      `사방넷 코드 ${formatNumber(readyRows.length)}개에 연결된 M번호 ${formatNumber(ready.readyStyleCount)}개의 카테고리를 파일 내용으로 바꿉니다.` +
        (others > 0 ? `\n나머지 ${formatNumber(others)}개 코드는 바꾸지 않습니다.` : '') +
        '\n계속할까요?',
    )
    if (ok) applyMutation.mutate()
  }

  const visibleStatuses = ready
    ? SABANGNET_CATEGORY_STATUS_ORDER.filter(
        (status) => status === 'ready' || ready.counts[status] > 0,
      )
    : []

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <FolderTree className="size-4" />
              카테고리 가져오기
            </div>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              「사방넷 코드 | 카테고리」 2열 파일을 읽어 그 코드에 연결된 M번호
              전체에 카테고리를 저장합니다. 카테고리 칸은 카페24 자사몰 표기를
              그대로 붙여 넣어도 되고, ALL·홈 메뉴 ALL·NEW ARRIVAL과 상위 경로는
              자동으로 뺍니다. 경로가 여러 개면 첫 번째가 대표입니다. 파일에 있는
              코드만 바꾸고, 카테고리 칸이 비면 기존 값을 유지합니다.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!index || downloading}
            onClick={() => void handleDownload()}
          >
            <Download className="size-4" />
            현재 카테고리 내려받기
          </Button>
          <label className={cn('inline-flex', !index && 'pointer-events-none opacity-50')}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              className="hidden"
              disabled={!index || applyMutation.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
                event.target.value = ''
              }}
            />
            <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
              <Upload className="size-4" />
              파일 선택
            </span>
          </label>
          {indexLoading ? (
            <span className="text-xs text-muted-foreground">
              카테고리 정보를 불러오는 중...
            </span>
          ) : null}
          {fileName ? (
            <span className="truncate text-xs text-muted-foreground">
              {fileName}
            </span>
          ) : null}
        </div>

        {ready ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {visibleStatuses.map((status) => {
                const tone = chipTone(status)
                const count = ready.counts[status]
                return (
                  <button
                    key={status}
                    type="button"
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left transition-colors',
                      detailStatus === status
                        ? 'border-foreground/40 bg-muted'
                        : 'border-border hover:bg-muted/50',
                    )}
                    onClick={() => setDetailStatus(status)}
                  >
                    <div className="text-xs text-muted-foreground">
                      {SABANGNET_CATEGORY_STATUS_LABEL[status]}
                    </div>
                    <div
                      className={cn(
                        'text-lg font-semibold tabular-nums',
                        count > 0 && tone === 'success' && 'text-success',
                        count > 0 && tone === 'warning' && 'text-warning',
                        count > 0 && tone === 'danger' && 'text-danger',
                      )}
                    >
                      {formatNumber(count)}
                    </div>
                    {status === 'ready' ? (
                      <div className="text-[11px] text-muted-foreground">
                        M번호 {formatNumber(ready.readyStyleCount)}개
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {ready.mergedLines > 0 ? (
              <p className="text-xs text-muted-foreground">
                같은 코드가 같은 내용으로 반복된 {formatNumber(ready.mergedLines)}
                줄은 한 줄로 합쳤습니다.
              </p>
            ) : null}
            {detailStatus ? (
              <DetailTable
                status={detailStatus}
                rows={detailRows}
              />
            ) : null}
          </>
        ) : null}

        {progress ? (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              적용 중 {formatNumber(progress.done)} / {formatNumber(progress.total)}
            </p>
          </div>
        ) : null}

        {summary ? (
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-foreground">
            {summary}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button
            type="button"
            disabled={readyRows.length === 0 || applyMutation.isPending}
            onClick={confirmApply}
          >
            {applyMutation.isPending
              ? '적용 중...'
              : ready
                ? `M번호 ${formatNumber(ready.readyStyleCount)}개 적용`
                : '적용'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailTable({
  status,
  rows,
}: {
  status: SabangnetCategoryImportStatus
  rows: PreparedSabangnetCategoryRow[]
}) {
  const shown = rows.slice(0, DETAIL_LIMIT)
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">
        {SABANGNET_CATEGORY_STATUS_LABEL[status]} {formatNumber(rows.length)}개
        {rows.length > DETAIL_LIMIT
          ? ` · 앞 ${formatNumber(DETAIL_LIMIT)}개만 보여 줍니다`
          : ''}
      </p>
      <div className="max-h-72 overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0 z-[1] border-b border-border bg-muted/90 text-xs text-muted-foreground backdrop-blur">
            <tr>
              <th className="w-16 px-3 py-2 font-medium">행</th>
              <th className="w-24 px-3 py-2 font-medium">사방넷 코드</th>
              <th className="px-3 py-2 font-medium">상품명</th>
              <th className="px-3 py-2 font-medium">카테고리</th>
              <th className="px-3 py-2 font-medium">내용</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  해당하는 행이 없습니다.
                </td>
              </tr>
            ) : (
              shown.map((row) => (
                <tr
                  key={`${row.code}-${row.lineNos[0]}`}
                  className="border-b border-border align-top last:border-0"
                >
                  <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                    {row.lineNos.join(', ')}
                  </td>
                  <td className="px-3 py-2 font-medium tabular-nums">
                    {row.code || '—'}
                  </td>
                  <td className="max-w-48 px-3 py-2 text-xs text-muted-foreground">
                    <span className="line-clamp-2">{row.productName || '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    {row.paths.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {row.raw || '(빈 칸)'}
                      </span>
                    ) : (
                      <ul className="space-y-0.5">
                        {row.paths.map((path, position) => (
                          <li
                            key={path.key}
                            className={cn(
                              'flex items-center gap-1.5 text-xs',
                              path.status !== 'ok' && 'text-danger',
                            )}
                          >
                            {position === 0 && path.status === 'ok' ? (
                              <Badge className="px-1.5 py-0 text-[10px]">대표</Badge>
                            ) : null}
                            <span>{path.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.message}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
