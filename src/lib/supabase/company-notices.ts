import {
  isCompanyNoticeSlot,
  type CompanyNotice,
  type CompanyNoticeSlotId,
} from '@/lib/company/company-notices'
import { getSupabase } from './client'

type NoticeRow = {
  id: string
  slot: string
  department_id: string | null
  title: string
  body: string
  starts_on: string | null
  ends_on: string | null
  published: boolean
  updated_at: string
}

export type CompanyNoticeInput = {
  id?: string | null
  slot: CompanyNoticeSlotId
  departmentId: string | null
  title: string
  body: string
  startsOn: string | null
  endsOn: string | null
  published: boolean
}

function mapRow(row: NoticeRow): CompanyNotice | null {
  if (!isCompanyNoticeSlot(row.slot)) {
    console.warn('[company-notices] 알 수 없는 게시 위치', { slot: row.slot, id: row.id })
    return null
  }
  return {
    id: row.id,
    slot: row.slot,
    departmentId: row.department_id,
    title: row.title,
    body: row.body,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    published: row.published,
    updatedAt: row.updated_at,
  }
}

function fail(action: string, error: { message: string }): never {
  console.warn('[company-notices] ' + action, { message: error.message })
  throw new Error(error.message)
}

export async function listCompanyNotices(slot?: CompanyNoticeSlotId): Promise<CompanyNotice[]> {
  let query = getSupabase()
    .from('company_notices')
    .select('id, slot, department_id, title, body, starts_on, ends_on, published, updated_at')
    .order('updated_at', { ascending: false })
    .order('id')
  if (slot) query = query.eq('slot', slot)
  const { data, error } = await query
  if (error) fail('공지 조회 실패', error)
  return (data as NoticeRow[]).flatMap((row) => {
    const notice = mapRow(row)
    return notice ? [notice] : []
  })
}

export async function saveCompanyNotice(input: CompanyNoticeInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('save_company_notice', {
    p_id: input.id ?? null,
    p_slot: input.slot,
    p_department_id: input.departmentId,
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_starts: input.startsOn,
    p_ends: input.endsOn,
    p_published: input.published,
  })
  if (error) fail('공지 저장 실패', error)
  if (typeof data !== 'string' || !data) throw new Error('공지를 저장하지 못했습니다.')
  return data
}

export async function deleteCompanyNotice(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_company_notice', { p_id: id })
  if (error) fail('공지 삭제 실패', error)
}
