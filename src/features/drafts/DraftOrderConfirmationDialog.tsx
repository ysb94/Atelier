import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useDraftLoading } from './DraftLoading'
import { Button } from '@/components/ui/button'
import { draftColorNames } from '@/lib/drafts/color-names'
import { previewDraftOrderNumbers, type DraftOrderNumbers } from '@/lib/supabase/draft-team-work'
import type { ProductDraft } from '@/lib/types'

type OrderDraft = Pick<ProductDraft, 'id' | 'brandId' | 'draftNo' | 'nameEn' | 'nameKo' | 'colors' | 'specs'>

export function DraftOrderConfirmationDialog({ draft, actorId, quantities, destinationName, chinaTeamOrder, locked, onBack, onConfirm }: {
  draft: OrderDraft
  actorId?: string
  quantities: Readonly<Record<string, string>>
  destinationName?: string
  chinaTeamOrder: boolean
  locked: boolean
  onBack: () => void
  onConfirm: (numbers: DraftOrderNumbers) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()
  const { brandId, colors } = draft
  const styleNumbers = useQuery({
    queryKey: ['draft-order-number-preview', actorId, draft.id, brandId],
    queryFn: () => previewDraftOrderNumbers(draft.id),
    enabled: Boolean(brandId && colors.length),
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  })
  const candidates = styleNumbers.data?.numbers
  const loadingNumbers = Boolean(brandId && colors.length && styleNumbers.isPending && !styleNumbers.isError)
  useDraftLoading(styleNumbers.isLoading && '사용 가능한 품번을 확인하는 중…')
  const notEnoughNumbers = Boolean(styleNumbers.isSuccess && colors.some(color => !candidates?.[color.id]))
  const confirmDisabled = locked || !brandId || !colors.length || !candidates || styleNumbers.isFetching || styleNumbers.isError || notEnoughNumbers

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
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">품번</th>
              <th scope="col" className="w-full px-3 py-2 font-semibold">상품명·컬러명</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold">수량</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {colors.map(color => {
              const names = draftColorNames(color.name, draft.specs.colorNames?.[color.id])
              const quantity = quantities[color.id]
              return <tr key={color.id}>
                <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">{candidates?.[color.id] ?? '—'}</td>
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
        {!brandId ? <p>브랜드를 지정하면 품번을 확인할 수 있습니다.</p>
          : loadingNumbers ? <p role="status">사용 가능한 품번을 확인하는 중입니다.</p>
          : styleNumbers.isError ? <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-danger">{(styleNumbers.error as { code?: string })?.code === 'PGRST202'
              ? '공유 DB 적용 후 품번을 발급할 수 있습니다.' : '품번 후보를 불러오지 못했습니다.'}</p>
            <Button type="button" variant="outline" size="sm" disabled={styleNumbers.isFetching} onClick={() => void styleNumbers.refetch()}>다시 조회</Button>
          </div> : notEnoughNumbers ? <p role="alert" className="text-danger">{styleNumbers.data?.prefix
            ? '이 브랜드에 발급할 수 있는 네 자리 품번이 부족합니다.' : '브랜드 관리에서 품번 접두어를 설정해 주세요.'}</p>
          : <p>확정하면 이 품번이 전체 상품에 등록됩니다.</p>}
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
        <Button type="button" disabled={confirmDisabled} onClick={() => candidates && onConfirm(candidates)}>{chinaTeamOrder ? '수량 확정' : '발주 저장'}</Button>
      </footer>
    </dialog>, document.body,
  )
}
