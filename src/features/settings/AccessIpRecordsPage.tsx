import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { IP_REVIEW_LABEL, type IpReviewStatus } from '@/lib/company/access-ip'
import { ACCESS_IP_PAGE_SIZE, canReviewAccessIp, listAccessIpEvents, listOfficeIpReviews, saveOfficeIpReview, type AccessIpEvent, type OfficeIpReview } from '@/lib/supabase/access-ip'
import { koreaDateKey } from './my-attendance'

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+09:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return koreaDateKey(date)
}
function stamp(value: string) { return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) }
function reviewTone(status: IpReviewStatus) {
  return status === 'company' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : status === 'external' ? 'bg-slate-500/10 text-muted-foreground' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
}

export function AccessIpRecordsPage() {
  useRenderWatch('AccessIpRecordsPage')
  const { session } = useAuth()
  const userId = session?.user.id
  const permission = useQuery({ queryKey: ['access-ip-owner', userId], queryFn: canReviewAccessIp, enabled: Boolean(userId), retry: false })
  useEffect(() => { if (permission.error) console.warn('[access-ip] 조회 권한 확인 실패', permission.error) }, [permission.error])
  return <>
    <PageHeader title="접속·출근 IP 기록" description="로그인과 출근 요청을 관찰하는 본인 전용 화면입니다. IP에 따른 출근 차단은 하지 않습니다." />
    {permission.isPending ? <p role="status">조회 권한을 확인하고 있습니다.</p>
      : permission.error ? <div role="alert"><p>{permission.error.message}</p><Button onClick={() => void permission.refetch()}>다시 확인</Button></div>
      : !permission.data ? <p role="alert" className="text-sm text-muted-foreground">이 화면은 지정된 본인 계정에서만 볼 수 있습니다.</p>
      : <AccessIpRecordsContent key={userId} userId={userId!} />}
  </>
}

