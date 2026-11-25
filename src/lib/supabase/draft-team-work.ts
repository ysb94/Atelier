import { diagnosticOperation } from '@/lib/diagnostics'
import { tracedQuery } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

export type DraftTeamValues = {
  amd: { collection: string; colors: Record<string, { sabangnet: string; barcode: string }> }
  'md-quantity': { quantities: Record<string, string>; arrival: string }
  'md-price': { retail: string; discount: string; extraDiscount: string; auto: boolean }
  'md-options': { type: { id: string; label: string } | null; entries: { id: string; name: string; price: string }[] }
  'md-listing': {
    registerType: string; registerLabel: string; openType: string; openLabel: string
    partnerId: string | null; partner: string; from: string; to: string; assignee: string
  }
}

export type DraftTeamSection = keyof DraftTeamValues
export type DraftTeamRecord<S extends DraftTeamSection = DraftTeamSection> = {
  draft_id: string
  section: S
  payload: DraftTeamValues[S]
  confirmed: boolean
  revision: string
  issued_style_numbers?: Record<string, { number: string; style_id: string }>
}

export type DraftOrderNumbers = Record<string, string>
type DraftOrderPreview = { prefix: string | null; numbers: DraftOrderNumbers }

export async function previewDraftOrderNumbers(draftId: string) {
  return diagnosticOperation('app', 'draft_order_number_preview', trace => trace.run('load_numbers', async context => {
    const { data, error } = await tracedQuery(getSupabase().rpc('draft_order_style_number_preview', { p_draft_id: draftId }), context)
    if (error) throw error
    return data as DraftOrderPreview
  }))
}

export async function listDraftTeamWork(draftIds: string[], signal: AbortSignal) {
  const rows: DraftTeamRecord[] = []
  // At most five sections per draft. Limit the URL and stay under the API row cap.
  for (let index = 0; index < draftIds.length; index += 80) {
    const { data, error } = await getSupabase().from('draft_team_work').select()
      .in('draft_id', draftIds.slice(index, index + 80)).abortSignal(signal)
    if (error) throw error
    rows.push(...(data ?? []) as DraftTeamRecord[])
  }
  return rows
}

export async function saveDraftTeamWork<S extends DraftTeamSection>(
  draftId: string, section: S, payload: DraftTeamValues[S], confirmed: boolean, revision: string | null,
  styleNumbers?: DraftOrderNumbers,
) {
  return diagnosticOperation('app', 'save-draft-team-work', trace => trace.run('save', async context => {
    const client = getSupabase()
    const request = section === 'md-quantity' && confirmed
      ? client.rpc('confirm_draft_order_quantity', {
        p_draft_id: draftId, p_payload: payload, p_revision: revision,
        ...(styleNumbers ? { p_style_numbers: styleNumbers } : {}),
      })
      : client.rpc('save_draft_team_work', {
        p_draft_id: draftId, p_section: section, p_payload: payload, p_confirmed: confirmed, p_revision: revision,
      })
    const { data, error } = await tracedQuery(request, context)
    if (error) throw error
    const row = data?.[0] as DraftTeamRecord<S> | undefined
    if (!row) throw new Error('기획안 팀 정보를 저장하지 못했습니다.')
    return row
  }))
}
