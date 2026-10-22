import { getSupabase } from './client'
import type { IpReviewStatus } from '../company/access-ip'

export type AccessIpEvent = { id: string; user_id: string; person_name: string; event_kind: 'login' | 'clock_in_request'; ip_address: string | null; ip_source: string; created_at: string }
export type OfficeIpReview = { ip_address: string; status: IpReviewStatus; note: string; reviewed_at: string }
export const ACCESS_IP_PAGE_SIZE = 50

/** 관찰 실패를 업무 실패로 전파하지 않는다. 출근 mutation에서 await하지 않는다. */
export async function recordAccessIp(kind: AccessIpEvent['event_kind']): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().functions.invoke('access-ip-record', {
      body: { kind, ...(kind === 'clock_in_request' ? { requestId: crypto.randomUUID() } : {}) },
    })
    if (error || !data?.ok) throw new Error(error?.message || '기록 서버 응답 오류')
    return true
  } catch (error) {
    console.warn('[access-ip] IP 기록 실패 · 로그인과 출근은 계속 진행', { kind, message: error instanceof Error ? error.message : 'unknown' })
    return false
  }
}

export async function canReviewAccessIp(): Promise<boolean> {
  const { data, error } = await getSupabase().from('access_ip_reviewers').select('profile_id').limit(1)
  if (error) throw new Error('IP 기록 조회 권한을 확인하지 못했습니다.')
  return Boolean(data?.length)
}
export async function listAccessIpEvents(from: string, until: string, kind: string, page: number) {
  let query = getSupabase().from('access_ip_events')
    .select('id,user_id,person_name,event_kind,ip_address,ip_source,created_at')
    .gte('created_at', `${from}T00:00:00+09:00`).lt('created_at', `${until}T00:00:00+09:00`)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
  if (kind) query = query.eq('event_kind', kind)
  const { data, error } = await query.range(page * ACCESS_IP_PAGE_SIZE, (page + 1) * ACCESS_IP_PAGE_SIZE)
  if (error) throw new Error('접속·출근 IP 기록을 불러오지 못했습니다.')
  return (data ?? []) as AccessIpEvent[]
}
export async function listOfficeIpReviews(ips: string[]): Promise<OfficeIpReview[]> {
  if (!ips.length) return []
  const { data, error } = await getSupabase().from('office_ip_reviews').select('ip_address,status,note,reviewed_at').in('ip_address', ips)
  if (error) throw new Error('회사 IP 확인 표시를 불러오지 못했습니다.')
  return (data ?? []) as OfficeIpReview[]
}
export async function saveOfficeIpReview(ip: string, status: IpReviewStatus, note: string, actorId: string) {
  const { error } = await getSupabase().from('office_ip_reviews')
    .upsert({ ip_address: ip, status, note: note.trim(), reviewed_by: actorId }, { onConflict: 'ip_address' })
  if (error) throw new Error('회사 IP 확인 표시를 저장하지 못했습니다.')
}
