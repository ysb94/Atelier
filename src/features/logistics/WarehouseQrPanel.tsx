import { useMemo, useState } from 'react'
import { Download, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, formatNumber } from '@/lib/utils'

const MAX_QR_ROWS = 200

type QrTarget = 'box' | 'outbound'
type QrMode = 'range' | 'list'

const TARGET_COPY: Record<QrTarget, { label: string; hint: string }> = {
  box: { label: '박스창고', hint: '박스 단위 보관 자리' },
  outbound: { label: '출고창고', hint: '피킹용 낱개 자리' },
}

function normalizeLocationCode(raw: string) {
  return raw.trim().replace(/\s+/g, '').replace(/\/+$/, '')
}

function buildRangeCodes(prefix: string, startText: string, endText: string) {
  const base = prefix.trim().replace(/-+$/, '')
  const start = Number(startText)
  const end = Number(endText)
  if (!base || !Number.isInteger(start) || !Number.isInteger(end)) return []
  if (start < 1 || end < start) return []
  const count = end - start + 1
  if (count > MAX_QR_ROWS) return []
  return Array.from({ length: count }, (_, index) => `${base}-${start + index}`)
}

function parseListCodes(text: string) {
  const seen = new Set<string>()
  const codes: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const code = normalizeLocationCode(line)
    if (!code || seen.has(code)) continue
    seen.add(code)
    codes.push(code)
    if (codes.length >= MAX_QR_ROWS) break
  }
  return codes
}

function fileStamp() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${String(now.getFullYear()).slice(2)}${month}${day}`
}

function safeFilePart(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '').trim() || '창고'
}

export function WarehouseQrPanel({ brandName }: { brandName: string }) {
  useRenderWatch('WarehouseQrPanel')
  const [target, setTarget] = useState<QrTarget>('outbound')
  const [mode, setMode] = useState<QrMode>('range')
  const [prefix, setPrefix] = useState('2-1')
  const [startNo, setStartNo] = useState('1')
  const [endNo, setEndNo] = useState('12')
  const [listText, setListText] = useState('2-1-1\n2-1-2\n2-1-3')
  const [status, setStatus] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const codes = useMemo(
    () =>
      mode === 'range'
        ? buildRangeCodes(prefix, startNo, endNo)
        : parseListCodes(listText),
    [endNo, listText, mode, prefix, startNo],
  )
  const targetMeta = TARGET_COPY[target]
  const rangeCount = Number(endNo) - Number(startNo) + 1
  const rangeTooBig =
    mode === 'range' && Number.isFinite(rangeCount) && rangeCount > MAX_QR_ROWS

  async function handleDownload() {
    if (codes.length === 0) {
      setStatus('내려받을 자리가 없습니다.')
      return
    }
    setDownloading(true)
    setStatus(null)
    try {
      const XLSX = await import('xlsx')
      const sheet = XLSX.utils.aoa_to_sheet([
        ['자리', 'QR'],
        ...codes.map((code) => [code, code]),
      ])
      sheet['!cols'] = [{ wch: 16 }, { wch: 16 }]
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, 'QR')
      XLSX.writeFile(
        workbook,
        `${safeFilePart(brandName)}_${targetMeta.label}_QR자리_${fileStamp()}.xlsx`,
      )
    } catch (error) {
      console.warn('[warehouse-qr] 엑셀 내려받기 실패', { error })
      setStatus(
        error instanceof Error
          ? error.message
          : '엑셀을 내려받지 못했습니다.',
      )
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">대상</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.keys(TARGET_COPY) as QrTarget[]).map((value) => {
                const selected = value === target
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setTarget(value)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-card hover:bg-muted/40',
                    )}
                  >
                    <p className="text-sm font-medium">
                      {TARGET_COPY[value].label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {TARGET_COPY[value].hint}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">만드는 방법</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'range' ? 'default' : 'outline'}
                onClick={() => setMode('range')}
              >
                자리 범위
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'list' ? 'default' : 'outline'}
                onClick={() => setMode('list')}
              >
                직접 입력
              </Button>
            </div>
          </div>

          {mode === 'range' ? (
            <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr] gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">앞자리</span>
                <Input
                  value={prefix}
                  placeholder="2-1"
                  onChange={(event) => setPrefix(event.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">시작</span>
                <Input
                  inputMode="numeric"
                  value={startNo}
                  onChange={(event) => setStartNo(event.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">끝</span>
                <Input
                  inputMode="numeric"
                  value={endNo}
                  onChange={(event) => setEndNo(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                자리번호 · 한 줄에 하나
              </span>
              <Textarea
                rows={8}
                value={listText}
                placeholder={'2-1-1\n2-1-2\n6-1-10'}
                onChange={(event) => setListText(event.target.value)}
              />
            </label>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">{brandName}</Badge>
              <Badge variant="outline">{targetMeta.label}</Badge>
              <Badge variant={codes.length > 0 ? 'success' : 'muted'}>
                {formatNumber(codes.length)}행
              </Badge>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={codes.length === 0 || downloading}
              onClick={() => void handleDownload()}
            >
              <Download className="size-3.5" />
              {downloading ? '준비 중...' : '엑셀 내려받기'}
            </Button>
          </div>

          {rangeTooBig ? (
            <p className="text-xs text-danger">
              한 번에 {formatNumber(MAX_QR_ROWS)}행까지 만들 수 있습니다.
            </p>
          ) : null}
          {status ? (
            <p className="text-xs text-muted-foreground" role="status">
              {status}
            </p>
          ) : null}

          {codes.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <Table2 className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                왼쪽에서 자리 범위를 넣으면 표가 나옵니다.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[16rem] text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">자리</th>
                    <th className="px-3 py-2 font-medium">QR</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr key={code} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{code}</td>
                      <td className="px-3 py-2">{code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
