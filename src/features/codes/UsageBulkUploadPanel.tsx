import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Upload, X } from 'lucide-react'
import { applyBulkUsageAssignments } from '@/lib/api'
import {
  downloadUsageCodeTemplate,
  prepareUsageRows,
  type PreparedUsageRow,
} from '@/lib/codes/usage-import'
import { parseFile } from '@/lib/import/parse'
import {
  CODE_USAGE_STATUS_LABEL,
  type CodeUsageStatus,
  type CodeUsageTarget,
  type ProductCode,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatNumber } from '@/lib/utils'

type UsageBulkUploadPanelProps = {
  brandName: string
  brandId: string
  usageTarget: CodeUsageTarget
  codes: ProductCode[]
  existingByCodeId: Map<string, CodeUsageStatus>
  onApplied: () => void | Promise<void>
  onClose?: () => void
}

/** 선택한 사용처에 자사 바코드를 엑셀/CSV로 일괄 등록한다. */
export function UsageBulkUploadPanel({
  brandName,
  brandId,
  usageTarget,
  codes,
  existingByCodeId,
  onApplied,
  onClose,
}: UsageBulkUploadPanelProps) {
  const [prepared, setPrepared] = useState<PreparedUsageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter((row) => row.statusLabel === 'ok' && row.productCodeId)
        .map((row) => ({
          productCodeId: row.productCodeId!,
          status: row.status,
        }))
      if (rows.length === 0) {
        throw new Error('반영할 행이 없습니다.')
      }
      return applyBulkUsageAssignments(brandId, usageTarget.id, rows)
    },
    onSuccess: async () => {
      setError(null)
      setPrepared(null)
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
    try {
      const sheets = await parseFile(file)
      const sheet = sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      setPrepared(
        prepareUsageRows({
          rows: sheet.rows,
          ownCodes: codes,
          existingByCodeId,
        }),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    }
  }

  const okCount = prepared?.filter((r) => r.statusLabel === 'ok').length ?? 0
  const errorCount =
    prepared?.filter((r) => r.statusLabel === 'error').length ?? 0

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">
              {usageTarget.name} 일괄 등록
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              양식의 88코드 열에 자사 바코드 마스터에 있는 코드만 넣으세요.
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
                await downloadUsageCodeTemplate({
                  brandName,
                  usageTargetName: usageTarget.name,
                })
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
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">행</th>
                  <th className="px-3 py-2 font-medium">88코드</th>
                  <th className="px-3 py-2 font-medium">코드명</th>
                  <th className="px-3 py-2 font-medium">상태</th>
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
                    <td className="px-3 py-2">
                      {row.productCodeName ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {CODE_USAGE_STATUS_LABEL[row.status]}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'text-xs',
                          row.statusLabel === 'error' && 'text-danger',
                          row.statusLabel === 'warn' && 'text-warning',
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
            반영 가능 {formatNumber(okCount)}건 · 오류{' '}
            {formatNumber(errorCount)}건
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
            disabled={okCount === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending
              ? '등록 중...'
              : `${formatNumber(okCount)}건 반영`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
