import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Settings2, Upload, X } from 'lucide-react'
import { applyBulkSabangnetProducts } from '@/lib/api'
import {
  describeSabangnetHeader,
  downloadSabangnetTemplate,
  findSabangnetHeader,
  isSabangnetApplyRow,
  prepareSabangnetRows,
  timeSabangnetWork,
  toSabangnetProductInput,
  type PreparedSabangnetRow,
} from '@/lib/codes/sabangnet-import'
import { useRenderWatch } from '@/lib/diagnostics'
import { parseFile } from '@/lib/import/parse'
import type { SabangnetField, SabangnetProduct, StyleRef } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatNumber } from '@/lib/utils'

const ERROR_PREVIEW_LIMIT = 20

type SabangnetBulkUploadPanelProps = {
  brandName: string
  brandId: string
  styles: StyleRef[]
  fields?: SabangnetField[]
  fieldsOpen?: boolean
  existingProducts: SabangnetProduct[]
  onApplied: () => void | Promise<void>
  onManageFields?: () => void
  onClose?: () => void
}

function countBy(
  rows: PreparedSabangnetRow[],
  status: PreparedSabangnetRow['statusLabel'],
) {
  return rows.filter((row) => row.statusLabel === status).length
}

export function SabangnetBulkUploadPanel({
  brandName,
  brandId,
  styles,
  fields,
  fieldsOpen = false,
  existingProducts,
  onApplied,
  onManageFields,
  onClose,
}: SabangnetBulkUploadPanelProps) {
  useRenderWatch('SabangnetBulkUploadPanel')
  const [prepared, setPrepared] = useState<PreparedSabangnetRow[] | null>(null)
  const [headerHint, setHeaderHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter(isSabangnetApplyRow)
        .map((row) => ({
          lineNo: row.lineNo,
          productId: row.productId,
          input: toSabangnetProductInput(row),
        }))
      if (rows.length === 0) {
        throw new Error('반영할 행이 없습니다.')
      }
      return applyBulkSabangnetProducts(brandId, rows)
    },
    onSuccess: async (result) => {
      setError(null)
      setPrepared(null)
      setHeaderHint(null)
      const parts = [
        result.created > 0 ? `${formatNumber(result.created)}건 등록` : '',
        result.updated > 0 ? `${formatNumber(result.updated)}건 수정` : '',
      ].filter(Boolean)
      const failText =
        result.failures.length > 0
          ? ` · 저장 실패 ${formatNumber(result.failures.length)}건` +
            (result.failures[0]
              ? ` (예: ${result.failures[0].code} ${result.failures[0].message})`
              : '')
          : ''
      setSummary(
        `${parts.join(' · ') || '반영할 변경이 없습니다'}${failText}`,
      )
      await onApplied()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : '일괄 저장에 실패했습니다.',
      )
    },
  })

  async function handleFile(file: File) {
    setError(null)
    setSummary(null)
    setHeaderHint(null)
    try {
      const sheets = await parseFile(file)
      const sheet = sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      setHeaderHint(
        describeSabangnetHeader(findSabangnetHeader(sheet.rows, fields)),
      )
      setPrepared(
        timeSabangnetWork('사방넷 엑셀 미리보기', () =>
          prepareSabangnetRows({
            rows: sheet.rows,
            styles,
            existingProducts,
            fields,
          }),
        ),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '파일을 파싱하지 못했습니다.',
      )
    }
  }

  const counts = useMemo(() => {
    if (!prepared) {
      return {
        create: 0,
        pending: 0,
        update: 0,
        unchanged: 0,
        error: 0,
        apply: 0,
      }
    }
    const create = countBy(prepared, 'ok')
    const pending = countBy(prepared, 'pending')
    const update = countBy(prepared, 'update')
    return {
      create,
      pending,
      update,
      unchanged: countBy(prepared, 'unchanged'),
      error: countBy(prepared, 'error'),
      apply: create + pending + update,
    }
  }, [prepared])

  const errorRows = useMemo(() => {
    if (!prepared) return []
    return prepared.filter((row) => row.statusLabel === 'error')
  }, [prepared])
  const errorPreview = errorRows.slice(0, ERROR_PREVIEW_LIMIT)

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">사방넷 코드 일괄 등록·수정</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              사방넷 코드가 키입니다. 파일에 있는 헤더 열만 반영하고, 없는 열은
              기존 값을 유지합니다. M번호 열이 있는데 칸이 비면 미연결이 됩니다.
              헤더 이름과 추가 항목은 항목 관리에서 바꿉니다.
            </p>
          </div>
          {onClose ? (
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {onManageFields ? (
            <Button
              type="button"
              variant="outline"
              onClick={onManageFields}
            >
              <Settings2 className="size-4" />
              {fieldsOpen ? '항목 관리 닫기' : '항목 관리'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true)
              try {
                await downloadSabangnetTemplate({ brandName, fields })
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

        {headerHint ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {headerHint}
          </p>
        ) : null}

        {prepared ? (
          <div className="grid gap-2 sm:grid-cols-4">
            <SummaryChip
              label="신규"
              value={counts.create + counts.pending}
              hint={
                counts.pending > 0
                  ? `미연결 ${formatNumber(counts.pending)}`
                  : undefined
              }
            />
            <SummaryChip label="수정" value={counts.update} />
            <SummaryChip label="변경 없음" value={counts.unchanged} />
            <SummaryChip label="오류" value={counts.error} danger />
          </div>
        ) : null}

        {prepared && errorRows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-danger">
              오류 {formatNumber(errorRows.length)}건은 반영하지 않습니다.
            </p>
            <div className="max-h-56 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted/80 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">행</th>
                    <th className="px-3 py-2 font-medium">사방넷 코드</th>
                    <th className="px-3 py-2 font-medium">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {errorPreview.map((row) => (
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
                      <td className="px-3 py-2 text-xs text-danger">
                        {row.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errorRows.length > ERROR_PREVIEW_LIMIT ? (
              <p className="text-xs text-muted-foreground">
                오류 {formatNumber(errorRows.length)}건 중{' '}
                {formatNumber(ERROR_PREVIEW_LIMIT)}건만 보여 줍니다.
              </p>
            ) : null}
          </div>
        ) : null}

        {prepared && errorRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {counts.apply > 0
              ? `반영 ${formatNumber(counts.apply)}건` +
                (counts.unchanged > 0
                  ? ` · 같은 내용 ${formatNumber(counts.unchanged)}건은 건너뜁니다`
                  : '')
              : '바꿀 내용이 없습니다.'}
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
            disabled={counts.apply === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending
              ? '저장 중...'
              : `${formatNumber(counts.apply)}건 반영`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryChip({
  label,
  value,
  hint,
  danger,
}: {
  label: string
  value: number
  hint?: string
  danger?: boolean
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          danger && value > 0
            ? 'text-lg font-semibold tabular-nums text-danger'
            : 'text-lg font-semibold tabular-nums'
        }
      >
        {formatNumber(value)}
      </div>
      {hint ? (
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  )
}
