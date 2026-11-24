import { useEffect, useId, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { diagnosticOperation } from '@/lib/diagnostics/workflow-trace'
import { draftColorNames } from '@/lib/drafts/color-names'
import { listAllStyleRefs } from '@/lib/supabase/styles'
import type { ProductDraft } from '@/lib/types'

type OrderDraft = Pick<ProductDraft, 'brandId' | 'draftNo' | 'nameEn' | 'nameKo' | 'colors' | 'specs'>

function availableOrderNumbers(usedNumbers: readonly string[], count: number) {
  const occupied = new Set<number>()
  for (const value of usedNumbers) {
    const match = /^M(\d{1,5})$/i.exec(value.replace(/\s+/g, ''))
    if (match) occupied.add(Number(match[1]))
  }

  const candidates: string[] = []
  for (let number = 1; number <= 99999 && candidates.length < count; number += 1) {
    if (!occupied.has(number)) candidates.push(`M${String(number).padStart(4, '0')}`)
  }
  return candidates
}

export function DraftOrderConfirmationDialog({ draft, actorId, quantities, destinationName, chinaTeamOrder, locked, onBack, onConfirm }: {
  draft: OrderDraft
  actorId?: string
  quantities: Readonly<Record<string, string>>
  destinationName?: string
  chinaTeamOrder: boolean
  locked: boolean
  onBack: () => void
  onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()
  const { brandId, colors } = draft
  const styleNumbers = useQuery({
    queryKey: ['draft-order-number-preview', actorId, brandId],
    queryFn: () => diagnosticOperation('app', 'draft_order_number_preview', async trace => {
      if (!brandId) return []
      const styles = await trace.run('load_registered_style_numbers', context => listAllStyleRefs(brandId, context))
      return styles.map(style => style.styleNo)
    }),
    enabled: Boolean(brandId && colors.length),
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  })
  const candidates = useMemo(() => styleNumbers.data ? availableOrderNumbers(styleNumbers.data, colors.length) : [], [styleNumbers.data, colors.length])
  const loadingNumbers = Boolean(brandId && colors.length && styleNumbers.isPending && !styleNumbers.isError)
  const notEnoughNumbers = Boolean(styleNumbers.isSuccess && candidates.length < colors.length)
  const confirmDisabled = locked || !colors.length || Boolean(brandId && (loadingNumbers || styleNumbers.isFetching || styleNumbers.isError || notEnoughNumbers))

  useEffect(() => {
    const popup = dialog.current
    popup?.showModal()
    return () => popup?.close()
  }, [])

  return createPortal(
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={messageId} onCancel={event => { event.preventDefault(); onBack() }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/40 sm:p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={titleId} className="text-base font-semibold">{draft.draftNo} 발주 수량 확인</h2>
        <p className="text-sm text-muted-foreground">제조국·제조처 {destinationName ?? '미정'}</p>
      </header>

      {colors.length ? <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[18rem] text-left text-sm">
          <thead className="bg-muted text-xs">
            <tr>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">M번호 후보</th>
              <th scope="col" className="w-full px-3 py-2 font-semibold">상품명·컬러명</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold">수량</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {colors.map((color, index) => {
              const names = draftColorNames(color.name, draft.specs.colorNames?.[color.id])
              const quantity = quantities[color.id]
              return <tr key={color.id}>
                <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">{candidates[index] ?? '—'}</td>
                <td className="wrap-anywhere px-3 py-2">
                  <span lang="en" className="block">{[draft.nameEn.trim(), names.nameEn].filter(Boolean).join(' ') || '—'}</span>
                  <span lang="ko" className="mt-0.5 block text-muted-foreground">{[draft.nameKo.trim(), names.nameKo].filter(Boolean).join(' ') || '—'}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{quantity ? quantity.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—'}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div> : <p className="text-sm text-muted-foreground">컬러를 먼저 추가해 주세요.</p>}

      {colors.length > 0 && <div className="mt-2 text-xs text-muted-foreground">
        {!brandId ? <p>브랜드를 지정하면 M번호 후보를 확인할 수 있습니다.</p>
          : loadingNumbers ? <p role="status">사용 가능한 M번호를 확인하는 중입니다.</p>
          : styleNumbers.isError ? <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-danger">M번호 후보를 불러오지 못했습니다.</p>
            <Button type="button" variant="outline" size="sm" disabled={styleNumbers.isFetching} onClick={() => void styleNumbers.refetch()}>다시 조회</Button>
          </div> : notEnoughNumbers ? <p role="alert" className="text-danger">컬러 수만큼 사용 가능한 M번호가 없습니다.</p>
          : <p>M번호는 후보로 표시됩니다.</p>}
      </div>}

      {chinaTeamOrder && <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
        <p className="font-medium">중국팀 발주 연동 예정</p>
        <p className="mt-1">중국팀이 발주 내용을 읽은 뒤에는 중국팀에 연락해 철회 승낙을 받아야 취소할 수 있습니다.</p>
      </div>}
      <p id={messageId} className="mt-4 text-sm">
        {chinaTeamOrder ? '이 목록의 발주 수량을 확정하시겠습니까?' : '이 목록으로 발주를 저장하시겠습니까?'}
      </p>
      <footer className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onBack}>돌아가기</Button>
        <Button type="button" disabled={confirmDisabled} onClick={onConfirm}>{chinaTeamOrder ? '수량 확정' : '발주 저장'}</Button>
      </footer>
    </dialog>, document.body,
  )
}