function AccessIpRecordsContent({ userId }: { userId: string }) {
  const today = koreaDateKey()
  const [from, setFrom] = useState(() => shiftDate(today, -6))
  const [to, setTo] = useState(today)
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<{ ip: string; status: IpReviewStatus; note: string } | null>(null)
  const [notice, setNotice] = useState('')
  const client = useQueryClient()
  const validRange = Boolean(from && to && from <= to)
  const events = useQuery({ queryKey: ['access-ip-events', userId, from, to, kind, page],
    queryFn: () => listAccessIpEvents(from, shiftDate(to, 1), kind, page), enabled: validRange })
  const rows = events.data ?? emptyList<AccessIpEvent>()
  const ips = useMemo(() => [...new Set(rows.map(row => row.ip_address).filter((ip): ip is string => Boolean(ip)))], [rows])
  const reviews = useQuery({ queryKey: ['office-ip-reviews', userId, ips], queryFn: () => listOfficeIpReviews(ips), enabled: Boolean(events.data) })
  const reviewRows = reviews.data ?? emptyList<OfficeIpReview>()
  const reviewIndex = useMemo(() => new Map(reviewRows.map(row => [row.ip_address, row])), [reviewRows])
  const save = useMutation({
    mutationFn: (value: NonNullable<typeof editing>) => saveOfficeIpReview(value.ip, value.status, value.note, userId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['office-ip-reviews', userId] })
      setEditing(null); setNotice('IP 확인 표시를 저장했습니다. 로그인·출근 허용 여부는 바뀌지 않습니다.')
    },
  })
  useEffect(() => { if (events.error) console.warn('[access-ip] 기록 조회 실패', events.error) }, [events.error])
  useEffect(() => { if (reviews.error) console.warn('[access-ip] 회사 IP 표시 조회 실패', reviews.error) }, [reviews.error])
  useEffect(() => { if (save.error) console.warn('[access-ip] 회사 IP 표시 저장 실패', save.error) }, [save.error])
  function filter(action: () => void) { action(); setPage(0); setEditing(null); setNotice('') }
  function submit(event: FormEvent) { event.preventDefault(); if (editing && !save.isPending) save.mutate(editing) }

  return <div className="space-y-4">
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
      <p>기록을 보고 회사에서 접속한 IP를 직접 확인해 주세요. 회사 확인 표시는 자동으로 붙지 않습니다.</p>
      <p>회사 IP도 바뀔 수 있으므로 확인 시각을 함께 보세요. 출근 요청 기록은 실제 출근 저장 성공을 뜻하지 않습니다.</p>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">시작일<Input aria-label="기록 시작일" type="date" value={from} onChange={e => filter(() => setFrom(e.target.value))} /></label>
      <label className="text-sm">종료일<Input aria-label="기록 종료일" type="date" value={to} onChange={e => filter(() => setTo(e.target.value))} /></label>
      <label className="text-sm">행동<Select aria-label="기록 행동" value={kind} onChange={e => filter(() => setKind(e.target.value))}>
        <option value="">전체</option><option value="login">로그인</option><option value="clock_in_request">출근 요청</option>
      </Select></label>
      <Button variant="outline" onClick={() => { void events.refetch(); void reviews.refetch() }} disabled={!validRange || events.isFetching}>새로고침</Button>
    </div>
    {!validRange && <p role="alert">시작일과 종료일을 확인해 주세요.</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {editing && <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label="IP 확인 표시 편집">
      <p className="break-all text-sm font-medium">{editing.ip} · 확인 표시</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">확인 상태<Select aria-label="IP 확인 상태" value={editing.status} disabled={save.isPending} onChange={e => setEditing({ ...editing, status: e.target.value as IpReviewStatus })}>
          {Object.entries(IP_REVIEW_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select></label>
        <label className="min-w-48 flex-1 text-sm">메모<Input aria-label="IP 확인 메모" maxLength={200} placeholder="예: 본사 사무실 Wi-Fi에서 직접 확인" value={editing.note} disabled={save.isPending} onChange={e => setEditing({ ...editing, note: e.target.value })} /></label>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? '저장 중…' : '확인 표시 저장'}</Button>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={() => setEditing(null)}>취소</Button>
      </div>
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    </form>}
    {events.error ? <p role="alert">{events.error.message}</p>
      : events.isPending && validRange ? <p role="status">IP 기록을 불러오고 있습니다.</p>
      : validRange && <>
        {reviews.error && <p role="alert">{reviews.error.message} 표시를 확인할 수 없어 편집을 잠시 막았습니다.</p>}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/50"><tr>{['이름 · 시간', '행동', '공인 IP', '확인 상태', '메모 · 확인 시각', '관리'].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
            <tbody>{rows.slice(0, ACCESS_IP_PAGE_SIZE).map(row => {
              const review = row.ip_address ? reviewIndex.get(row.ip_address) : undefined
              const status = review?.status ?? 'unconfirmed'
              return <tr key={row.id} className="border-t border-border align-top">
                <td className="px-3 py-3"><p className="font-medium">{row.person_name}</p><p className="whitespace-nowrap text-xs text-muted-foreground">{stamp(row.created_at)}</p></td>
                <td className="whitespace-nowrap px-3 py-3">{row.event_kind === 'login' ? '로그인' : '출근 요청'}</td>
                <td className="break-all px-3 py-3 font-mono text-xs">{row.ip_address ?? '주소 수집 불가'}</td>
                <td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs ${reviewTone(status)}`}>{reviews.error ? '조회 실패' : reviews.isPending ? '확인 중…' : IP_REVIEW_LABEL[status]}</span></td>
                <td className="max-w-64 break-words px-3 py-3"><p>{review?.note || '—'}</p>{review && <p className="text-xs text-muted-foreground">{stamp(review.reviewed_at)}</p>}</td>
                <td className="px-3 py-2"><Button variant="outline" size="sm" disabled={!row.ip_address || reviews.isPending || Boolean(reviews.error) || save.isPending} onClick={() => { save.reset(); setNotice(''); setEditing({ ip: row.ip_address!, status, note: review?.note ?? '' }) }}>확인 표시</Button></td>
              </tr>
            })}</tbody>
          </table>
          {!rows.length && <p className="p-6 text-center text-sm text-muted-foreground">선택한 기간에 수집된 기록이 없습니다. 기능 적용 이후의 기록부터 표시합니다.</p>}
        </div>
        <div className="flex items-center justify-end gap-3 text-sm">
          <Button variant="outline" disabled={page === 0 || events.isFetching} onClick={() => { setEditing(null); setPage(page - 1) }}>이전</Button>
          <span>{page + 1}페이지</span>
          <Button variant="outline" disabled={rows.length <= ACCESS_IP_PAGE_SIZE || events.isFetching} onClick={() => { setEditing(null); setPage(page + 1) }}>다음</Button>
        </div>
      </>}
  </div>
}
