import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { StylePicker } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getSupabase } from '@/lib/supabase/client'
import type { StyleRef } from '@/lib/types'

type Candidate = { id: string; name: string; number: string; units: number | null; boxes: number | null; opened: number; date: string }
type ReviewItem = { external_row_id: string; box_qr: string; photo_path: string; place: string | null; unplaced?: boolean; candidates: Candidate[] }
type ReviewQueue = { auditedPlaces: number; pending: number; items: ReviewItem[] }

async function loadReviewQueue(brandId: string, includeUnplaced: boolean): Promise<ReviewQueue> {
  const { data, error } = await getSupabase().rpc('review_warehouse_qr_audit', {
    p_brand_id: brandId, p_action: 'list',
    p_request: { includeUnplaced },
  })
  if (error) throw new Error(error.message)
  return data as ReviewQueue
}

function CandidateDetails({ candidate }: { candidate: Candidate }) {
  return (
    <span className="min-w-0">
      <span className="block font-medium">{candidate.number} {candidate.name || '상품명 미확인'}</span>
      <span className="block text-xs text-muted-foreground">
        {candidate.date || '입고일 미확인'} · {candidate.units ?? '?'}개/박스 · {candidate.boxes ?? '?'}박스
        {candidate.opened > 0 && ' · 개봉 ' + candidate.opened + '개'}
      </span>
    </span>
  )
}

