import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import {
  listDraftTeamWork, saveDraftTeamWork, type DraftOrderNumbers, type DraftTeamRecord, type DraftTeamSection, type DraftTeamValues,
} from '@/lib/supabase/draft-team-work'

export type DraftTeamWork = {
  ready: boolean
  records?: ReadonlyMap<DraftTeamSection, DraftTeamRecord>
  save: <S extends DraftTeamSection>(section: S, value: DraftTeamValues[S], confirmed: boolean, revision: string | null, numbers?: DraftOrderNumbers) => Promise<void>
}

export function useDraftTeamWork(actorId: string | undefined, drafts: readonly { id: string; brandId?: string | null }[], enabled = true) {
  const active = useWorkspaceTabActivity()
  const client = useQueryClient()
  const ids = useMemo(() => drafts.map(draft => draft.id).sort(), [drafts])
  const key = ['draft-team-work', actorId, ids] as const
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listDraftTeamWork(ids, signal),
    enabled: active && enabled && Boolean(actorId) && ids.length > 0,
    retry: false,
    staleTime: 30_000,
  })
  const byDraft = useMemo(() => {
    const map = new Map<string, Map<DraftTeamSection, DraftTeamRecord>>()
    for (const row of query.data ?? []) {
      const records = map.get(row.draft_id) ?? new Map<DraftTeamSection, DraftTeamRecord>()
      records.set(row.section, row)
      map.set(row.draft_id, records)
    }
    return map
  }, [query.data])

  function forDraft(draftId: string): DraftTeamWork {
    return {
      ready: query.isSuccess,
      records: byDraft.get(draftId),
      async save(section, value, confirmed, revision, numbers) {
        try {
          const row = await saveDraftTeamWork(draftId, section, value, confirmed, revision, numbers)
          await client.cancelQueries({ queryKey: key, exact: true })
          client.setQueryData<DraftTeamRecord[]>(key, current => [
            ...(current ?? []).filter(item => item.draft_id !== draftId || item.section !== section), row,
          ])
          void client.invalidateQueries({ queryKey: ['draft-team-work', actorId], refetchType: 'none' })
          if (numbers) {
            const brandId = drafts.find(draft => draft.id === draftId)?.brandId
            if (brandId) void client.invalidateQueries({ queryKey: ['styles', brandId] })
            void client.invalidateQueries({ queryKey: ['brands'] })
          }
        } catch (error) {
          if ((error as { code?: string })?.code === '40001') void client.invalidateQueries({ queryKey: key, exact: true })
          throw error
        }
      },
    }
  }
  return { forDraft, query, missingSchema: ['PGRST205', '42P01'].includes((query.error as { code?: string } | null)?.code ?? '') }
}

export function useDraftTeamSection<S extends DraftTeamSection>(
  work: DraftTeamWork, section: S, initial: DraftTeamValues[S], readOnly: boolean,
) {
  const record = work.records?.get(section) as DraftTeamRecord<S> | undefined
  const [edit, setEdit] = useState<{ value: DraftTeamValues[S]; revision: string | null }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const revision = record?.revision ?? null
  const value = edit?.value ?? record?.payload ?? initial
  const conflict = Boolean(edit && edit.revision !== revision)
  const locked = readOnly || busy || !work.ready

  function change(update: (previous: DraftTeamValues[S]) => DraftTeamValues[S]) {
    setEdit(previous => ({ value: update(previous?.value ?? value), revision: previous ? previous.revision : revision }))
    setError('')
  }

  async function save(confirmed: boolean, payload = value, numbers?: DraftOrderNumbers) {
    if (locked || conflict) return
    setBusy(true)
    setError('')
    try {
      await work.save(section, payload, confirmed, edit ? edit.revision : revision, numbers)
      setEdit(undefined)
    } catch (failure) {
      const { code, message } = (failure ?? {}) as { code?: string; message?: string }
      setError(code === '42501' ? '기획안을 편집할 권한이 없습니다.'
        : code === '40001' ? '다른 화면에서 먼저 저장했습니다.'
          : section === 'md-quantity' && code === 'P0001' && message ? message
          : section === 'md-quantity' && code === 'PGRST202' ? '공유 DB 적용 후 발주 수량을 확정할 수 있습니다.'
          : ['22023', '22007', '22008'].includes(code ?? '') ? '컬러 구성 또는 입력값을 다시 확인해 주세요.'
            : '저장하지 못했습니다. 입력값을 유지했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return {
    value, busy, error, locked, conflict, editing: Boolean(edit),
    confirmed: Boolean(record?.confirmed && !edit),
    change, save,
    reset: () => { setEdit(undefined); setError('') },
  }
}

export function matchesTeamColors(saved: object, colors: readonly { id: string }[]) {
  return Object.keys(saved).length === colors.length && colors.every(color => Object.hasOwn(saved, color.id))
}
