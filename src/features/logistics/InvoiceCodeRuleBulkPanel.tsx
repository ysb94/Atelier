import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import {
  applyBulkInvoiceCodeRules,
  listStyleRefsForLookup,
} from '@/lib/api'
import { parseFile } from '@/lib/import/parse'
import {
  downloadInvoiceCodeRuleTemplate,
  prepareInvoiceRuleRows,
  toInvoiceCodeRuleInput,
  type PreparedInvoiceRuleRow,
} from '@/lib/invoice/rule-import'
import { Button } from '@/components/ui/button'
import { cn, formatNumber } from '@/lib/utils'

const PREVIEW_LIMIT = 200

/** 자체품번코드·M번호·공식 상품명·메모 엑셀로 이름변경 기준을 한 번에 등록한다. */
export function InvoiceCodeRuleBulkPanel({
  brandId,
  brandName,
}: {
  brandId: string
  brandName: string
}) {
  const queryClient = useQueryClient()
  const [prepared, setPrepared] = useState<PreparedInvoiceRuleRow[] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [parsing, setParsing] = useState(false)

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter((row) => row.statusLabel === 'ok')
        .map((row) => ({
          lineNo: row.lineNo,
          input: toInvoiceCodeRuleInput(row),
        }))
      if (rows.length === 0) throw new Error('등록할 행이 없습니다.')
      return applyBulkInvoiceCodeRules(brandId, rows)
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-name-rules', brandId],
      })
      const failText =
        result.failures.length > 0
          ? ` · 저장 실패 ${formatNumber(result.failures.length)}건` +
            (result.failures[0]
              ? ` (예: ${result.failures[0].code} ${result.failures[0].message})`
              : '')
          : ''
      setError(null)
      setPrepared(null)
      setSummary(`${formatNumber(result.saved)}건 등록했습니다${failText}`)
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
      const sheet = sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }

      const styleNos: string[] = []
      const names: string[] = []
      for (let i = 1; i < sheet.rows.length; i += 1) {
        const row = sheet.rows[i] ?? []
        const styleNo = (row[1] ?? '').trim()
        const name = (row[2] ?? '').trim()
        if (styleNo) styleNos.push(styleNo)
        else if (name) names.push(name)
      }

      const lookup = await listStyleRefsForLookup(brandId, {
        styleNos,
        names,
      })
      setPrepared(prepareInvoiceRuleRows(sheet.rows, lookup))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    } finally {
      setParsing(false)
    }
  }

  const okCount =
    prepared?.filter((row) => row.statusLabel === 'ok').length ?? 0
  const errorCount =
    prepared?.filter((row) => row.statusLabel === 'error').length ?? 0
  const renameCount =
    prepared?.filter(
      (row) => row.statusLabel === 'ok' && row.action === 'rename',
    ).length ?? 0
  const previewRows = (prepared ?? []).slice(0, PREVIEW_LIMIT)

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">
        1열 자체품번코드, 2열 M번호, 3열 공식 상품명(참고), 4열 메모(선택)로 된
        엑셀을 올리세요. M번호·상품명을 비우면 예외(원본 품목명 유지)로
        등록됩니다. 「변환 안 된 코드」일괄 다운로드 파일도 그대로 올릴 수
        있습니다.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true)
            setError(null)
            try {
              await downloadInvoiceCodeRuleTemplate(brandName)
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
            disabled={parsing}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
              event.target.value = ''
            }}
          />
          <span className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-xs hover:bg-muted">
            <Upload className="size-3.5" />
            {parsing ? '해석 중...' : '파일 선택'}
          </span>
        </label>
      </div>

      {prepared ? (
        <>
          <p className="text-xs text-muted-foreground">
            등록 가능 {formatNumber(okCount)}건 (공식명{' '}
            {formatNumber(renameCount)}건 · 예외{' '}
            {formatNumber(okCount - renameCount)}건) · 오류{' '}
            {formatNumber(errorCount)}건
          </p>
          {previewRows.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="sticky top-0 border-b border-border bg-muted/60">
                  <tr>
                    <th className="px-3 py-2 font-medium">행</th>
                    <th className="px-3 py-2 font-medium">자체품번코드</th>
                    <th className="px-3 py-2 font-medium">M번호</th>
                    <th className="px-3 py-2 font-medium">공식 상품명</th>
                    <th className="px-3 py-2 font-medium">메모</th>
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
                      <td className="px-3 py-2 font-medium">
                        {row.code || '—'}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {row.styleNo ||
                          (row.action === 'exception' ? '-' : '—')}
                      </td>
                      <td className="max-w-56 truncate px-3 py-2">
                        {row.officialName || '(예외 · 원본 유지)'}
                      </td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                        {row.note || '-'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'text-xs',
                            row.statusLabel === 'error' && 'text-danger',
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
          {prepared.length > PREVIEW_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              미리보기는 앞의 {formatNumber(PREVIEW_LIMIT)}건만 표시합니다.
            </p>
          ) : null}
        </>
      ) : null}

      {summary ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-foreground">
          {summary}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {prepared ? (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPrepared(null)}
          >
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={okCount === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending
              ? '등록 중...'
              : `${formatNumber(okCount)}건 반영`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
