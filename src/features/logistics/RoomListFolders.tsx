import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Folder, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  createWarehouseRoomListFolder,
  listWarehouseRoomListFolders,
  readWarehouseRoomListItems,
  type WarehouseRoomListFolder,
} from '@/lib/supabase/warehouse-room-lists'
import { emptyRoomListRow, isRoomListQuantity, mergeRoomListRows, type RoomListRow } from './room-list-paste'
import { RoomListFolderItems } from './RoomListFolderItems'

const REGISTERED_DATE = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
})
const REGISTERED_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', timeStyle: 'short',
})

type Draft = { brandId: string; title: string; rows: RoomListRow[] }

function readDraftRows(draftRows: RoomListRow[]) {
  const rows: RoomListRow[] = []
  for (const [index, [productName, amount]] of draftRows.entries()) {
    const name = productName.trim()
    const quantity = amount.trim()
    if (!name && !quantity) continue
    if (!name) throw new Error(`${index + 1}행에 상품명을 입력해 주세요.`)
    if (quantity && !isRoomListQuantity(quantity)) throw new Error(`${index + 1}행의 수량을 숫자로 입력해 주세요.`)
    rows.push([name, quantity])
  }
  if (!rows.length) throw new Error('상품 목록을 붙여넣어 주세요.')
  const merged = mergeRoomListRows(rows)
  if ('invalidRow' in merged) throw new Error(`${merged.invalidRow}행의 수량을 확인해 주세요.`)
  return merged.rows
}