function ReviewForm({ brandId, item, onLinked }: { brandId: string; item: ReviewItem; onLinked: () => Promise<void> }) {
  const [candidateId, setCandidateId] = useState('')
  const [style, setStyle] = useState<StyleRef | null>(null)
  const [name, setName] = useState('')
  const [units, setUnits] = useState('')
  const [opened, setOpened] = useState(false)

  const photo = useQuery({
    queryKey: ['warehouse-qr-audit-photo', brandId, item.photo_path],
    queryFn: async () => {
      const { data, error } = await getSupabase().storage.from('warehouse-qr-audit').createSignedUrl(item.photo_path, 600)
      if (error) throw new Error(error.message)
      return data.signedUrl
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 8 * 60 * 1000,
  })

  const link = useMutation({
    mutationFn: async () => {
      const quantity = units === '' ? null : Number(units)
      if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000)) {
        throw new Error('수량을 1 이상의 정수로 입력하세요.')
      }
      const { error } = await getSupabase().rpc('review_warehouse_qr_audit', {
        p_brand_id: brandId,
        p_action: item.unplaced ? 'link_unplaced' : 'link',
        p_request: { rowId: item.external_row_id, styleId: style?.styleId, name: name.trim(),
          ...(!item.unplaced && { candidateId, units: quantity, opened }) },
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: onLinked,
  })

  const hasProduct = Boolean(candidateId || style || name.trim())
  return (
    <article className="flex min-w-0 flex-col gap-4">
      <div>
        <h3 className="font-semibold">{item.unplaced ? '자리 미정' : item.place}</h3>
        <p className="break-all font-mono text-sm text-muted-foreground">{item.box_qr}</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div>
          {photo.data && (
            <a href={photo.data} target="_blank" rel="noreferrer">
              <img src={photo.data} alt="현장에서 촬영한 박스 표시" className="max-h-96 w-full rounded-md border bg-muted object-contain" />
            </a>
          )}
          {photo.isPending && <p className="text-sm text-muted-foreground">사진을 불러오는 중입니다.</p>}
          {photo.isError && <Button variant="outline" size="sm" onClick={() => void photo.refetch()}>사진 다시 불러오기</Button>}
        </div>
        <fieldset className="space-y-4" disabled={link.isPending}>
          {!item.unplaced && <div className="space-y-2">
            <h4 className="text-sm font-medium">실사 전 자리 목록</h4>
            <div className="max-h-60 space-y-1 overflow-auto">
              {item.candidates.map((candidate) => (
                <label key={candidate.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                  <input type="radio" name="audit-candidate" checked={candidateId === candidate.id}
                    onChange={() => { setCandidateId(candidate.id); setStyle(null); setName('') }} />
                  <CandidateDetails candidate={candidate} />
                </label>
              ))}
              {item.candidates.length === 0 && <p className="text-sm text-muted-foreground">기존 상품이 없는 자리입니다.</p>}
            </div>
          </div>}
          <label className="block space-y-1 text-sm">
            <span>정식 상품 검색</span>
            <StylePicker brandId={brandId} value={style} onChange={(value) => {
              setStyle(value)
              if (value) { setCandidateId(''); setName('') }
            }} />
          </label>
          <label className="block space-y-1 text-sm">
            <span>M번호 없는 물품명</span>
            <Input value={name} maxLength={300} onChange={(event) => {
              setName(event.target.value)
              if (event.target.value) { setCandidateId(''); setStyle(null) }
            }} />
          </label>
          {!item.unplaced && <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={opened} onChange={(event) => { setOpened(event.target.checked); setUnits('') }} />
              개봉 박스
            </label>
            <label className="block space-y-1 text-sm">
              <span>{opened ? '확인된 잔량' : '확인된 입수'}</span>
              <Input type="number" min={1} max={1000000} value={units} onChange={(event) => setUnits(event.target.value)}
                placeholder="수량 미확인" />
            </label>
          </>}
          {link.isError && <p role="alert" className="text-sm text-destructive">{link.error.message}</p>}
          <Button disabled={!hasProduct || !photo.data || link.isPending} onClick={() => link.mutate()}>
            {link.isPending ? '저장 중…' : '상품 연결'}
          </Button>
        </fieldset>
      </div>
    </article>
  )
}

export function WarehouseQrAuditReviewPanel({ brandId, includeUnplaced }: { brandId: string; includeUnplaced: boolean }) {
  const cache = useQueryClient()
  const [selected, setSelected] = useState('')
  const queryKey = ['warehouse-qr-audit-review', brandId, includeUnplaced]
  const queue = useQuery({ queryKey, queryFn: () => loadReviewQueue(brandId, includeUnplaced) })
  const items = queue.data?.items
  const active = items?.find((item) => item.external_row_id === selected) ?? items?.[0]

  async function onLinked() {
    setSelected('')
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['warehouse-qr-audit-review', brandId] }),
      cache.invalidateQueries({ queryKey: ['warehouse-stock-positions', brandId] }),
      cache.invalidateQueries({ queryKey: ['warehouse-stock-condition-links', brandId] }),
    ])
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {queue.data && <>
          <Badge variant="outline">실사 완료 {queue.data.auditedPlaces}자리</Badge>
          <Badge variant={queue.data.pending ? 'warning' : 'outline'}>상품 확인 대기 {queue.data.pending}박스</Badge>
        </>}
        <Button variant="outline" size="sm" onClick={() => void queue.refetch()} disabled={queue.isFetching}>새로고침</Button>
      </div>
      {queue.isPending && <p className="text-sm text-muted-foreground">검수 대기 목록을 불러오는 중입니다.</p>}
      {queue.isError && <p role="alert" className="text-sm text-destructive">{queue.error.message}</p>}
      {queue.isSuccess && !active && <p className="text-sm text-muted-foreground">상품 확인이 필요한 박스가 없습니다.</p>}
      {active && (
        <div className="grid gap-4 lg:grid-cols-[minmax(10rem,15rem)_1fr]">
          <nav aria-label="검수할 박스" className="max-h-80 space-y-1 overflow-auto lg:max-h-[38rem]">
            {items?.map((item) => (
              <Button key={item.external_row_id} variant={active === item ? 'secondary' : 'ghost'}
                className="h-auto min-h-9 w-full justify-start text-left"
                onClick={() => setSelected(item.external_row_id)}>
                <span className="min-w-0"><strong>{item.unplaced ? '자리 미정' : item.place}</strong><span className="block truncate font-mono text-xs">{item.box_qr}</span></span>
              </Button>
            ))}
          </nav>
          <ReviewForm key={active.external_row_id} brandId={brandId} item={active} onLinked={onLinked} />
        </div>
      )}
    </section>
  )
}
