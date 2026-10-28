import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusPill } from '@/components/ui/status-pill'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { useRenderWatch } from '@/lib/diagnostics'
import { downloadSampleReceipt, LEAVE_SAMPLE_LABELS, LEAVE_SAMPLE_PHASES, sampleTimestamp, type LeaveAlarmSample, type LeaveSamplePhase } from './leave-alarm-sample'
import { useLeaveAlarmSample } from './use-leave-alarm-sample'

function StatusTime({ value, done, pending }: { value: string | null; done: string; pending: string }) {
  return <div className="space-y-1"><StatusPill tone={value ? 'success' : 'warning'}>{value ? done : pending}</StatusPill>{value && <p className="whitespace-nowrap text-xs text-muted-foreground">{sampleTimestamp(value)}</p>}</div>
}
function SampleAlarmCell({ phase, record, onOpen }: { phase: LeaveSamplePhase; record: LeaveAlarmSample | undefined; onOpen: (id: string) => void }) {
  if (!record) return <td className="px-4 py-3"><StatusPill tone="muted">미발송</StatusPill></td>
  return <td className="px-4 py-3 align-top">
    <p className="mb-1 text-xs tabular-nums text-muted-foreground">{record.simulatedOn}</p>
    <div className="flex flex-wrap gap-1"><StatusPill tone="success">샘플 발송</StatusPill><StatusPill tone={record.viewedAt ? 'success' : 'warning'}>{record.viewedAt ? '열람' : '미열람'}</StatusPill><StatusPill tone={record.confirmedAt ? 'success' : 'warning'}>{record.confirmedAt ? '확인 완료' : '미확인'}</StatusPill></div>
    <div className="mt-2 space-y-0.5 text-xs tabular-nums text-muted-foreground"><p>발송 {sampleTimestamp(record.issuedAt)}</p>{record.viewedAt && <p>열람 {sampleTimestamp(record.viewedAt)}</p>}{record.confirmedAt && <p>확인 {sampleTimestamp(record.confirmedAt)}</p>}</div>
    <div className="mt-2 flex flex-wrap gap-1"><Button size="sm" variant="outline" aria-label={`${LEAVE_SAMPLE_LABELS[phase]} 안내문 보기`} onClick={() => onOpen(record.id)}>안내문 보기</Button><Button size="sm" variant="ghost" aria-label={`${LEAVE_SAMPLE_LABELS[phase]} 샘플 기록 다운로드`} onClick={() => downloadSampleReceipt(record)}>기록</Button></div>
  </td>
}
function resetAfterExpiry(expiresOn: string) {
  const time = Date.parse(`${expiresOn}T00:00:00Z`)
  return Number.isFinite(time) ? new Date(time + 86400000).toISOString().slice(0, 10) : '—'
}
export function LeaveAlarmSamplePanel() {
  useRenderWatch('LeaveAlarmSamplePanel')
  const sample = useLeaveAlarmSample()
  const [filter, setFilter] = useState<'all' | 'pending'>('all')
  if (!sample.enabled) return null
  const cycles = new Map<string, Partial<Record<LeaveSamplePhase, LeaveAlarmSample>>>()
  for (const record of sample.records) {
    const cycle = cycles.get(record.expiresOn) ?? {}
    const previous = cycle[record.phase]
    if (!previous || record.issuedAt > previous.issuedAt) cycle[record.phase] = record
    cycles.set(record.expiresOn, cycle)
  }
  const rows = [...cycles.entries()].sort(([a], [b]) => b.localeCompare(a)).filter(([, cycle]) => filter === 'all' || Object.values(cycle).some(record => !record.confirmedAt))
  return <Card className="space-y-4 p-4 sm:p-5" aria-label="개발자 연차 알림 샘플 관리">
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">개발자 연차 알림 샘플</h3><Badge>로컬 테스트</Badge></div>
    <p className="text-sm text-muted-foreground">아래 직원 목록과 같은 형식으로, 개발자 한 행에 3개월·1개월·2주 전 알림을 모아 표시합니다. 각 칸은 해당 사용기한의 가장 최근 발송 상태입니다.</p>
    <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">샘플 잔여 연차는 7일입니다. 이 브라우저에만 저장하며 실제 연차, 다른 직원, 법정 사용촉진에는 반영하지 않습니다. 직원 계정 전환 중에는 사용할 수 없습니다.</p>
    {sample.error && <p role="alert" className="text-sm text-danger">{sample.error}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => sample.send(LEAVE_SAMPLE_PHASES)} disabled={Boolean(sample.error)}>3종 샘플 다시 받기</Button>{LEAVE_SAMPLE_PHASES.map(phase => <Button key={phase} size="sm" variant="outline" onClick={() => sample.send([phase])} disabled={Boolean(sample.error)}>{LEAVE_SAMPLE_LABELS[phase]} 샘플 받기</Button>)}</div>
    <StatGrid><StatTile label="샘플 발송" value={`${sample.records.length}건`}/><StatTile label="안내문 열람" value={`${sample.records.filter(row => row.viewedAt).length}건`}/><StatTile label="본인 확인" value={`${sample.records.filter(row => row.confirmedAt).length}건`}/><StatTile label="본인 미확인" value={`${sample.records.filter(row => !row.confirmedAt).length}건`}/></StatGrid>
    <div className="flex flex-wrap gap-2" role="group" aria-label="샘플 확인 상태 필터"><Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>전체 샘플</Button><Button size="sm" variant={filter === 'pending' ? 'default' : 'outline'} aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>본인 미확인 {sample.records.filter(row => !row.confirmedAt).length}건</Button></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm" aria-label="개발자 샘플 발송 및 확인 기록">
      <thead className="bg-primary text-primary-foreground"><tr>{['이름', '부서', '입사일', '다음 초기화', '3개월 전', '1개월 전', '2주 전'].map(label => <th key={label} className="px-4 py-2.5 font-medium">{label}</th>)}</tr></thead>
      <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="p-5 text-center text-muted-foreground">표시할 샘플이 없습니다.</td></tr> : rows.map(([expiresOn, cycle]) => <tr key={expiresOn} className="border-b border-border">
        <td className="px-4 py-3 align-top font-medium">개발자<p className="mt-1 whitespace-nowrap text-xs font-normal text-muted-foreground">샘플 잔여 7일</p></td>
        <td className="px-4 py-3 align-top text-muted-foreground">로컬 테스트</td>
        <td className="px-4 py-3 align-top text-xs text-muted-foreground">미설정</td>
        <td className="px-4 py-3 align-top tabular-nums"><p className="whitespace-nowrap">{resetAfterExpiry(expiresOn)}</p><p className="mt-1 text-xs text-muted-foreground">가상 날짜</p><p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">사용기한 {expiresOn}</p></td>
        {LEAVE_SAMPLE_PHASES.map(phase => <SampleAlarmCell key={phase} phase={phase} record={cycle[phase]} onOpen={sample.open}/>)}
      </tr>)}</tbody>
    </table></div>
    <p className="text-xs text-muted-foreground">입사일은 실제 직원 정보와 연결하지 않았습니다. ‘다음 초기화’는 샘플 사용기한 다음 날을 표시한 가상 날짜이며 실제 잔액을 초기화하지 않습니다.</p>
    <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">전체 발송 기록 {sample.records.length}건 보기</summary><p className="my-2 text-xs text-muted-foreground">다시 발송하기 전 기록도 보관합니다. ‘알림 읽음’과 ‘안내문 열람’은 각각 기록합니다.</p><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm" aria-label="샘플 전체 발송 이력"><thead className="bg-primary text-primary-foreground"><tr>{['알림 단계','발송 시각','알림 읽음','안내문 열람','본인 확인','기록'].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{sample.records.map(record => <tr key={record.id} className="border-b border-border"><td className="px-3 py-2">{LEAVE_SAMPLE_LABELS[record.phase]}</td><td className="px-3 py-2 text-xs">{sampleTimestamp(record.issuedAt)}</td><td className="px-3 py-2"><StatusTime value={record.readAt} done="읽음" pending="미읽음"/></td><td className="px-3 py-2"><StatusTime value={record.viewedAt} done="열람" pending="미열람"/></td><td className="px-3 py-2"><StatusTime value={record.confirmedAt} done="확인 완료" pending="미확인"/></td><td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => sample.open(record.id)}>안내문 보기</Button><Button size="sm" variant="ghost" onClick={() => downloadSampleReceipt(record)}>기록 다운로드</Button></td></tr>)}</tbody></table></div></details>
    <p className="text-xs text-muted-foreground">알림함의 ‘모두 읽음’은 안내문 열람이나 본인 확인으로 처리하지 않습니다. 위 시각과 다운로드 기록은 로컬 샘플이며 법적 증빙이 아닙니다.</p>
  </Card>
}
