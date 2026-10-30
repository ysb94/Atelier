import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { buildOutboundRackCodes, MAX_OUTBOUND_QR_RACKS, OUTBOUND_SLOT_COLUMNS, OUTBOUND_SLOT_LEVELS, OUTBOUND_SLOTS_PER_RACK, outboundSlotCodes } from '@/lib/warehouse/outbound-qr'
import { formatNumber } from '@/lib/utils'

const VISUAL_LEVELS = [...OUTBOUND_SLOT_LEVELS].reverse()

export function OutboundSlotGenerator({ onAdd, disabled }: { onAdd: (codes: readonly string[]) => void; disabled: boolean }) {
  useRenderWatch('OutboundSlotGenerator')
  const [mode, setMode] = useState<'range' | 'list'>('range')
  const [warehouse, setWarehouse] = useState('3')
  const [row, setRow] = useState('1')
  const [startRack, setStartRack] = useState('1')
  const [endRack, setEndRack] = useState('7')
  const [list, setList] = useState('')
  const [focusedRack, setFocusedRack] = useState('')
  const result = useMemo(() => buildOutboundRackCodes({ mode, warehouse, row, startRack, endRack, list }), [mode, warehouse, row, startRack, endRack, list])
  const slots = useMemo(() => result.racks.flatMap(outboundSlotCodes), [result.racks])
  const selectedRack = result.racks.includes(focusedRack) ? focusedRack : result.racks[0] ?? ''

  return <div className="space-y-4 rounded-lg border border-border bg-muted/10 p-4">
    <div><h3 className="text-sm font-semibold">렉별 고정 자리 생성</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">QR 생성과 같은 번호를 사용합니다.<br />3-1-1 = 3번 창고 · 1번째 줄 · 1번째 렉</p></div>
    <FilterTabs ariaLabel="출고창고 렉 입력 방법" value={mode} onChange={setMode} tabs={[{ value: 'range', label: '렉 범위' }, { value: 'list', label: '렉 직접 입력' }]} />
    {mode === 'range' ? <div className="grid grid-cols-2 gap-3">
      <label className="space-y-1"><span className="text-xs text-muted-foreground">창고 번호</span><Input aria-label="창고 번호" inputMode="numeric" value={warehouse} onChange={(event) => setWarehouse(event.target.value)} /></label>
      <label className="space-y-1"><span className="text-xs text-muted-foreground">줄 번호</span><Input aria-label="줄 번호" inputMode="numeric" value={row} onChange={(event) => setRow(event.target.value)} /></label>
      <label className="space-y-1"><span className="text-xs text-muted-foreground">시작 렉 번호</span><Input aria-label="시작 렉 번호" inputMode="numeric" value={startRack} onChange={(event) => setStartRack(event.target.value)} /></label>
      <label className="space-y-1"><span className="text-xs text-muted-foreground">끝 렉 번호</span><Input aria-label="끝 렉 번호" inputMode="numeric" value={endRack} onChange={(event) => setEndRack(event.target.value)} /></label>
    </div> : <label className="block space-y-1"><span className="text-xs text-muted-foreground">렉 번호 · 한 줄에 하나</span><Textarea aria-label="렉 번호 목록" rows={6} value={list} onChange={(event) => setList(event.target.value)} placeholder={'3-1-1\n3-1-2\n3-2-1'} /><span className="text-xs text-muted-foreground">렉 번호만 입력하면 A1~D4가 붙습니다. 같은 렉은 한 번만 추가합니다.</span></label>}
    {result.error && <p role="alert" className="text-xs text-danger">{result.error}</p>}
    <p className="text-xs leading-relaxed text-muted-foreground">렉 {formatNumber(result.racks.length)}개 × {OUTBOUND_SLOTS_PER_RACK}자리 = <strong className="text-foreground">{formatNumber(slots.length)}자리</strong><br />한 번에 렉 {MAX_OUTBOUND_QR_RACKS}개까지 생성할 수 있습니다.</p>
    {selectedRack && <div className="space-y-2">
      <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">미리 볼 렉<Select aria-label="미리 볼 렉" value={selectedRack} onChange={(event) => setFocusedRack(event.target.value)}>{result.racks.map((rack) => <option key={rack}>{rack}</option>)}</Select></label>
      <div role="table" aria-label="고정 자리 16칸 미리보기" className="overflow-hidden rounded-lg border border-border bg-card">
        {VISUAL_LEVELS.map((level) => <div role="row" key={level} className="grid grid-cols-4 border-b border-border last:border-b-0">{OUTBOUND_SLOT_COLUMNS.map((column) => <div role="cell" className="border-r border-border px-1 py-2 text-center text-xs font-semibold last:border-r-0" key={column}>{level}{column}</div>)}</div>)}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">정면 기준 A가 맨 아래 1층, 숫자는 왼쪽부터 1~4입니다.<br />{selectedRack}_A1 ~ {selectedRack}_D4</p>
    </div>}
    <Button size="sm" className="w-full" disabled={disabled || !slots.length} onClick={() => onAdd(slots)}><Plus className="size-3.5" />{slots.length ? `${formatNumber(slots.length)}개 자리 목록에 추가` : '자리 목록에 추가'}</Button>
    <p className="text-xs leading-relaxed text-muted-foreground">추가 후 오른쪽 ‘자리 저장’을 눌러 등록합니다. 이미 있는 자리는 중복 추가하지 않습니다.</p>
  </div>
}
