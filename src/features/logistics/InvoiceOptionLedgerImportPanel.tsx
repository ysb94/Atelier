import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { applyBulkInvoiceOptionMaps, listStyleRefsForLookup } from '@/lib/api'
import { parseFile } from '@/lib/import/parse'
import {
  collectInvoiceOptionLedgerStyleCandidates,
  downloadInvoiceOptionLedgerTemplate,
  prepareInvoiceOptionLedgerRows,
  type PreparedInvoiceOptionLedgerRow,
} from '@/lib/invoice/option-ledger-import'
import { Button } from '@/components/ui/button'
import { cn, formatNumber } from '@/lib/utils'

const PREVIEW_LIMIT = 200

export function InvoiceOptionLedgerImportPanel({
  brandId,
  brandName,
}: {
  brandId: string
  brandName: string
}) {
  const queryClient = useQueryClient()
  const [prepared, setPrepared] = useState<PreparedInvoiceOptionLedgerRow[] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [parsing, setParsing] = useState(false)

  const counts = {
    ready: prepared?.filter((row) => row.status === 'ready' || row.status === 'duplicate').length ?? 0,
    duplicate: prepared?.filter((row) => row.status === 'duplicate').length ?? 0,
    conflict: prepared?.filter((row) => row.status === 'conflict').length ?? 0,
    unmatched: prepared?.filter((row) => row.status === 'unmatched').length ?? 0,
    error: prepared?.filter((row) => row.status === 'error').length ?? 0,
  }

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter((row) => row.input && (row.status === 'ready' || row.status === 'duplicate'))
        .map((row) => row.input!)
      if (rows.length === 0) throw new Error('등록할 정상 행이 없습니다.')
      return applyBulkInvoiceOptionMaps(brandId, rows)
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-option-maps', brandId],
      })
      const failText =
        result.failures.length > 0
          ? ` · 저장 실패 ${formatNumber(result.failures.length)}건`
          : ''
      setError(null)
      setPrepared(null)
      setSummary(
        `${formatNumber(result.saved)}건을 변환 기준으로 등록했습니다${failText}`,
      )
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : '일괄 등록에 실패했습니다.')
    },
  })

  async function handleFile(file: File) {
    setError(null)
    setSummary(null)
    setParsing(true)
    try {
      const sheets = await parseFile(file)
      const sheet =
        sheets.find((item) => /변환|원장|vlookup|이름/i.test(item.name)) ??
        sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      const candidates = collectInvoiceOptionLedgerStyleCandidates(sheet.rows)
      const lookup = await listStyleRefsForLookup(brandId, candidates)
      setPrepared(prepareInvoiceOptionLedgerRows(sheet.rows, lookup))
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '원장을 읽지 못했습니다.',
      )
    } finally {
      setParsing(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        누적 VLOOKUP이나 변환 원장을 올리면 공식 M번호와 대조합니다. 충돌·미일치는
        등록하지 않고, 정상 건만 일괄 반영합니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true)
            try {
              await downloadInvoiceOptionLedgerTemplate(brandName)
            } finally {
              setDownloading(false)
            }
          }}
        >
          <Download className="size-3.5" />
          양식 내려받기
        </Button>
        <label className="inline-flex">
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="hidden"
            disabled={parsing}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleFile(file)
            }}
          />
          <span className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Upload className="size-3.5" />
            {parsing ? '읽는 중...' : '원장 올리기'}
          </span>
        </label>
        <Button
          type="button"
          size="sm"
          disabled={!prepared || counts.ready === 0 || applyMutation.isPending}
          onClick={() => applyMutation.mutate()}
        >
          정상 {formatNumber(counts.ready)}건 등록
        </Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {summary ? <p className="text-xs text-success">{summary}</p> : null}
      {prepared ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span>정상 {formatNumber(counts.ready)}</span>
            <span className="text-muted-foreground">
              중복합침 {formatNumber(counts.duplicate)}
            </span>
            <span className="text-warning">
              충돌 {formatNumber(counts.conflict)}
            </span>
            <span className="text-danger">
              미일치 {formatNumber(counts.unmatched + counts.error)}
            </span>
          </div>
          <div className="max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-220 text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2 font-medium">행</th>
                  <th className="px-3 py-2 font-medium">원본 품목명</th>
                  <th className="px-3 py-2 font-medium">내품명</th>
                  <th className="px-3 py-2 font-medium">본품</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">내용</th>
                </tr>
              </thead>
              <tbody>
                {prepared.slice(0, PREVIEW_LIMIT).map((row) => (
                  <tr key={`${row.lineNo}-${row.productName}`} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{row.lineNo}</td>
                    <td className="max-w-64 truncate px-3 py-2">{row.productName}</td>
                    <td className="max-w-48 truncate px-3 py-2">
                      {row.itemName || '-'}
                    </td>
                    <td className="px-3 py-2">
                      {row.mainStyle
                        ? `${row.mainStyle.styleNo} · ${row.mainStyle.name}`
                        : '-'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2',
                        row.status === 'ready' || row.status === 'duplicate'
                          ? 'text-success'
                          : row.status === 'conflict'
                            ? 'text-warning'
                            : 'text-danger',
                      )}
                    >
                      {row.status === 'ready'
                        ? '정상'
                        : row.status === 'duplicate'
                          ? '중복'
                          : row.status === 'conflict'
                            ? '충돌'
                            : row.status === 'unmatched'
                              ? '미일치'
                              : '오류'}
                    </td>
                    <td className="max-w-96 truncate px-3 py-2 text-muted-foreground">
                      {row.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prepared.length > PREVIEW_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              미리보기는 앞 {PREVIEW_LIMIT}행입니다. 등록은 정상 건 전체입니다.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
