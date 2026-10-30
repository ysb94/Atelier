import { useMemo, useState } from 'react'
import { Download, Printer, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { formatNumber } from '@/lib/utils'
import { buildOutboundRackCodes, MAX_OUTBOUND_QR_RACKS, OUTBOUND_SLOT_COLUMNS, OUTBOUND_SLOT_LEVELS, OUTBOUND_SLOTS_PER_RACK, outboundSlotCodes, outboundSlotExcelRows } from '@/lib/warehouse/outbound-qr'
import { OutboundRackPrintPreview } from './OutboundRackPrintPreview'

const VISUAL_LEVELS = [...OUTBOUND_SLOT_LEVELS].reverse()

export function OutboundWarehouseQrPanel({ brandName }: { brandName: string }) {
  useRenderWatch('OutboundWarehouseQrPanel')
  const [output, setOutput] = useState<'rack' | 'slot'>('rack')
  const [mode, setMode] = useState<'range' | 'list'>('range')
  const [warehouse, setWarehouse] = useState('3')
  const [row, setRow] = useState('1')
  const [startRack, setStartRack] = useState('1')
  const [endRack, setEndRack] = useState('7')
  const [list, setList] = useState('3-1-1\n3-1-2\n3-1-3')
  const [focusedRack, setFocusedRack] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<{ labels: string[]; slotImages?: ReadonlyMap<string, string> } | null>(null)
  const result = useMemo(() => buildOutboundRackCodes({ mode, warehouse, row, startRack, endRack, list }), [mode, warehouse, row, startRack, endRack, list])
  const { racks } = result
  const selectedRack = racks.includes(focusedRack) ? focusedRack : racks[0] ?? ''
  const slotCount = racks.length * OUTBOUND_SLOTS_PER_RACK

  function previewLabels() {
    if (!racks.length || busy) return
    setStatus('')
    setPreview({ labels: [...racks] })
  }

  async function previewSlots() {
    if (!racks.length || busy) return
    setBusy(true); setStatus('')
    const started = performance.now()
    try {
      const QRCode = (await import('qrcode')).default
      const labels = racks.flatMap(outboundSlotCodes)
      const slotImages = new Map<string, string>()
      for (const [index, code] of labels.entries()) {
        const svg = await QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
        slotImages.set(code, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))
        // Let input and preparation feedback paint during long batches.
        if (index % 8 === 7) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      setPreview({ labels, slotImages })
    } catch (error) {
      console.warn('[warehouse-qr] 고정 자리 QR 준비 실패', { path: location.pathname, error })
      setStatus('고정 자리 QR을 준비하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      const elapsedMs = performance.now() - started
      if (elapsedMs >= 200) console[elapsedMs >= 1000 ? 'warn' : 'info']('[warehouse-qr] 고정 자리 QR 준비', { path: location.pathname, elapsedMs, slots: slotCount })
      setBusy(false)
    }
  }

  async function downloadSlots() {
    if (!racks.length || busy) return
    setBusy(true); setStatus('')
    try {
      const XLSX = await import('xlsx')
      const sheet = XLSX.utils.aoa_to_sheet(outboundSlotExcelRows(racks))
      sheet['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }]
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, 'QR')
      const date = new Date()
      const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('')
      const brand = brandName.replace(/[\\/:*?"<>|]+/g, '').trim() || '창고'
      XLSX.writeFile(workbook, brand + '_출고창고_고정자리_' + stamp + '.xlsx')
      setStatus(formatNumber(slotCount) + '개 자리의 엑셀을 내려받았습니다. 아이라벨에서 ‘QR’은 QR 바코드에, ‘렉자리’와 ‘렉박스자리’는 각각 글자에 연결해 주세요.')
    } catch (error) {
      console.warn('[warehouse-qr] 고정 자리 엑셀 실패', { path: location.pathname, error })
      setStatus('자리 엑셀을 내려받지 못했습니다. 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  return <div className="space-y-4">
    <FilterTabs ariaLabel="출고창고 QR 종류" value={output} onChange={(value) => { setOutput(value); setStatus('') }} tabs={[
      { value: 'rack', label: '렉 번호 · 4칸 라벨 인쇄', count: racks.length },
      { value: 'slot', label: '렉 안 고정 자리 · 라벨 인쇄 / 엑셀', count: slotCount },
    ]} />
    <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div><h3 className="text-sm font-semibold">렉 범위 선택</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">창고 → 줄 → 렉 순서입니다.<br />3-1-1 = 3번 창고 · 1번째 줄 · 1번째 렉</p></div>
          <FilterTabs ariaLabel="렉 번호 입력 방법" value={mode} onChange={setMode} tabs={[{ value: 'range', label: '렉 범위' }, { value: 'list', label: '렉 직접 입력' }]} />
          {mode === 'range' ? <>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="text-xs text-muted-foreground">창고 번호</span><Input aria-label="창고 번호" inputMode="numeric" value={warehouse} onChange={(event) => setWarehouse(event.target.value)} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">줄 번호</span><Input aria-label="줄 번호" inputMode="numeric" value={row} onChange={(event) => setRow(event.target.value)} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">시작 렉 번호</span><Input aria-label="시작 렉 번호" inputMode="numeric" value={startRack} onChange={(event) => setStartRack(event.target.value)} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">끝 렉 번호</span><Input aria-label="끝 렉 번호" inputMode="numeric" value={endRack} onChange={(event) => setEndRack(event.target.value)} /></label>
            </div>
          </> : <label className="block space-y-1"><span className="text-xs text-muted-foreground">렉 번호 · 한 줄에 하나</span><Textarea aria-label="렉 번호 목록" rows={7} value={list} onChange={(event) => setList(event.target.value)} placeholder={'3-1-1\n3-1-2\n3-2-1'} /><span className="text-xs text-muted-foreground">A1 같은 자리 표시는 자동으로 붙입니다. 중복 렉 번호는 한 번만 사용합니다.</span></label>}
          {result.error && <p role="alert" className="text-xs text-danger">{result.error}</p>}
          <p className="text-xs text-muted-foreground">한 번에 렉 {MAX_OUTBOUND_QR_RACKS}개까지 선택할 수 있습니다.</p>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-7">
            <p>렉 번호 <strong className="tabular-nums text-foreground">{formatNumber(racks.length)}개</strong></p>
            <p>렉당 <strong>4층 × 4칸 = 16자리</strong></p>
            <p>고정 자리 <strong className="tabular-nums text-foreground">{formatNumber(slotCount)}개</strong></p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="mb-2 flex flex-wrap gap-2"><Badge variant="muted">{brandName}</Badge><Badge variant="outline">출고창고</Badge></div><h3 className="text-base font-semibold">{output === 'rack' ? '렉 번호 라벨' : '렉 안의 고정 자리 번호'}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{output === 'rack' ? '3-1-1처럼 렉 하나를 표시합니다. A4를 2열 × 2행으로 나눠 한 장에 4개씩 인쇄합니다.' : '박스 자체 번호가 아닌, 렉에 붙여 두는 고정 자리입니다. A는 맨 아래 1층, 숫자는 정면에서 왼쪽부터입니다.'}</p></div>
            {output === 'rack' ? <Button size="sm" disabled={!racks.length || busy} onClick={previewLabels}><Printer className="size-3.5" />4칸 라벨 미리보기</Button> : <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!racks.length || busy} onClick={() => void previewSlots()}><Printer className="size-3.5" />{busy ? '준비 중…' : '고정 자리 4칸 라벨 미리보기'}</Button><Button size="sm" variant="outline" disabled={!racks.length || busy} onClick={() => void downloadSlots()}><Download className="size-3.5" />아이라벨용 엑셀 내려받기</Button></div>}
          </div>
          {!racks.length ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center"><Table2 className="size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">왼쪽에서 올바른 렉 번호를 입력해 주세요.</p></div> : output === 'rack' ? <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="success">{formatNumber(racks.length)}개 렉</Badge><span>A4 {Math.ceil(racks.length / 4)}장 · 한 장당 4칸</span><span>마지막 장의 남는 칸은 비워 둡니다.</span></div>
            <div className="max-h-[26rem] overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-primary text-primary-foreground"><tr><th className="px-3 py-2 font-medium">렉 번호</th><th className="px-3 py-2 font-medium">인쇄 위치</th></tr></thead><tbody>{racks.map((rack, index) => <tr key={rack} className="border-t border-border hover:bg-muted/30"><td className="px-3 py-2 font-semibold tabular-nums">{rack}</td><td className="px-3 py-2 text-xs text-muted-foreground">{Math.floor(index / 4) + 1}장 · {['왼쪽 위', '오른쪽 위', '왼쪽 아래', '오른쪽 아래'][index % 4]}</td></tr>)}</tbody></table>
            </div>
            <p className="text-xs text-muted-foreground">인쇄 설정은 A4 세로 · 배율 100% · 여백 없음 · 머리글/바닥글 끄기로 맞춰 주세요.</p>
          </> : <>
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">직접 인쇄: A4 가로 · 2열 × 2행. 왼쪽 상단에 QR, 오른쪽 위에 렉자리, 그 아래에 큰 렉박스자리를 표시합니다. 총 {Math.ceil(slotCount / 4)}장입니다.</p>
            <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="success">{formatNumber(slotCount)}개 자리 · 렉당 16개</Badge><label className="flex items-center gap-2 text-xs text-muted-foreground">미리 볼 렉<Select aria-label="미리 볼 렉" value={selectedRack} onChange={(event) => setFocusedRack(event.target.value)}>{racks.map((rack) => <option key={rack}>{rack}</option>)}</Select></label></div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table aria-label="렉 안 고정 자리 배치" className="w-full min-w-[30rem] text-center text-xs"><thead className="bg-primary text-primary-foreground"><tr><th className="px-2 py-2 font-medium">층</th>{OUTBOUND_SLOT_COLUMNS.map((column) => <th className="px-2 py-2 font-medium" key={column}>{column}칸{column === 1 ? ' · 왼쪽' : column === 4 ? ' · 오른쪽' : ''}</th>)}</tr></thead><tbody>{VISUAL_LEVELS.map((level) => <tr key={level} className="border-t border-border hover:bg-muted/20"><th className="px-2 py-3 font-medium">{OUTBOUND_SLOT_LEVELS.indexOf(level) + 1}층 · {level}</th>{OUTBOUND_SLOT_COLUMNS.map((column) => <td className="border-l border-border px-2 py-4" key={column}><span className="block font-semibold text-primary">{level}{column}</span><span className="mt-1 block whitespace-nowrap text-muted-foreground">{selectedRack}_{level}{column}</span></td>)}</tr>)}</tbody></table>
            </div>
            <p className="text-xs text-muted-foreground">위 그림은 렉 정면입니다. 엑셀은 렉별 A1~A4 → B1~B4 → C1~C4 → D1~D4 순서로 저장됩니다.</p>
            <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-medium">아이라벨에서 출력하는 방법</summary><ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-relaxed text-muted-foreground"><li>내려받은 엑셀의 ‘QR’ 시트를 아이라벨에서 불러옵니다.</li><li>‘QR’ 열을 QR 바코드에 연결합니다.</li><li>‘렉자리’와 ‘렉박스자리’ 열을 각각 글자에 연결합니다.</li><li>아이라벨에서 사용할 용지를 선택하고 인쇄합니다.</li></ol><p className="mt-2 text-xs text-muted-foreground">예: QR = 3-1-1_A1 · 렉자리 = 3-1-1 · 렉박스자리 = A1. QR 그림은 아이라벨에서 만듭니다.</p></details>
          </>}
          {status && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{status}</p>}
        </CardContent>
      </Card>
    </div>
    {preview && <OutboundRackPrintPreview labels={preview.labels} slotImages={preview.slotImages} onClose={() => setPreview(null)} />}
  </div>
}
