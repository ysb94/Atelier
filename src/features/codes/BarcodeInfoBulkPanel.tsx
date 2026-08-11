import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Upload, X } from 'lucide-react'
import { applyBulkBarcodeInfo } from '@/lib/api'
import {
  downloadBarcodeInfoWorkbook,
  prepareBarcodeInfoRows,
  type PreparedBarcodeInfoRow,
} from '@/lib/codes/barcode-info-import'
import { parseFile } from '@/lib/import/parse'
import type { BarcodeField, ProductCode } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatNumber } from '@/lib/utils'

type BarcodeInfoBulkPanelProps = {
  brandName: string
  codes: ProductCode[]
  fields: BarcodeField[]
  onApplied: () => void | Promise<void>
  onClose: () => void
}

const PREVIEW_LIMIT = 200

/** 88코드로 기존 행을 찾아 관리 중인 바코드 항목을 일괄 수정한다. */
export function BarcodeInfoBulkPanel({
  brandName,
  codes,
  fields,
  onApplied,
  onClose,
}: BarcodeInfoBulkPanelProps) {
  const [prepared, setPrepared] = useState<PreparedBarcodeInfoRow[] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter(
          (row): row is PreparedBarcodeInfoRow & { input: NonNullable<typeof row.input> } =>
            row.statusLabel === 'ok' && row.input !== null,
        )
        .map((row) => ({
          lineNo: row.lineNo,
          codeId: row.codeId,
          input: row.input,
        }))
      if (rows.length === 0) throw new Error('수정할 행이 없습니다.')
      return applyBulkBarcodeInfo(rows)
    },
    onSuccess: async (result) => {
      const failText =
        result.failures.length > 0
          ? ` · 저장 실패 ${formatNumber(result.failures.length)}건` +
            (result.failures[0]
              ? ` (예: ${result.failures[0].code} ${result.failures[0].message})`
              : '')
          : ''
      setError(null)
      setPrepared(null)
      setSummary(
        `${formatNumber(result.updated)}건의 포장 정보를 수정했습니다${failText}`,
      )
      await onApplied()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : '정보 일괄 수정에 실패했습니다.',
      )
    },
  })

  async function handleFile(file: File) {
    setError(null)
    setSummary(null)
    try {
      const sheets = await parseFile(file)
      const sheet = sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      setPrepared(prepareBarcodeInfoRows({ rows: sheet.rows, codes, fields }))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    }
  }

  const okCount = prepared?.filter((row) => row.statusLabel === 'ok').length ?? 0
  const skipCount =
    prepared?.filter((row) => row.statusLabel === 'skip').length ?? 0
  const errorCount =
    prepared?.filter((row) => row.statusLabel === 'error').length ?? 0
  const previewRows = useMemo(
    () =>
      (prepared ?? [])
        .filter((row) => row.statusLabel !== 'skip')
        .slice(0, PREVIEW_LIMIT),
    [prepared],
  )
  const relevantCount = okCount + errorCount

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">바코드 정보 일괄 수정</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              현재 정보를 내려받아 관리 중인 헤더 값을 수정하세요. 88코드가 같은
              행을 찾아 갱신하며, 빈 칸은 기존 값을 유지합니다. 바코드 상품명과
              M번호는 이 화면에서 수정하지 않습니다.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={downloading || codes.length === 0}
            onClick={async () => {
              setDownloading(true)
              setError(null)
              try {
                await downloadBarcodeInfoWorkbook({ brandName, codes, fields })
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : '현재 정보를 내려받지 못했습니다.',
                )
              } finally {
                setDownloading(false)
              }
            }}
          >
            <Download className="size-4" />
            현재 정보 내려받기
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
                event.target.value = ''
              }}
            />
            <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 text-sm hover:bg-muted">
              <Upload className="size-4" />
              수정 파일 선택
            </span>
          </label>
        </div>

        {prepared ? (
          <>
            <p className="text-xs text-muted-foreground">
              수정 가능 {formatNumber(okCount)}건 · 변경 없음{' '}
              {formatNumber(skipCount)}건 · 오류 {formatNumber(errorCount)}건
            </p>
            {previewRows.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">행</th>
                      <th className="px-3 py-2 font-medium">88코드</th>
                      <th className="px-3 py-2 font-medium">바코드 상품명</th>
                      <th className="px-3 py-2 font-medium">무게(g)</th>
                      <th className="px-3 py-2 font-medium">규격(mm)</th>
                      <th className="px-3 py-2 font-medium">비고</th>
                      <th className="px-3 py-2 font-medium">결과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr
                        key={`${row.lineNo}-${row.code}`}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {row.lineNo}
                        </td>
                        <td className="px-3 py-2 font-medium tabular-nums">
                          {row.code || '—'}
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2">
                          {row.name || '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.weightG === null
                            ? '—'
                            : formatNumber(row.weightG)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.widthCm ?? '—'} × {row.depthCm ?? '—'} ×{' '}
                          {row.heightCm ?? '—'} cm
                        </td>
                        <td className="max-w-[240px] truncate px-3 py-2">
                          {row.note || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              'text-xs',
                              row.statusLabel === 'error' && 'text-danger',
                              row.statusLabel === 'ok' &&
                                'text-muted-foreground',
                            )}
                          >
                            {row.message}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                변경하거나 오류가 있는 행이 없습니다.
              </p>
            )}
            {relevantCount > PREVIEW_LIMIT ? (
              <p className="text-xs text-muted-foreground">
                미리보기는 앞의 {formatNumber(PREVIEW_LIMIT)}건만 표시합니다.
              </p>
            ) : null}
          </>
        ) : null}

        {summary ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
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
            disabled={okCount === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending
              ? '수정 중...'
              : `${formatNumber(okCount)}건 반영`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
