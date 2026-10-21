import { getSupabase as general } from './client'
import { getSupabase as usage } from './usage-headers-client'
import { permissionFixtureRpc } from './permission-settings-client'
import { meetingFixtureRpc,meetingFixtureRooms,meetingFixtureStorage,meetingFixtureChannel } from './meetings-client'
export const isSupabaseConfigured = () => true
export function getSupabase() {
  const base = general()
  if (location.pathname === '/usage-codes') return { ...usage(), channel: base.channel, removeChannel: base.removeChannel }
  return { ...base,channel:(name:string)=>name.startsWith('meeting-notices:')?meetingFixtureChannel():base.channel(),removeChannel:async(channel:any)=>{if(channel.close){channel.close();return 'ok'}return base.removeChannel()},storage:{...(base as any).storage,from:(name:string)=>name==='company-meetings'?meetingFixtureStorage.from():(base as any).storage.from(name)},from:(name:string)=>name==='meeting_rooms'?meetingFixtureRooms():base.from(name),rpc(name: string, args?: Record<string, unknown>) {
    const meetings=meetingFixtureRpc(name,args)
    if(meetings)return meetings
    const permissions = permissionFixtureRpc(name,args)
    if (permissions) return permissions
    if (name === 'mark_chat_room_read') return Promise.resolve({ data: null, error: null })
    if (name !== 'list_my_approval_requests') return base.rpc(name, args)
    const data = ['fixture-user', 'other-user'].map((employee_id, index) => ({
      id: `request-${index}`, employee_id, employee_name: index ? '검증 동료' : '화면 검수', department_id: null, department_name: '기획팀',
      kind: 'annual', from_date: '2026-10-20', to_date: '2026-10-20', start_time: '09:00', end_time: '18:00', status: 'pending', created_at: '2026-10-20T00:00:00Z', note: '',
    }))
    const chain = { order: () => chain, range: () => chain, then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) }
    return chain
  } }
}
