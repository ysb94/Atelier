import { Check, ChevronDown, Download, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'
import { DraftPhoto } from '@/features/drafts/DraftSheetRow'
import { useRenderWatch } from '@/lib/diagnostics'
import { sampleElapsedDays, sampleTripSpanDays } from '@/lib/drafts/sample-work-order'
import { cn, formatNumber } from '@/lib/utils'
import type { WorkOrderGroup } from './work-order-types'

function fileTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function ChinaWorkOrderBoard({ groups, brandById, emptyMessage }: { groups: readonly WorkOrderGroup[]; brandById: ReadonlyMap<string, { name: string }>; emptyMessage: string }) {
  useRenderWatch('ChinaWorkOrderBoard')
  return <Card className="overflow-hidden">
    <div role="region" aria-label="중국팀 작업 지시서 목록" tabIndex={0} className="overflow-x-auto">
      <table className="w-full min-w-[1280px] table-fixed border-collapse text-sm">
        <colgroup><col className="w-[29%]" /><col className="w-[12%]" /><col className="w-[17%]" /><col className="w-[31%]" /><col className="w-[11%]" /></colgroup>
        <thead className="bg-primary text-primary-foreground">
          <tr>{['상품', '담당자 지정', '샘플차수', '파일', '업무배정'].map(label => <th key={label} scope="col" className="px-4 py-5 text-center font-medium">{label}</th>)}</tr>
        </thead>
        {groups.length === 0 && <tbody><tr><td colSpan={5} className="px-6 py-16 text-center text-muted-foreground">{emptyMessage}</td></tr></tbody>}
        {groups.map(({ draft, rows }) => {
          const names = [...new Set(rows.map(row => row.assigneeName.trim()).filter(Boolean))]
          const brand = draft.brandId ? brandById.get(draft.brandId)?.name ?? '브랜드 미정' : '브랜드 미정'
          return <tbody key={draft.id} className="border-b border-primary/35 last:border-b-0" aria-label={`${draft.draftNo} 상품 묶음`}>
            {rows.map((row, index) => {
              const done = row.shipped
              const days = done ? sampleTripSpanDays(row.shippedAt, row.returnedAt) : sampleElapsedDays(row.shippedAt)
              const sent = fileTime(row.returnedAt)
              const registered = fileTime(row.shippedAt)
              const note = done ? row.failReason : row.focusReason
              return <tr key={`${row.kind}:${row.rowId}`} className="border-t border-border first:border-t-0">
                {index === 0 && <>
                  <td rowSpan={rows.length} className="border-r border-border px-5 py-7 align-middle">
                    <div className="flex items-center gap-5 [&>.draft-sheet-photo]:h-44 [&>.draft-sheet-photo]:w-32 [&>.draft-sheet-photo]:shrink-0">
                      <DraftPhoto src={draft.imageUrl} name={draft.nameEn.trim() || draft.nameKo.trim() || draft.draftNo} />
                      <div className="min-w-0 space-y-2">
                        <strong className="block break-words text-base">{brand}</strong>
                        <p className="text-xs text-muted-foreground">Designer <strong className="ml-1 text-foreground">{draft.owner.trim() || '미정'}</strong></p>
                        <strong className="block">No. {draft.draftNo}</strong>
                        <div className="space-y-1 pt-3 font-medium text-primary">
                          {draft.nameKo.trim() && <p className="break-words">{draft.nameKo}</p>}
                          {draft.nameEn.trim() && <p className="break-words">{draft.nameEn}</p>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td rowSpan={rows.length} className="border-r border-border px-4 py-7 text-center align-middle">
                    <Button type="button" variant="outline" disabled className="disabled:opacity-100">담당자 <ChevronDown className="size-3.5" aria-hidden="true" /></Button>
                    {names.length > 0 && <div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">기존 회차 담당자</p><div className="flex flex-wrap justify-center gap-1">{names.map(name => <Badge key={name} variant="muted">{name}</Badge>)}</div></div>}
                  </td>
                </>}
                <td className="border-r border-border px-4 py-7 align-middle">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 space-y-2"><strong className="block font-medium">{row.stageLabel}</strong>{row.colorName && <p className="break-words text-xs text-muted-foreground">{row.colorName}</p>}<StatusPill tone={done ? 'muted' : 'outline'}>{done ? '발송 완료' : '진행 중'}</StatusPill></div>
                    <span className={cn('shrink-0 whitespace-nowrap text-base font-semibold tabular-nums', done ? 'text-foreground' : 'text-primary')}>{days == null ? '기간 미등록' : `${done ? '' : '+ '}${formatNumber(days)} days`}</span>
                  </div>
                </td>
                <td className="border-r border-border px-5 py-7 align-middle">
                  <div className={cn('flex min-w-0 flex-wrap items-center gap-3', done && 'text-muted-foreground')}>
                    <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1 basis-32"><p className="break-all" title={row.fileName}>{row.url ? row.fileName : '작업 지시서 미등록'}</p><p className="mt-1 text-xs text-muted-foreground">{sent ? `${sent} 샘플 발송` : registered ? `${registered} 지시서 발송` : '발송일 미등록'}</p></div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant="outline" size="sm" disabled className={cn('disabled:opacity-100', done ? 'text-muted-foreground' : row.fileCheckedAt ? 'text-foreground' : 'text-primary')}><Download className="size-3.5" aria-hidden="true" />받기</Button>
                      <Button type="button" variant="secondary" size="sm" disabled aria-pressed={done} className="text-muted-foreground disabled:opacity-100"><Check className="size-3.5" aria-hidden="true" />발송 완료</Button>
                    </div>
                  </div>
                  {note && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">진행 메모: {note}</p>}
                </td>
                {index === 0 && <td rowSpan={rows.length} className="px-4 py-7 text-center align-middle"><Button type="button" variant="outline" disabled className="disabled:opacity-100">업무 배정</Button></td>}
              </tr>
            })}
          </tbody>
        })}
      </table>
    </div>
  </Card>
}
