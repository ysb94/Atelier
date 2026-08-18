import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import {
  applyBulkInvoiceProductNameMaps,
  getInvoiceProductNameMaps,
  listStyleRefsForLookup,
} from '@/lib/api'
import { parseFile } from '@/lib/import/parse'
import {
  collectInvoiceProductNameLedgerStyleCandidates,
  downloadInvoiceProductNameLedgerList,
  downloadInvoiceProductNameLedgerTemplate,
  isNameChangeCasebook,
  prepareInvoiceProductNameLedgerRows,
  prepareProductNameCasebookRows,
  type PreparedInvoiceProductNameLedgerRow,
} from '@/lib/invoice/option-ledger-import'
import { Button } from '@/components/ui/button'
import { cn, formatNumber } from '@/lib/utils'

const PREVIEW_LIMIT = 200

export function InvoiceProductNameLedgerImportPanel({
  brandId,
  brandName,
}: {
  brandId: string
  brandName: string
}) {
  const queryClient = useQueryClient()
  const [prepared, setPrepared] = useState<
    PreparedInvoiceProductNameLedgerRow[] | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadingList, setDownloadingList] = useState(false)
  const [formatLabel, setFormatLabel] = useState('')

  const counts = {
    ready:
      prepared?.filter(
        (row) => row.status === 'ready' || row.status === 'duplicate',
      ).length ?? 0,
    conflict: prepared?.filter((row) => row.status === 'conflict').length ?? 0,
    unmatched:
      prepared?.filter((row) => row.status === 'unmatched').length ?? 0,
    error: prepared?.filter((row) => row.status === 'error').length ?? 0,
  }

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows = (prepared ?? [])
        .filter(
          (row) =>
            row.input && (row.status === 'ready' || row.status === 'duplicate'),
        )
        .map((row) => row.input!)
      if (rows.length === 0) throw new Error('등록할 정상 행이 없습니다.')
      return applyBulkInvoiceProductNameMaps(brandId, rows)
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-product-name-maps', brandId],
      })
      const failText =
        result.failures.length > 0
          ? ` · 저장 실패 ${formatNumber(result.failures.length)}건`
          : ''
      setError(null)
      setPrepared(null)
      setSummary(
        `${formatNumber(result.saved)}건을 품목명 기준으로 등록했습니다${failText}`,
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
      if (sheets.length === 0) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      if (isNameChangeCasebook(sheets)) {
        const expectedSheet = sheets.find(
          (sheet) =>
            sheet.name.replace(/\s+/g, '').toLocaleLowerCase('ko-KR') ===
            'sheet3',
        )
        const expectedNames = (expectedSheet?.rows.slice(1) ?? [])
          .map((row) => String(row[0] ?? '').trim())
          .filter(Boolean)
        const lookup = await listStyleRefsForLookup(brandId, {
          names: expectedNames,
        })
        setPrepared(prepareProductNameCasebookRows(sheets, lookup))
        setFormatLabel('이름 변경 단계 사례집')
        return
      }
      const sheet =
        sheets.find((item) => /변환|원장|품목명|이름/i.test(item.name)) ??
        sheets[0]
      if (!sheet) {
        setError('파일에서 데이터를 읽지 못했습니다.')
        return
      }
      const candidates = collectInvoiceProductNameLedgerStyleCandidates(
        sheet.rows,
      )
      const lookup = await listStyleRefsForLookup(brandId, candidates)
      const rows = prepareInvoiceProductNameLedgerRows(sheet.rows, lookup)
      setPrepared(rows)
      setFormatLabel(
        rows.some((row) => row.lookupKey)
          ? '조회 키 원장 (조회 키 → M번호)'
          : '품목명 원장 (쇼핑몰·품목명·내품명 조합)',
      )
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '원장을 읽지 못했습니다.',
      )
    } finally {
      setParsing(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        양식은 `조회 키`와 `본품 M번호` 2열입니다. 변환된 텍스트를 1열에,
        대응하는 M번호를 2열에 넣으면 현재 공식 명칭을 자동으로 불러옵니다. 예전
        `변경전 → 변경후` 2열 원장도 계속 읽습니다. 쇼핑몰·내품명 열이 있는
        원장이나 `이름 변경 단계` 사례집도 받아서 조합 기준으로 등록합니다. 본품
        기준만 만들고 구성품·변환 내품명은 만들지 않습니다. 수령인·전화번호·주소는
        읽어도 서버에 저장하지 않습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={downloadingList}
          onClick={async () => {
            setError(null)
            setSummary(null)
            setDownloadingList(true)
            try {
              const maps = await getInvoiceProductNameMaps(brandId)
              await downloadInvoiceProductNameLedgerList(brandName, maps)
              setSummary(
                `DB에 저장된 품목명 원장 ${formatNumber(maps.length)}건을 내려받았습니다.`,
              )
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : '현재 원장을 내려받지 못했습니다.',
              )
            } finally {
              setDownloadingList(false)
            }
          }}
        >
          <Download className="size-3.5" />
          {downloadingList ? '목록 준비 중...' : '현재 원장 내려받기'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={downloading}
          onClick={async () => {
            setError(null)
            setDownloading(true)
            try {
              await downloadInvoiceProductNameLedgerTemplate(brandName)
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : '양식을 내려받지 못했습니다.',
              )
            } finally {
              setDownloading(false)
            }
          }}
        >
          <Download className="size-3.5" />
          {downloading ? '준비 중...' : '양식 내려받기'}
        </Button>
        <label className="inline-flex">
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm"
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
            {parsing ? '읽는 중...' : '엑셀 올리기'}
          </span>
        </label>
      </div>
      {formatLabel ? (
        <p className="text-xs text-muted-foreground">형식: {formatLabel}</p>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {summary ? <p className="text-sm text-success">{summary}</p> : null}

      {prepared ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              정상 {formatNumber(counts.ready)} · 충돌{' '}
              {formatNumber(counts.conflict)} · 미일치{' '}
              {formatNumber(counts.unmatched)} · 오류 {formatNumber(counts.error)}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={counts.ready === 0 || applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
            >
              {applyMutation.isPending ? '등록 중...' : '정상 건 등록'}
            </Button>
          </div>
          <div className="max-h-[24rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2 font-medium">행</th>
                  <th className="px-3 py-2 font-medium">원본 품목명·조회 키</th>
                  <th className="px-3 py-2 font-medium">매칭 방식</th>
                  <th className="px-3 py-2 font-medium">본품</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {prepared.slice(0, PREVIEW_LIMIT).map((row) => (
                  <tr key={row.lineNo} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{row.lineNo}</td>
                    <td className="max-w-48 truncate px-3 py-2">
                      {row.productName}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                      {row.lookupKey
                        ? '조회 키'
                        : `조합 · 내품명 ${row.itemNameContext || '없음'}`}
                    </td>
                    <td className="max-w-48 truncate px-3 py-2">
                      {row.mainStyle
                        ? `${row.mainStyle.styleNo} · ${row.mainStyle.name}`
                        : row.officialName || '-'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2',
                        row.status === 'conflict' || row.status === 'error'
                          ? 'text-danger'
                          : row.status === 'unmatched'
                            ? 'text-warning'
                            : 'text-muted-foreground',
                      )}
                    >
                      {row.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
