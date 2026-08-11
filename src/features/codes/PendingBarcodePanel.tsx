import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import {
  applyBulkBarcodeComponents,
  updateProductCode,
} from '@/lib/api'
import {
  downloadPendingBarcodeFill,
  prepareBarcodeFillRows,
  resolveStyleNosToComponents,
  toFillInput,
  type PreparedFillRow,
} from '@/lib/codes/barcode-import'
import { parseFile } from '@/lib/import/parse'
import type { BarcodeField, ProductCode, Style } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, formatNumber } from '@/lib/utils'

type PendingBarcodePanelProps = {
  brandName: string
  codes: ProductCode[]
  styles: Style[]
  fields: BarcodeField[]
  onChanged: () => void | Promise<void>
}

/** M번호가 비어 있는 자사 바코드를 모아 행별·엑셀로 채운다. */
export function PendingBarcodePanel({
  brandName,
  codes,
  styles,
  fields,
  onChanged,
}: PendingBarcodePanelProps) {
  const pendingCodes = useMemo(
    () => codes.filter((code) => code.components.length === 0),
    [codes],
  )

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<PreparedFillRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const fillMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter((row) => row.statusLabel === 'ok' && row.codeId)
        .map((row) => {
          const code = codes.find((item) => item.id === row.codeId)
          if (!code) {
            throw new Error(`바코드를 찾을 수 없습니다. (${row.code})`)
          }
          return {
            lineNo: row.lineNo,
            codeId: row.codeId,
            input: toFillInput(code, row.components),
          }
        })
      if (rows.length === 0) {
        throw new Error('채울 행이 없습니다.')
      }
      return applyBulkBarcodeComponents(rows)
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
        `${formatNumber(result.updated)}건의 M번호를 채웠습니다${failText}`,
      )
      await onChanged()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : 'M번호 채우기에 실패했습니다.',
      )
    },
  })

  async function saveRow(code: ProductCode) {
    const raw = drafts[code.id] ?? ''
    const { components, error: resolveError } = resolveStyleNosToComponents({
      raw,
      styles,
    })
    if (resolveError) {
      setRowErrors((prev) => ({ ...prev, [code.id]: resolveError }))
      return
    }

    setSavingId(code.id)
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[code.id]
      return next
    })
    setError(null)
    try {
      await updateProductCode(code.id, toFillInput(code, components))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[code.id]
        return next
      })
      setSummary(`${code.code}에 M번호를 채웠습니다.`)
      await onChanged()
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [code.id]:
          err instanceof Error ? err.message : '저장에 실패했습니다.',
      }))
    } finally {
      setSavingId(null)
    }
  }

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
        prepareBarcodeFillRows({
          rows: sheet.rows,
          styles,
          codes,
          fields,
        }),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    }
  }

  const okCount = prepared?.filter((r) => r.statusLabel === 'ok').length ?? 0
  const skipCount =
    prepared?.filter((r) => r.statusLabel === 'skip').length ?? 0
  const errorCount =
    prepared?.filter((r) => r.statusLabel === 'error').length ?? 0

  if (pendingCodes.length === 0 && !prepared && !summary) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
        M번호가 비어 있는 바코드가 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={downloading || pendingCodes.length === 0}
          onClick={async () => {
            setDownloading(true)
            setError(null)
            try {
              await downloadPendingBarcodeFill({
                brandName,
                codes: pendingCodes,
                fields,
              })
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : '목록을 내려받지 못했습니다.',
              )
            } finally {
              setDownloading(false)
            }
          }}
        >
          <Download className="size-4" />
          미지정 목록 다운로드
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
            채운 파일 업로드
          </span>
        </label>
        <p className="text-sm text-muted-foreground sm:ml-auto">
          미지정 {formatNumber(pendingCodes.length)}건
        </p>
      </div>

      {pendingCodes.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">88코드</th>
                <th className="px-4 py-3 font-medium">바코드 상품명</th>
                <th className="px-4 py-3 font-medium">M번호</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {pendingCodes.map((code) => (
                <tr
                  key={code.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {code.code}
                  </td>
                  <td className="px-4 py-3">{code.name}</td>
                  <td className="px-4 py-3">
                    <Input
                      className="min-w-[200px]"
                      placeholder="M0001, M0002"
                      value={drafts[code.id] ?? ''}
                      onChange={(event) => {
                        const value = event.target.value
                        setDrafts((prev) => ({ ...prev, [code.id]: value }))
                        setRowErrors((prev) => {
                          if (!prev[code.id]) return prev
                          const next = { ...prev }
                          delete next[code.id]
                          return next
                        })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void saveRow(code)
                        }
                      }}
                    />
                    {rowErrors[code.id] ? (
                      <p className="mt-1 text-xs text-danger">
                        {rowErrors[code.id]}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingId === code.id}
                      onClick={() => void saveRow(code)}
                    >
                      {savingId === code.id ? '저장 중...' : '저장'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {prepared ? (
        <div className="space-y-3">
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
                          row.statusLabel === 'skip' && 'text-muted-foreground',
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
          <p className="text-xs text-muted-foreground">
            반영 가능 {formatNumber(okCount)}건 · 건너뜀{' '}
            {formatNumber(skipCount)}건 · 오류 {formatNumber(errorCount)}건
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrepared(null)}
            >
              미리보기 닫기
            </Button>
            <Button
              type="button"
              disabled={okCount === 0 || fillMutation.isPending}
              onClick={() => fillMutation.mutate()}
            >
              {fillMutation.isPending
                ? '채우는 중...'
                : `${formatNumber(okCount)}건 반영`}
            </Button>
          </div>
        </div>
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
    </div>
  )
}
