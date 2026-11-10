import { useMemo, useState } from 'react'
import { Download, Printer, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, formatNumber } from '@/lib/utils'
import { buildOutboundRackCodes, MAX_OUTBOUND_QR_RACKS } from '@/lib/warehouse/outbound-qr'
import { OutboundWarehouseQrPanel } from './OutboundWarehouseQrPanel'
import { OutboundRackPrintPreview } from './OutboundRackPrintPreview'
import { BoxIndividualLabelPanel } from './BoxIndividualLabelPanel'

const MAX_QR_ROWS = MAX_OUTBOUND_QR_RACKS

type QrTarget = 'box' | 'outbound' | 'individual-box'
type QrMode = 'range' | 'list'

const TARGET_COPY: Record<QrTarget, { label: string; hint: string }> = {
  box: { label: '박스창고', hint: '자리번호 4칸 라벨 인쇄 / 엑셀' },
  outbound: { label: '출고창고', hint: '렉·고정 자리 라벨 인쇄 / 엑셀' },
  'individual-box': { label: '박스 개별 라벨링', hint: '60×40mm 롤 라벨 인쇄' },
}

function QrTargetSelector({ target, onChange }: { target: QrTarget; onChange: (target: QrTarget) => void }) {
  return <div><p className="text-xs font-medium text-muted-foreground">대상</p><div className="mt-2 grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-3">
    {(Object.keys(TARGET_COPY) as QrTarget[]).map((value) => <button key={value} type="button" aria-pressed={target === value} onClick={() => onChange(value)} className={cn('rounded-md border px-3 py-2 text-left transition-colors', target === value ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/40')}><p className="text-sm font-medium">{TARGET_COPY[value].label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{TARGET_COPY[value].hint}</p></button>)}
  </div></div>
}

function normalizeLocationCode(raw: string) {
  return raw.trim().replace(/\s+/g, '').replace(/\/+$/, '')
}

function parseListCodes(text: string) {
  const seen = new Set<string>()
  const codes: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const code = normalizeLocationCode(line)
    if (!code || seen.has(code)) continue
    seen.add(code)
    codes.push(code)
    if (codes.length > MAX_QR_ROWS) break
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

export function WarehouseQrPanel({ brandName, brandId }: { brandName: string; brandId: string }) {
  useRenderWatch('WarehouseQrPanel')
  const [target, setTarget] = useState<QrTarget>('outbound')
  const [mode, setMode] = useState<QrMode>('range')
  const [warehouse, setWarehouse] = useState('2')
  const [row, setRow] = useState('1')
  const [startNo, setStartNo] = useState('1')
  const [endNo, setEndNo] = useState('12')
  const [listText, setListText] = useState('2-1-1\n2-1-2\n2-1-3')
  const [status, setStatus] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [previewLabels, setPreviewLabels] = useState<{ labels: string[]; images: ReadonlyMap<string, string> } | null>(null)
  const [preparing, setPreparing] = useState(false)

  const result = useMemo(() => {
    if (mode === 'range') {
      const range = buildOutboundRackCodes({ mode, warehouse, row, startRack: startNo, endRack: endNo, list: '' })
      return { codes: range.racks, error: range.error }
    }
    const listed = parseListCodes(listText)
    if (listed.length > MAX_QR_ROWS) return { codes: [], error: `한 번에 자리 ${MAX_QR_ROWS}개까지 만들 수 있습니다. 범위를 나눠 주세요.` }
    return { codes: listed, error: listed.length ? null : '자리번호를 한 줄에 하나씩 입력해 주세요.' }
  }, [endNo, listText, mode, row, startNo, warehouse])
  const codes = result.codes
  const targetMeta = TARGET_COPY[target]

  async function previewBoxLabels() {
    if (!codes.length || preparing) return
    const labels = [...codes]
    setPreparing(true); setStatus(null)
    const started = performance.now()
    try {
      const QRCode = (await import('qrcode')).default
      const images = new Map<string, string>()
      for (const [index, code] of labels.entries()) {
        const svg = await QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 })
        images.set(code, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))
        if (index % 8 === 7) await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
      setPreviewLabels({ labels, images })
    } catch (error) {
      console.warn('[warehouse-qr] 박스창고 QR 라벨 준비 실패', { path: location.pathname, error })
      setStatus('QR 라벨을 준비하지 못했습니다. 자리번호를 확인하고 다시 시도해 주세요.')
    } finally {
      setPreparing(false)
      const elapsed = performance.now() - started
      if (elapsed >= 200) console.info('[warehouse-qr] 박스창고 QR 라벨 준비', { path: location.pathname, count: labels.length, elapsed })
    }
  }

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

  if (target === 'outbound') return <div className="space-y-4"><QrTargetSelector target={target} onChange={setTarget} /><OutboundWarehouseQrPanel brandName={brandName} /></div>
  if (target === 'individual-box') return (
    <div className="space-y-4">
      <QrTargetSelector target={target} onChange={setTarget} />
      <BoxIndividualLabelPanel key={brandId} brandId={brandId} />
    </div>
  )

  return (
    <div className="space-y-4">
      <QrTargetSelector target={target} onChange={setTarget} />
      <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <Card>
        <CardContent className="space-y-4 p-4">
          <div><h3 className="text-sm font-semibold">렉 범위 선택</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">창고 → 줄 → 렉 순서입니다.<br />3-1-1 = 3번 창고 · 1번째 줄 · 1번째 렉</p></div>
          <FilterTabs ariaLabel="박스창고 자리번호 입력 방법" value={mode} onChange={setMode} tabs={[{ value: 'range', label: '렉 범위' }, { value: 'list', label: '렉 직접 입력' }]} />

          {mode === 'range' ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">창고 번호</span>
                <Input
                  aria-label="창고 번호"
                  inputMode="numeric"
                  value={warehouse}
                  onChange={(event) => setWarehouse(event.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">줄 번호</span>
                <Input
                  aria-label="줄 번호"
                  inputMode="numeric"
                  value={row}
                  onChange={(event) => setRow(event.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">시작 렉 번호</span>
                <Input
                  aria-label="시작 렉 번호"
                  inputMode="numeric"
                  value={startNo}
                  onChange={(event) => setStartNo(event.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">끝 렉 번호</span>
                <Input
                  aria-label="끝 렉 번호"
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
                aria-label="박스창고 자리번호 목록"
                rows={7}
                value={listText}
                placeholder={'2-1-1\n2-1-2\n6-1-10'}
                onChange={(event) => setListText(event.target.value)}
              />
              <span className="text-xs text-muted-foreground">다른 형식의 자리번호도 입력할 수 있습니다. 중복 자리번호는 한 번만 사용합니다.</span>
            </label>
          )}
          {result.error && <p role="alert" className="text-xs text-danger">{result.error}</p>}
          <p className="text-xs text-muted-foreground">한 번에 자리 {MAX_QR_ROWS}개까지 선택할 수 있습니다.</p>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-7">
            <p>자리번호 <strong className="tabular-nums text-foreground">{formatNumber(codes.length)}개</strong></p>
            <p>자리당 <strong>라벨 1개</strong></p>
            <p>A4 4칸 라벨 <strong className="tabular-nums text-foreground">{formatNumber(Math.ceil(codes.length / 4))}장</strong></p>
          </div>
        </CardContent>
        </Card>

        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div><h3 className="text-base font-semibold">박스창고 자리번호 · A4 4칸 라벨</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">위쪽 좌우에 같은 자리번호의 QR 두 개, 가운데 위쪽 화살표, 아래에 큰 자리번호를 표시합니다. A4 가로를 2열 × 2행으로 나눕니다.</p></div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">{brandName}</Badge>
              <Badge variant="outline">{targetMeta.label}</Badge>
              <Badge variant={codes.length > 0 ? 'success' : 'muted'}>
                {formatNumber(codes.length)}개 자리 · A4 {Math.ceil(codes.length / 4)}장
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={codes.length === 0 || downloading || preparing} onClick={() => void previewBoxLabels()}><Printer className="size-3.5" />{preparing ? 'QR 준비 중…' : '4칸 라벨 미리보기'}</Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={codes.length === 0 || downloading || preparing}
              onClick={() => void handleDownload()}
            >
              <Download className="size-3.5" />
              {downloading ? '준비 중...' : '엑셀 내려받기'}
            </Button>
            </div>
          </div>

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
                <thead className="bg-primary text-xs text-primary-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">자리</th>
                    <th className="px-3 py-2 font-medium">인쇄 위치</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code, index) => (
                    <tr key={code} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{code}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{Math.floor(index / 4) + 1}장 · {['왼쪽 위', '오른쪽 위', '왼쪽 아래', '오른쪽 아래'][index % 4]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">인쇄 설정: A4 가로 · 배율 100% · 여백 없음 · 머리글/바닥글 끄기. 마지막 장의 남는 칸은 비워 둡니다.</p>
        </div>
      </div>
      {previewLabels && <OutboundRackPrintPreview labels={previewLabels.labels} boxImages={previewLabels.images} labelKind="box" onClose={() => setPreviewLabels(null)} />}
    </div>
  )
}
