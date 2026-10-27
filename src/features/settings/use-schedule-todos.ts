import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { emptyList } from '@/lib/utils'
import { deleteScheduleTodo, listScheduleTodos, saveScheduleTodo } from '@/lib/supabase/personal-schedule-todos'
import type { ScheduleTodo } from './personal-schedule-todos'
import { usePagePreview } from '@/lib/company/page-preview-context'

export function useScheduleTodos(owner: string|undefined, company: string|undefined, enabled: boolean, active: boolean, month: string) {
  const cache = useQueryClient(), [busy,setBusy] = useState(false)
  const readOnly = Boolean(usePagePreview()?.active)
  const key = ['personal-schedule-todos',owner,company]
  const query = useQuery({ queryKey:[...key,month], queryFn:()=>listScheduleTodos(owner!,company!,month), enabled:enabled&&!!owner&&!!company&&!readOnly, refetchInterval:active&&!readOnly?15000:false })
  async function change(item: ScheduleTodo, remove = false, existing = true) {
    if (readOnly) throw new Error('화면 미리보기에서는 실제 개인 To-do를 저장하지 않습니다.')
    if (!owner || !company || !enabled || busy || !query.isSuccess) throw new Error('개인 To-do를 불러온 후 다시 시도해 주세요.')
    setBusy(true)
    try {
      if (remove) await deleteScheduleTodo(owner,item.id)
      else await saveScheduleTodo(owner,company,item,existing)
      await Promise.all([cache.invalidateQueries({queryKey:key}),cache.invalidateQueries({queryKey:['meeting-availability']})])
    } finally { setBusy(false) }
  }
  return { ...query, isSuccess:!readOnly&&query.isSuccess, readOnly, todos:query.data ?? emptyList<ScheduleTodo>(), busy, change }
}