export function RoomListFolders({ userId, onOpen }: { userId: string; onOpen: (rows: RoomListRow[], count: number) => void }) {
  useRenderWatch('RoomListFolders')
  const active = useWorkspaceTabActivity()
  const { selectedBrands, loading: brandsLoading, error: brandsError } = useCompanyBrandScope()
  const brandIds = selectedBrands.map(brand => brand.id)
  const cache = useQueryClient()
  const queryKey = ['warehouse-room-list-folders', userId, brandIds] as const
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const draftRequestId = useRef<string | null>(null)
  const folders = useQuery({
    queryKey,
    queryFn: () => listWarehouseRoomListFolders(brandIds),
    enabled: active && brandIds.length > 0,
  })
  const today = REGISTERED_DATE.format()
  const foldersByDate = useMemo(() => {
    const groups = new Map<string, WarehouseRoomListFolder[]>()
    for (const folder of folders.data ?? []) {
      const date = REGISTERED_DATE.format(new Date(folder.created_at))
      const group = groups.get(date)
      if (group) group.push(folder)
      else groups.set(date, [folder])
    }
    return [...groups]
  }, [folders.data])
  const register = useMutation({
    mutationFn: createWarehouseRoomListFolder,
    onSuccess: async () => {
      closeDraft()
      await cache.invalidateQueries({ queryKey: ['warehouse-room-list-folders', userId] })
    },
  })
  const open = useMutation({
    mutationFn: async (chosen: WarehouseRoomListFolder[]) => {
      const items = await readWarehouseRoomListItems(chosen, brandIds)
      const started = performance.now()
      const result = mergeRoomListRows(items)
      const elapsed = Math.round(performance.now() - started)
      if (elapsed >= 200) {
        const log = elapsed >= 1000 ? console.warn : console.info
        log('[room-list] 폴더 상품 합계', { elapsed, rows: items.length })
      }
      if ('invalidRow' in result) throw new Error('Invalid stored room list quantity.')
      return { rows: result.rows, count: chosen.length }
    },
    onSuccess: ({ rows, count }) => onOpen(rows, count),
  })
  const chosen = folders.data?.filter(folder => selected.has(folder.id)) ?? []

  function closeDraft() {
    setDraft(null)
    setValidationError(null)
    draftRequestId.current = null
  }

  function updateDraft(next: Draft) {
    draftRequestId.current = null
    setValidationError(null)
    register.reset()
    setDraft(next)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || register.isPending) return
    const title = draft.title.trim()
    if (!title) {
      setValidationError('폴더 제목을 입력해 주세요.')
      return
    }
    const started = performance.now()
    let items: RoomListRow[]
    try {
      items = readDraftRows(draft.rows)
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : '붙여넣은 목록을 확인해 주세요.')
      return
    }
    const elapsed = Math.round(performance.now() - started)
    if (elapsed >= 200) {
      const log = elapsed >= 1000 ? console.warn : console.info
      log('[room-list] 폴더 등록 목록 정리', { elapsed, rows: items.length })
    }
    draftRequestId.current ??= crypto.randomUUID()
    setValidationError(null)
    register.mutate({ id: draftRequestId.current, brand_id: draft.brandId, title, items })
  }

  return (
    <>
      <PageHeader title="방별리스트" description="저장한 폴더를 선택하면 상품과 수량을 합쳐 볼 수 있습니다." />
      <div className="mb-5 flex justify-center">
        {draft ? (
          <Card className="w-full max-w-2xl p-4 sm:p-5">
            <form className="grid gap-3" onSubmit={submit}>
              {selectedBrands.length > 1 ? (
                <label className="grid gap-1 text-sm font-medium">
                  브랜드
                  <select className="h-9 rounded-md border border-border bg-background px-2" value={draft.brandId}
                    disabled={register.isPending} onChange={event => updateDraft({ ...draft, brandId: event.target.value })}>
                    {selectedBrands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="grid gap-1 text-sm font-medium">
                폴더 제목
                <Input value={draft.title} maxLength={120} disabled={register.isPending}
                  onChange={event => updateDraft({ ...draft, title: event.target.value })} />
              </label>
              <RoomListFolderItems
                rows={draft.rows}
                disabled={register.isPending}
                onChange={rows => updateDraft({ ...draft, rows })}
                onError={setValidationError}
              />
              {validationError || register.isError ? (
                <p role="alert" className="text-sm text-danger">{validationError ?? '목록을 등록하지 못했습니다. 다시 시도해 주세요.'}</p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={register.isPending} onClick={closeDraft}>취소</Button>
                <Button type="submit" disabled={register.isPending}>{register.isPending ? '등록 중…' : '등록'}</Button>
              </div>
            </form>
          </Card>
        ) : (
          <Button type="button" disabled={!brandIds.length}
            onClick={() => {
              register.reset()
              setDraft({ brandId: brandIds[0], title: '', rows: Array.from({ length: 6 }, emptyRoomListRow) })
            }}>
            <Plus aria-hidden="true" className="size-4" /> 상품 추가
          </Button>
        )}
      </div>
      {brandsError || folders.isError ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          폴더 목록을 불러오지 못했습니다.
          <Button type="button" variant="outline" size="sm" className="ml-2"
            onClick={() => void (brandsError ? cache.invalidateQueries({ queryKey: ['brands'] }) : folders.refetch())}>다시 조회</Button>
        </p>
      ) : null}
      {folders.isLoading || brandsLoading ? <p role="status" className="text-sm text-muted-foreground">폴더를 불러오는 중…</p> : null}
      {folders.data?.length ? (
        <>
          <div className="mb-3 flex justify-end">
            <Button type="button" disabled={!chosen.length || open.isPending} onClick={() => open.mutate(chosen)}>
              {open.isPending ? '여는 중…' : `선택한 폴더 열기${chosen.length ? ` (${chosen.length})` : ''}`}
            </Button>
          </div>
          {open.isError ? <p role="alert" className="mb-3 text-sm text-danger">선택한 폴더를 열지 못했습니다. 다시 시도해 주세요.</p> : null}
          <div className="space-y-5">
            {foldersByDate.map(([date, group]) => {
              const isToday = date === today
              const expanded = expandedDates[date] ?? isToday
              const Chevron = expanded ? ChevronDown : ChevronRight
              return (
                <section key={date} className="border-t-2 border-border pt-2">
                  <h2>
                    <Button type="button" variant="ghost" aria-expanded={expanded}
                      className="h-auto w-full justify-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5"
                      onClick={() => setExpandedDates(current => ({ ...current, [date]: !expanded }))}>
                      <Chevron aria-hidden="true" className="size-4" />
                      <span className="font-semibold">{date}{isToday ? ' · 오늘' : ''}</span>
                      <span className="ml-auto text-xs text-muted-foreground">폴더 {group.length.toLocaleString('ko-KR')}개</span>
                    </Button>
                  </h2>
                  {expanded && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {group.map(folder => (
                        <Card key={folder.id}>
                          <label className="flex h-full cursor-pointer items-start gap-3 p-4">
                            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={selected.has(folder.id)}
                              aria-label={`${folder.title} 선택`} disabled={open.isPending}
                              onChange={event => {
                                const checked = event.target.checked
                                setSelected(current => {
                                  const next = new Set(current)
                                  if (checked) next.add(folder.id)
                                  else next.delete(folder.id)
                                  return next
                                })
                              }} />
                            <Folder aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
                            <div className="min-w-0">
                              <div className="break-words font-medium">{folder.title}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {folder.created_by_name} · <time dateTime={folder.created_at}>{REGISTERED_TIME.format(new Date(folder.created_at))}</time>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">상품 {folder.item_count.toLocaleString('ko-KR')}개</div>
                            </div>
                          </label>
                        </Card>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </>
      ) : folders.isSuccess ? <p className="text-center text-sm text-muted-foreground">등록된 폴더가 없습니다.</p> : null}
    </>
  )
}
