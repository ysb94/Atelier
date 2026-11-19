import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { listWarehouseActivity, type WarehouseActivity, type WarehouseActivityCursor, type WarehouseActivityRow } from '@/lib/supabase/warehouse-activity'

const SOURCES = { atelier: 'Atelier', finder: 'Finder', warehouse: '창고' } as const
const ACTIONS: Record<string, string> = {
  receive: '입고', create: '등록', move: '이동', adjust: '수정', update: '수정',
  deplete: '소진', box_outbound: '출고', open: '개봉', archive: '보관', audit: '자리 실사', review: 'QR 검수',
  replenish: '보충', label: '라벨 변경', presumed_deplete: '출고로 소진 추정',
}
const DATE = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' })

function itemName(row: WarehouseActivityRow) {
  return [row.sku, row.name].filter(Boolean).join(' · ')
}

function rowQuantity(row: WarehouseActivityRow) {
  if (row.quantity != null) return `${row.quantity}개`
  if (row.workedBoxes != null || row.workedUnits != null) {
    return [row.workedBoxes ? `작업 ${row.workedBoxes}박스` : '', row.workedUnits ? `${row.workedUnits}개` : ''].filter(Boolean).join(' · ')
  }
  return [
    row.boxes != null && row.boxes !== '' ? `${row.boxes}박스` : '',
    row.unitsPerBox ? `박스당 ${row.unitsPerBox}개` : '',
    row.opened && row.opened !== '0' ? `개봉 잔량 ${row.opened}개` : '',
  ].filter(Boolean).join(' · ')
}

function relatedRows(event: WarehouseActivity, qr?: string) {
  if (!qr) return { before: event.before_rows, after: event.after_rows }
  const target = qr.trim().toUpperCase()
  const keys = new Set([...event.before_rows, ...event.after_rows].filter(row => row.qr === target).map(row => row.id).filter(Boolean))
  const related = (row: WarehouseActivityRow) => row.qr === target || Boolean(row.id && keys.has(row.id))
  return { before: event.before_rows.filter(related), after: event.after_rows.filter(related) }
}

function ChangeRows({ rows, title }: { rows: WarehouseActivityRow[]; title: string }) {
  return <div className="min-w-0 rounded-md border border-border p-2.5">
    <h4 className="font-medium">{title}</h4>
    {!rows.length ? <p className="mt-1 text-muted-foreground">—</p> : <ul className="mt-1 divide-y divide-border">
      {rows.map((row, index) => <li key={`${row.id ?? row.qr ?? 'row'}:${index}`} className="break-words py-1.5">
        {[itemName(row), row.location, row.qr, rowQuantity(row), row.receivedOn && `입고일 ${row.receivedOn}`].filter(Boolean).join(' · ') || '—'}
        {row.note && <p className="whitespace-pre-wrap text-muted-foreground">{row.note}</p>}
      </li>)}
    </ul>}
  </div>
}

function ActivityItem({ event, qr }: { event: WarehouseActivity; qr?: string }) {
  const { before, after } = relatedRows(event, qr)
  const affected = after.length ? after : before
  const first = affected[0]
  const affectedKeys = new Set([...before, ...after].map(row => row.id || row.qr).filter(Boolean))
  const remaining = affectedKeys.size - 1
  return <li className="space-y-2 px-3 py-3 text-xs">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <time dateTime={event.created_at} className="tabular-nums text-muted-foreground">{DATE.format(new Date(event.created_at))}</time>
      <Badge variant="muted">{ACTIONS[event.action] ?? event.action}</Badge>
      <span>{SOURCES[event.source]}</span>
      <span className="font-medium">{event.actor_name ?? '처리자 기록 없음'}</span>
      {first && itemName(first) && <span>{itemName(first)}</span>}
      {remaining > 0 && <span className="text-muted-foreground">외 {remaining}행</span>}
      {(first?.location || event.place) && <span>{first?.location || event.place}</span>}
      {first?.qr && <span className="break-all text-muted-foreground">{first.qr}</span>}
    </div>
    {event.reason && <p className="break-words text-muted-foreground">{event.reason}</p>}
    {affected.length > 0 && <details>
      <summary className="cursor-pointer text-muted-foreground">변경 내용</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <ChangeRows rows={before} title="변경 전" />
        <ChangeRows rows={after} title="변경 후" />
      </div>
    </details>}
  </li>
}

export function WarehouseActivityPanel({ brandId, qr, legacy }: { brandId: string; qr?: string; legacy?: ReactNode }) {
  const active = useWorkspaceTabActivity()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [cursors, setCursors] = useState<(WarehouseActivityCursor | null)[]>([null])
  const cursor = cursors.at(-1) ?? null
  const page = cursors.length
  const query = useQuery({
    queryKey: ['warehouse-activity', brandId, qr ?? null, search, cursor],
    queryFn: () => listWarehouseActivity(brandId, qr ?? null, search, cursor),
    ...sharedReadPolicy,
    enabled: active,
    refetchInterval: readPollInterval(30_000, active && page === 1),
  })
  if (query.data?.supported === false && legacy) return <>{legacy}</>
  function submit(event: FormEvent) {
    event.preventDefault()
    setSearch(input.trim())
    setCursors([null])
  }
  return <section className="space-y-3" aria-label={qr ? 'QR별 작업 이력' : '창고 전체 이력'}>
    {!qr && <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
      <Input aria-label="창고 이력 검색" placeholder="M번호·상품명·자리·QR·처리자 검색" value={input} onChange={event => setInput(event.target.value)} maxLength={100} className="h-9 max-w-sm" />
      <Button type="submit" variant="outline" size="sm">검색</Button>
      <Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>새로고침</Button>
    </form>}
    {query.isError ? <p role="alert" className="text-sm text-danger">창고 이력을 불러오지 못했습니다. <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>다시 조회</Button></p>
      : query.isPending ? <p role="status" className="text-sm text-muted-foreground">창고 이력을 불러오는 중입니다.</p>
      : query.data?.supported === false ? <p className="text-sm text-muted-foreground">창고 이력 서버 연결 대기</p>
      : query.data?.rows.length ? <ol className="divide-y divide-border rounded-lg border border-border">{query.data.rows.map(event => <ActivityItem key={event.id} event={event} qr={qr} />)}</ol>
      : <p className="text-sm text-muted-foreground">조회할 작업 이력이 없습니다.</p>}
    {(page > 1 || query.data?.next) && <div className="flex items-center justify-end gap-2">
      <Button type="button" size="sm" variant="outline" disabled={page === 1 || query.isFetching} onClick={() => setCursors(value => value.slice(0, -1))}>이전</Button>
      <span className="text-xs tabular-nums">{page}쪽</span>
      <Button type="button" size="sm" variant="outline" disabled={!query.data?.next || query.isFetching} onClick={() => {
        const next = query.data?.next
        if (next) setCursors(value => [...value, next])
      }}>다음</Button>
    </div>}
  </section>
}
