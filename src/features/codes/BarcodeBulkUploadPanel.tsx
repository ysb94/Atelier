import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Upload, X } from 'lucide-react'
import { applyBulkProductCodes } from '@/lib/api'
import {
  downloadBarcodeTemplate,
  prepareBarcodeRows,
  toProductCodeInput,
  type PreparedBarcodeRow,
} from '@/lib/codes/barcode-import'
import { parseFile } from '@/lib/import/parse'
import type { BarcodeField, ProductCode, Style } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatNumber } from '@/lib/utils'

type BarcodeBulkUploadPanelProps = {
  brandName: string
  brandId: string
  styles: Style[]
  fields: BarcodeField[]
  /** 브랜드의 자사·거래처 코드 전체. 중복 88코드 차단용 */
  existingCodes: ProductCode[]
  onApplied: () => void | Promise<void>
  onClose?: () => void
}

/** 회사에서 발급한 88코드를 엑셀로 자사 바코드 마스터에 일괄 등록한다. */
export function BarcodeBulkUploadPanel({
  brandName,
  brandId,
  styles,
  fields,
  existingCodes,
  onApplied,
  onClose,
}: BarcodeBulkUploadPanelProps) {
  const [prepared, setPrepared] = useState<PreparedBarcodeRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter((row) => row.statusLabel !== 'error')
        .map((row) => ({
          lineNo: row.lineNo,
          input: toProductCodeInput(row),
        }))
      if (rows.length === 0) {
        throw new Error('반영할 행이 없습니다.')
      }
      return applyBulkProductCodes(brandId, rows)
    },
    onSuccess: async (result) => {
      setError(null)
      setPrepared(null)
      const failText =
        result.failures.length > 0
          ? ` · 저장 실패 ${formatNumber(result.failures.length)}건` +
            (result.failures[0]
              ? ` (예: ${result.failures[0].code} ${result.failures[0].message})`
              : '')
          : ''
      setSummary(
        `${formatNumber(result.created)}건 등록했습니다${failText}`,
      )
      await onApplied()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : '일괄 등록에 실패했습니다.',
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
      setPrepared(
        prepareBarcodeRows({
          rows: sheet.rows,
          styles,
          fields,
          existingCodes,
        }),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    }
  }

  const okCount =
    prepared?.filter((r) => r.statusLabel === 'ok').length ?? 0
  const pendingCount =
    prepared?.filter((r) => r.statusLabel === 'pending').length ?? 0
  const applyCount = okCount + pendingCount
  const errorCount =
    prepared?.filter((r) => r.statusLabel === 'error').length ?? 0

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">88바코드 일괄 등록</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              회사에서 발급한 88코드·바코드 상품명을 넣으세요. M번호는 비워도
              됩니다. 미지정으로 등록한 뒤 미지정 탭에서 채울 수 있습니다. 이미
              있는 바코드는 덮어쓰지 않습니다.
            </p>
          </div>
          {onClose ? (
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true)
              try {
                await downloadBarcodeTemplate({ brandName, fields })
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : '양식을 내려받지 못했습니다.',
                )
              } finally {
                setDownloading(false)
              }
            }}
          >
            <Download className="size-4" />
            양식 다운로드
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
              파일 선택
            </span>
          </label>
        </div>

        {prepared ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">행</th>
                  <th className="px-3 py-2 font-medium">88코드</th>
                  <th className="px-3 py-2 font-medium">바코드 상품명</th>
                  <th className="px-3 py-2 font-medium">M번호</th>
                  <th className="px-3 py-2 font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {prepared.map((row) => (
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
                    <td className="px-3 py-2">{row.name || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.styleNos.length > 0
                        ? row.styleNos.join(', ')
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'text-xs',
                          row.statusLabel === 'error' && 'text-danger',
                          row.statusLabel === 'pending' && 'text-warning',
                          row.statusLabel === 'ok' && 'text-muted-foreground',
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
        ) : null}

        {prepared ? (
          <p className="text-xs text-muted-foreground">
            반영 가능 {formatNumber(applyCount)}건
            {pendingCount > 0
              ? `(M번호 미지정 ${formatNumber(pendingCount)}건 포함)`
              : ''}{' '}
            · 오류 {formatNumber(errorCount)}건
          </p>
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
          {onClose ? (
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={applyCount === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending
              ? '등록 중...'
              : `${formatNumber(applyCount)}건 반영`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
