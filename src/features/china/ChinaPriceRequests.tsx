import { useId, useState, type Dispatch, type SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input } from '@/components/ui/input'
import { DraftPhoto } from '@/features/drafts/DraftSheetRow'
import { useRenderWatch } from '@/lib/diagnostics'
import { sampleElapsedDays } from '@/lib/drafts/sample-work-order'
import { priceRequestLabels, type ChinaPricePreviewRequest, type ChinaPricePreviewState, type PriceRequestKind } from './china-price-preview'

const examplePrice = '15'
const requestDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
})

type RequestFilter = 'all' | PriceRequestKind

function ChinaPriceRequestRow({ request, preview, onChange }: {
  request: ChinaPricePreviewRequest
  preview?: ChinaPricePreviewState[string]
  onChange: (state: ChinaPricePreviewState[string]) => void
}) {
  const formId = useId()
  const { product, requestedAt, kind } = request
  const amounts = preview?.amounts ?? {}
  const sent = preview?.sent ?? false

  return <tr className="border-b border-primary/25 last:border-b-0">
    <td className="border-r border-border/60 px-4 py-4 align-top">
      <div className="mx-auto max-w-36 space-y-1.5">
        <p className="break-words text-center text-sm font-medium text-primary">{product.brandName}</p>
        <div className="draft-sheet-image-cell">
          <DraftPhoto src={product.imageUrl} name={product.nameKo || product.draftNo} />
        </div>
        <p className="break-words text-xs text-muted-foreground">Designer <strong className="text-foreground">{product.owner || '—'}</strong></p>
        <p className="text-sm font-semibold">No. {product.draftNo}</p>
        <div className="break-words text-sm text-primary">
          {product.nameKo && <p>{product.nameKo}</p>}
          {product.nameEn && <p>{product.nameEn}</p>}
        </div>
      </div>
    </td>
    <td className="border-r border-border/60 px-3 py-12 text-center align-top">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground"><time dateTime={requestedAt}>{requestDate.format(new Date(requestedAt))}</time> 발송</p>
        <Badge variant={kind === 'first' ? 'default' : 'warning'} className={kind === 'first' ? 'rounded-md border-transparent bg-primary text-primary-foreground' : 'rounded-md'}>{priceRequestLabels[kind]}</Badge>
        <p className="text-sm font-medium tabular-nums text-primary">+ {sampleElapsedDays(requestedAt)} days</p>
      </div>
    </td>
    <td className="py-11 pl-3 align-top">
      <div className="divide-y divide-primary/20">
        {product.colors.map(color => <div key={color.id} className="flex h-9 items-center gap-2 pr-2">
          <span className="flex w-2 shrink-0 justify-center" aria-hidden="true">{color.photoUrl && <span className="size-1 rounded-full bg-primary" />}</span>
          <span title={color.name} className="min-w-0 flex-1 truncate text-sm">{color.name}</span>
          {color.photoUrl && <DraftPhoto src={color.photoUrl} name={`${color.name} 컬러`} compact />}
        </div>)}
      </div>
    </td>
    <td className="border-r border-border/60 py-11 pr-4 align-top">
      <div className="divide-y divide-primary/20">
        {product.colors.map(color => <div key={color.id} className="flex h-9 items-center justify-center gap-2">
          <Input form={formId} aria-label={`${color.name} 단가 (위안)`} type="number" inputMode="decimal" min="0" step="0.01" required readOnly={sent}
            className="h-7 w-20 px-1 text-center tabular-nums" value={amounts[color.id] ?? examplePrice}
            onChange={event => onChange({ amounts: { ...amounts, [color.id]: event.target.value } })} />
          <span aria-hidden="true" className="text-sm">¥</span>
        </div>)}
      </div>
    </td>
    <td className="px-4 pt-16 align-top">
      <form id={formId} className="flex max-w-64 justify-center" onSubmit={event => {
        event.preventDefault()
        onChange({ amounts, sent: true })
      }}>
        {sent ? <Badge variant="success" role="status">전송 미리보기 완료</Badge>
          : <Button type="submit" variant="outline" size="sm">단가 전송</Button>}
      </form>
    </td>
  </tr>
}

export function ChinaPriceRequests({ requests, preview, setPreview }: {
  requests: readonly ChinaPricePreviewRequest[]
  preview: ChinaPricePreviewState
  setPreview: Dispatch<SetStateAction<ChinaPricePreviewState>>
}) {
  useRenderWatch('ChinaPriceRequests')
  const [filter, setFilter] = useState<RequestFilter>('all')
  const pending = requests.filter(request => !preview[request.id]?.sent)
  const shown = filter === 'all' ? requests : requests.filter(request => request.kind === filter)

  return <section aria-labelledby="china-price-requests-title">
    <h2 id="china-price-requests-title" className="sr-only">단가요청</h2>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4">
      <FilterTabs<RequestFilter> value={filter} onChange={setFilter} ariaLabel="단가요청 구분" variant="underline" className="border-b-0"
        tabs={[
          { value: 'all', label: `ALL (${pending.length})` },
          { value: 'first', label: `1차 요청 (${pending.filter(request => request.kind === 'first').length})` },
          { value: 'repeat', label: `재요청 (${pending.filter(request => request.kind === 'repeat').length})` },
        ]} />
      <p className="px-4 py-2 text-xs text-muted-foreground">예시 요청 · 단가 입력 및 전송 미리보기</p>
    </div>
    <Card className="overflow-x-auto">
      <table aria-label="단가요청 목록" className="w-full min-w-[760px] table-fixed text-left">
        <colgroup><col className="w-44" /><col className="w-40" /><col className="w-36" /><col className="w-36" /><col /></colgroup>
        <thead className="bg-primary text-primary-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 text-center text-sm font-medium">Product</th>
            <th scope="col" className="px-3 py-3 text-center text-sm font-medium">구분</th>
            <th scope="col" className="px-3 py-3 text-center text-sm font-medium">Color</th>
            <th scope="col" className="px-3 py-3 text-center text-sm font-medium">단가</th>
            <th scope="col"><span className="sr-only">전송</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map(request => <ChinaPriceRequestRow key={request.id} request={request} preview={preview[request.id]}
            onChange={state => setPreview(current => current[request.id]?.sent ? current : { ...current, [request.id]: state })} />)}
        </tbody>
      </table>
    </Card>
  </section>
}
