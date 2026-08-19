import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import {
  getInvoiceItemNameRules,
  listStyleRefsForLookup,
  saveInvoiceItemNameRules,
} from '@/lib/api'
import { parseFile } from '@/lib/import/parse'
import {
  collectInvoiceItemNameRuleStyleNos,
  downloadInvoiceItemNameRuleTemplate,
  prepareInvoiceItemNameRuleRows,
  type PreparedInvoiceItemNameRuleRow,
} from '@/lib/invoice/item-name-rule-import'
import { Button } from '@/components/ui/button'
import { cn, formatNumber } from '@/lib/utils'

const PREVIEW_LIMIT = 200

const STATUS_LABEL: Record<PreparedInvoiceItemNameRuleRow['status'], string> = {
  new: '신규',
  overwrite: '덮어쓰기',
  unchanged: '변화없음',
  skip: '안 정함',
  error: '오류',
}

/** 내품명 원장 엑셀로 조회 키·공통 규칙을 한 번에 등록한다. */
export function InvoiceItemNameRuleBulkPanel({
  brandId,
  brandName,
}: {
  brandId: string
  brandName: string
}) {
  const queryClient = useQueryClient()
  const [prepared, setPrepared] = useState<
    PreparedInvoiceItemNameRuleRow[] | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [parsing, setParsing] = useState(false)

  const applyMutation = useMutation({
    mutationFn: async () => {
      const items = (prepared ?? [])
        .filter((row) => row.input !== null)
        .map((row) => ({
          input: row.input!,
          ruleId: row.existingRuleId ?? undefined,
        }))
      if (items.length === 0) throw new Error('반영할 규칙이 없습니다.')
      return saveInvoiceItemNameRules(brandId, items)
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-item-name-rules', brandId],
      })
      const failText =
        result.failed.length > 0
          ? ` · 저장 실패 ${formatNumber(result.failed.length)}건` +
            (result.failed[0] ? ` (예: ${result.failed[0].message})` : '')
          : ''
      setError(null)
      setPrepared(null)
      setSummary(
        `${formatNumber(result.applied.length)}건 반영했습니다${failText}`,
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
        sheets.find((item) => item.name.replace(/\s+/g, '') === '내품명원장') ??
        sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      const [lookup, existingRules] = await Promise.all([
        listStyleRefsForLookup(brandId, {
          styleNos: collectInvoiceItemNameRuleStyleNos(sheet.rows),
        }),
        getInvoiceItemNameRules(brandId, true),
      ])
      setPrepared(
        prepareInvoiceItemNameRuleRows(sheet.rows, lookup, existingRules),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    } finally {
      setParsing(false)
    }
  }

  const rows = prepared ?? []
  const newCount = rows.filter((row) => row.status === 'new').length
  const overwriteCount = rows.filter((row) => row.status === 'overwrite').length
  const unchangedCount = rows.filter((row) => row.status === 'unchanged').length
  const skipCount = rows.filter((row) => row.status === 'skip').length
  const errorCount = rows.filter((row) => row.status === 'error').length
  const applyCount = newCount + overwriteCount
  const previewRows = rows.slice(0, PREVIEW_LIMIT)

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">
        `확정 본품 M번호 · 조회 키 · 옵션명 · 조회 키 선택 · 지우기 · 구성품
        M번호 · 메모 · 대상 행` 8열 엑셀을 올리세요. `조회 키 선택`과 `지우기`는
        Y 한 글자만 쓰고, 비우면 각각 공통 규칙과 구성품으로 읽습니다. 구성품이
        여러 개면 `M1999,M1999,M2000`처럼 한 칸에 쉼표로 나열하고, 같은 M번호를
        반복한 횟수가 수량이 됩니다. `지우기`와 `구성품 M번호`를 모두 비운 행은
        아직 정하지 않은 것으로 보고 건너뛰니, 검토 목록을 받아 필요한 행만
        채워 올리면 됩니다.
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
              await downloadInvoiceItemNameRuleTemplate(brandName)
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
            신규 {formatNumber(newCount)}건 · 덮어쓰기{' '}
            {formatNumber(overwriteCount)}건 · 변화없음{' '}
            {formatNumber(unchangedCount)}건 · 안 정함{' '}
            {formatNumber(skipCount)}건 · 오류 {formatNumber(errorCount)}건
          </p>
          {previewRows.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[62rem] text-left text-xs">
                <thead className="sticky top-0 border-b border-border bg-muted/60">
                  <tr>
                    <th className="px-3 py-2 font-medium">행</th>
                    <th className="px-3 py-2 font-medium">범위</th>
                    <th className="px-3 py-2 font-medium">본품</th>
                    <th className="px-3 py-2 font-medium">조회 키</th>
                    <th className="px-3 py-2 font-medium">옵션명</th>
                    <th className="px-3 py-2 font-medium">동작</th>
                    <th className="px-3 py-2 font-medium">구성품</th>
                    <th className="px-3 py-2 font-medium">결과</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr
                      key={`${row.lineNo}-${row.itemName}-${row.productLookupKey}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {row.lineNos.length > 1
                          ? row.lineNos.join(',')
                          : row.lineNo}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {row.scope === 'global' ? '공통' : '조회 키'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">
                        {row.mainStyle?.styleNo || row.mainStyleLabel || '-'}
                      </td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">
                        {row.productLookupKey || '-'}
                      </td>
                      <td className="max-w-56 truncate px-3 py-2">
                        {row.itemName || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {row.action === 'delete' ? '지우기' : '구성품'}
                      </td>
                      <td className="max-w-48 truncate px-3 py-2">
                        {row.components.length === 0
                          ? '-'
                          : row.components
                              .map(
                                (item) =>
                                  `${item.style.styleNo}${
                                    item.quantity > 1 ? `×${item.quantity}` : ''
                                  }`,
                              )
                              .join(', ')}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'text-xs',
                            row.status === 'error'
                              ? 'text-danger'
                              : row.status === 'overwrite'
                                ? 'text-warning'
                                : 'text-muted-foreground',
                          )}
                        >
                          {STATUS_LABEL[row.status]} · {row.message}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {rows.length > PREVIEW_LIMIT ? (
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
            disabled={applyCount === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending
              ? '반영 중...'
              : `${formatNumber(applyCount)}건 반영`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
