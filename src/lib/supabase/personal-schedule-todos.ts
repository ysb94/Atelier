import { getSupabase } from './client'
import { readScheduleTodos, scheduleTodoError, type ScheduleTodo } from '@/features/settings/personal-schedule-todos'

type Row = { client_id: string; date: string; title: string; done: boolean; important: boolean; start_time: string|null; end_time: string|null }
const COLUMNS = 'client_id,date,title,done,important,start_time,end_time'
const imported = new Map<string, Promise<void>>()
const payload = (owner: string, company: string, item: ScheduleTodo) => ({ owner_id: owner, company_id: company, client_id: item.id, date: item.date, title: item.title.trim(), done: item.done, important: item.important ?? false, start_time: item.start || null, end_time: item.end || null })
const fromRow = (row: Row): ScheduleTodo => ({ id: row.client_id, date: row.date, title: row.title, done: row.done, important: row.important, start: row.start_time?.slice(0,5) || '', end: row.end_time?.slice(0,5) || '' })
function fail(error: {message: string}): never {
  console.warn('[schedule-todos] DB 요청 실패', { message: error.message })
  throw new Error(/personal_schedule_todos|schema cache/i.test(error.message) ? 'To-do 공용 저장 설정이 아직 적용되지 않았습니다. 기존 개인 To-do는 그대로 보관 중입니다.' : error.message)
}
export async function listScheduleTodos(owner: string, company: string, month: string): Promise<ScheduleTodo[]> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('조회할 달을 확인해 주세요.')
  // DB 연결부터 확인한다. 미적용 상태에서 기존 로컬 기록을 옮기거나 지우지 않는다.
  const { error: ready } = await getSupabase().from('personal_schedule_todos').select('id').eq('owner_id',owner).limit(1)
  if (ready) fail(ready)
  const key = `${company}:${owner}`
  if (!imported.has(key)) {
    const task = (async () => {
      const legacy = readScheduleTodos(owner)
      if (!legacy.length) return
      for (let at = 0; at < legacy.length; at += 200) {
        const { error } = await getSupabase().from('personal_schedule_todos').upsert(legacy.slice(at,at+200).map(item=>payload(owner,company,item)), { onConflict:'owner_id,client_id', ignoreDuplicates:true })
        if (error) fail(error)
      }
    })()
    imported.set(key,task)
    task.catch(()=>{ imported.delete(key) })
  }
  await imported.get(key)
  const [year,number] = month.split('-').map(Number)
  const end = new Date(Date.UTC(year,number,1)).toISOString().slice(0,10), rows: Row[] = []
  for (let at=0;;at+=500) {
    const { data, error } = await getSupabase().from('personal_schedule_todos').select(COLUMNS).eq('owner_id',owner).is('deleted_at',null)
      .gte('date',month+'-01').lt('date',end).order('date').order('start_time').order('client_id').range(at,at+499)
    if (error) fail(error)
    const page = data as Row[]
    rows.push(...page)
    if (page.length<500) return rows.map(fromRow)
  }
}
export async function saveScheduleTodo(owner: string, company: string, item: ScheduleTodo, existing: boolean) {
  const problem = scheduleTodoError({ ...item, start:item.start ?? '', end:item.end ?? '', important:item.important ?? false })
  if (problem) throw new Error(problem)
  const values = payload(owner,company,item)
  const request = existing
    ? getSupabase().from('personal_schedule_todos').update({ date:values.date,title:values.title,done:values.done,important:values.important,start_time:values.start_time,end_time:values.end_time }).eq('owner_id',owner).eq('client_id',item.id).is('deleted_at',null)
    : getSupabase().from('personal_schedule_todos').insert(values)
  const { data, error } = await request.select(COLUMNS).single()
  if (error) fail(error)
  return fromRow(data as Row)
}
export async function deleteScheduleTodo(owner: string, id: string) {
  const { data, error } = await getSupabase().from('personal_schedule_todos').update({ deleted_at:new Date().toISOString() }).eq('owner_id',owner).eq('client_id',id).is('deleted_at',null).select('id').single()
  if (error) fail(error)
  if (!data) throw new Error('이미 변경된 To-do입니다. 다시 불러와 주세요.')
}
