// 격리된 브라우저 검증 서버 전용. 운영 앱에서 import하지 않는다.
import { MEETING_ROOMS, seriesToDrafts, type MeetingSeries } from '@/features/meetings/meeting-schedule'
const key='atelier:meeting-fixture'
const host={id:'fixture-user',name:'화면 검수'},member={id:'other-user',name:'검증 동료'}
const actor=new URLSearchParams(location.search).has('meeting-member')?member.id:host.id
export function meetingFixtureLunch(){
 const query={select(){return query},maybeSingle(){return query},then(resolve:(value:unknown)=>unknown){
  const setting=JSON.parse(sessionStorage.getItem('atelier:meeting-lunch-fixture')??'null')
  return Promise.resolve({data:setting?.error?null:setting,error:setting?.error?{message:'검증용 점심시간 조회 실패'}:null}).then(resolve)
 }};return query
}
type State={roundRoles?:boolean;series:MeetingSeries[];files:Record<string,{path:string;text:string;name:string;roundId:string}>;audit:string[];read?:string[];hostReads?:string[];failNext?:boolean;notices?:any[];availability?:any[];participation?:{profile_id:string;titles:string[]}[];participationError?:boolean}
function state():State {
 const saved=sessionStorage.getItem(key)
 if(saved)return JSON.parse(saved)
 const initial={series:[{id:'fixture-meeting',revision:1,title:'회의 저장 검증',host,members:[member],status:'in_progress' as const,durationMinutes:60,rounds:[{id:'fixture-round',round:1,roomId:'room-1',startsAt:'2030-01-07T10:00',quarterId:'q1' as const,prepMaterials:[],content:'기존 회의록',result:'기존 결과'}]}],files:{},audit:[]}
 save(initial);return initial
}
function save(value:State){const saved=JSON.stringify(value);sessionStorage.setItem(key,saved);localStorage.setItem(key,saved);window.dispatchEvent(new Event('fixture-meeting-change'))}
export function meetingFixtureNotificationReads(){
 let reader=actor
 const q={select:()=>q,eq:(_key:string,id:string)=>{reader=id;return q},like:()=>q,then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:reader===actor?(state().hostReads??[]).map(event_key=>({event_key})):[],error:null}).then(resolve)}
 return q
}
export function meetingFixtureChannel(){
 const callbacks:Array<()=>void>=[]
 const changed=(event:StorageEvent)=>{if(event.key===key&&event.newValue){sessionStorage.setItem(key,event.newValue);callbacks.forEach(callback=>callback())}}
 const local=()=>callbacks.forEach(callback=>callback())
 const channel={on:(event:string,_filter:unknown,callback:()=>void)=>{if(event==='postgres_changes')callbacks.push(callback);return channel},subscribe:(callback:(status:string)=>void)=>{window.addEventListener('storage',changed);window.addEventListener('fixture-meeting-change',local);callback('SUBSCRIBED');return channel},close:()=>{window.removeEventListener('storage',changed);window.removeEventListener('fixture-meeting-change',local)}}
 return channel
}
export function meetingFixtureRpc(name:string,args:Record<string,unknown>={}) {
 if(name==='list_meeting_cleanup_paths')return Promise.resolve({data:[],error:null})
 if(name==='finish_meeting_cleanup')return Promise.resolve({data:null,error:null})
 if(!['set_meeting_round_people','publish_meeting_result','read_meeting_round_notice','list_meeting_member_participation','list_meeting_availability','list_meeting_availability_with_todos','list_company_meetings','list_meeting_directory','list_meeting_calendar','list_my_meeting_invitations','read_meeting_invitation','read_meeting_notice_version','confirm_my_home_host_notice','save_company_meeting','confirm_company_meeting','manually_confirm_meeting_round','respond_to_meeting','open_meeting_group','open_direct_chat','delete_company_meeting','begin_meeting_file','finish_meeting_file','remove_meeting_file'].includes(name))return null
 const value=state();let data:unknown
 if(name==='list_meeting_member_participation'){
  if(value.participationError)return Promise.resolve({data:null,error:{message:'검증용 제목 조회 실패'}})
  const map=new Map<string,string[]>()
  for(const series of value.series)if(series.status==='in_progress'&&series.phase!=='preparing'&&series.rounds.some(round=>round.confirmed!==false)){
   for(const id of new Set([series.host.id,...series.members.map(person=>person.id)]))map.set(id,[...(map.get(id)??[]),series.title])
  }
  return Promise.resolve({data:value.participation??[...map].map(([profile_id,titles])=>({profile_id,titles})),error:null})
 }
 if(name==='list_meeting_availability'||name==='list_meeting_availability_with_todos')data=(value.availability??[]).filter(row=>(args.p_people as string[]).includes(row.personId)&&(!row.date||row.date===args.p_date))
 else if(name==='list_company_meetings')data=value.series.filter(series=>series.phase!=='preparing'||series.host.id===actor||series.createdBy===actor).map(series=>({...series,manualConfirmationReady:series.manualConfirmationReady ?? true}))
 else if(name==='list_meeting_directory')data=value.roundRoles?[host,member,{id:'extra-user',name:'추가 직원'}]:[host,member]
 else if(name==='list_meeting_calendar')data=seriesToDrafts(value.series)
 else if(name==='list_my_meeting_invitations')data=[...value.series.filter(series=>series.phase==='published'&&series.members.some(person=>person.id===actor)).flatMap(series=>series.rounds.filter(round=>round.confirmed&&(!round.membership||round.membership.some(p=>p.person.id===actor&&p.role==='attendee'))).map(round=>({id:round.id,kind:'meeting_invitation',title:series.title+' · 참석 요청',body:'확정된 일정에 참석 가능·불가로 답해 주세요.',href:`/settings/profile?part=meetings&meeting=${series.id}&round=${round.id}`,createdAt:'2026-10-21T00:00:00Z',readAt:value.read?.includes(round.id)?'2026-10-21T01:00:00Z':null,meeting:{role:'member',roundId:round.id,scheduleVersion:round.scheduleVersion??1,status:round.responses?.find(response=>response.profileId===actor)?.status??'pending'}}))),...(value.notices??[]).filter(notice=>notice.recipient===actor&&value.series.some(series=>series.status==='in_progress'&&series.rounds.some(round=>notice.kind==='meeting_result'||notice.kind==='meeting_removed' ? round.id===new URL(notice.href,'https://fixture.local').searchParams.get('round') : round.id===notice.meeting.roundId&&round.scheduleVersion===notice.meeting.scheduleVersion))).map(notice=>({...notice,readAt:value.read?.includes(notice.id)?'2026-10-21T01:00:00Z':null}))]
 else {
  if(value.failNext){value.failNext=false;save(value);return Promise.resolve({data:null,error:{message:'검증용 저장 실패'}})}
  value.audit.push(name)
  if(name==='set_meeting_round_people'){
   const series=value.series.find(s=>s.rounds.some(r=>r.id===args.p_round))!,round=series.rounds.find(r=>r.id===args.p_round)!
   if(series.revision!==args.p_revision)return Promise.resolve({data:null,error:{message:'회의가 변경되었습니다.'}})
   round.membership=(args.p_people as {id:string;role:'attendee'|'result'|'excluded'}[]).map(p=>({person:[host,member,{id:'extra-user',name:'추가 직원'}].find(person=>person.id===p.id)!,role:p.role}))
   data=++series.revision!
  }else if(name==='publish_meeting_result'){
   const series=value.series.find(s=>s.rounds.some(r=>r.id===args.p_round))!,round=series.rounds.find(r=>r.id===args.p_round)!
   if(series.revision!==args.p_revision)return Promise.resolve({data:null,error:{message:'회의가 변경되었습니다.'}})
   round.sharedResults=[...(round.sharedResults??[]),{version:(round.sharedResults?.length??0)+1,body:round.result,sharedAt:'2030-01-07T03:00:00Z'}]
   data=++series.revision!
  }else if(name==='read_meeting_round_notice')value.read=[...(value.read??[]),args.p_id as string]
  else if(name==='read_meeting_notice_version'||name==='confirm_my_home_host_notice'){
   const notice=(value.notices??[]).find(item=>item.id===args.p_id&&item.recipient===actor)
   const series=value.series.find(item=>item.rounds.some(round=>round.id===(notice?.meeting.roundId??args.p_id)))
   const round=series?.rounds.find(item=>item.id===(notice?.meeting.roundId??args.p_id))
   const owns=notice||series?.members.some(person=>person.id===actor)
   if(!round||!owns||(round.scheduleVersion??1)!==args.p_schedule_version||Date.parse(String(args.p_sent_at))!==Date.parse(notice?.createdAt??'2026-10-21T00:00:00Z')||(name==='confirm_my_home_host_notice'&&!notice))return Promise.resolve({data:null,error:{message:'일정이 변경되었거나 알림 접근 권한이 없습니다.'}})
   value.read=[...(value.read??[]),args.p_id as string]
   if(name==='confirm_my_home_host_notice')value.hostReads=[...(value.hostReads??[]),`host-action:${args.p_id}`]
  }
  else if(name==='read_meeting_invitation')value.read=[...(value.read??[]),...(args.p_id?[args.p_id as string]:[...(value.notices??[]).filter(notice=>notice.recipient===actor).map(notice=>notice.id),...value.series.flatMap(series=>series.members.some(person=>person.id===actor)?series.rounds.map(round=>round.id):[])])]
  else if(name==='open_meeting_group'||name==='open_direct_chat')data='fixture-room'
  else if(name==='manually_confirm_meeting_round'){
   const series=value.series.find(s=>s.rounds.some(r=>r.id===args.p_round))!,round=series.rounds.find(r=>r.id===args.p_round)!
   if(series.host.id!==actor||series.revision!==args.p_revision||series.members.some(m=>!round.responses?.some(r=>r.profileId===m.id&&r.status!=='pending')))return Promise.resolve({data:null,error:{message:'최신 멤버 응답을 확인해 주세요.'}})
   round.manualConfirmation={excludedIds:args.p_excluded as string[],decidedAt:new Date().toISOString(),actorId:actor}
   data=series.revision=(series.revision??0)+1
  }
  else if(name==='respond_to_meeting'){
   for(const series of value.series)for(const round of series.rounds)if(round.id===args.p_round){
    const old=round.responses?.find(response=>response.profileId===actor)?.status
    round.responses=[...(round.responses??[]).filter(response=>response.profileId!==actor),{profileId:actor,status:args.p_status as 'available'|'unavailable'}]
    const all=series.members.every(person=>round.responses?.some(response=>response.profileId===person.id&&response.status==='available'))
    if(old!==args.p_status&&(args.p_status==='unavailable'||all))value.notices=[...(value.notices??[]),{id:crypto.randomUUID(),recipient:series.host.id,kind:'meeting_invitation',title:series.title+(all?' · 전원 참석 가능':' · 참석 불가 발생'),body:all?`멤버 ${series.members.length}명 모두 참석 가능합니다.`:`${series.members.find(person=>person.id===actor)?.name} · 참석 불가`,href:`/settings/profile?part=meetings&meeting=${series.id}&round=${round.id}`,createdAt:new Date().toISOString(),readAt:null,meeting:{role:'host',roundId:round.id,scheduleVersion:round.scheduleVersion,status:all?'available':'unavailable'}}]
   }
  }else if(name==='save_company_meeting'||name==='confirm_company_meeting'){
   const next=args.p_series as MeetingSeries,previous=value.series.find(item=>item.id===next.id)
   if((previous?.revision ?? 0)!==args.p_revision)return Promise.resolve({data:null,error:{message:'다른 사람이 회의를 수정했습니다.'}})
   data=(previous?.revision ?? 0)+1
   if(name==='confirm_company_meeting'){
    next.phase='published';const round=next.rounds.find(row=>row.id===args.p_round)!
    round.manualConfirmation=null;round.confirmed=true;round.scheduleVersion=(previous?.rounds.find(row=>row.id===round.id)?.scheduleVersion??0)+1
    round.responses=next.kind==='meeting'?[]:next.members.map(person=>({profileId:person.id,status:'pending'}))
    value.read=value.read?.filter(id=>id!==round.id)
   }
   value.series=[{...next,revision:data as number},...value.series.filter(item=>item.id!==next.id)]
  }else if(name==='delete_company_meeting'){
   value.series=value.series.filter(item=>item.id!==args.p_id);data=[]
  }else if(name==='begin_meeting_file'){
   const id=crypto.randomUUID(),path='fixture/'+id
   value.files[id]={path,text:'',name:args.p_name as string,roundId:args.p_round as string};data={id,path}
  }else if(name==='finish_meeting_file'){
   const id=args.p_id as string,file=value.files[id]
   for(const series of value.series)for(const round of series.rounds)if(round.id===file.roundId)round.prepMaterials.push({id,name:file.name,size:file.text.length,type:'text/plain',url:'',storagePath:file.path,uploadedBy:host})
  }else if(name==='remove_meeting_file'){
   const id=args.p_id as string;data=value.files[id]?.path
   for(const series of value.series)for(const round of series.rounds)round.prepMaterials=round.prepMaterials.filter(file=>file.id!==id)
  }
  save(value)
 }
 return Promise.resolve({data,error:null})
}
export function meetingFixtureRooms(){
 const chain={select:()=>chain,order:()=>chain,then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:MEETING_ROOMS,error:null}).then(resolve)}
 return chain
}
export const meetingFixtureStorage={from:()=>({
 upload:async(path:string,blob:Blob)=>{const value=state(),file=Object.values(value.files).find(item=>item.path===path)!;file.text=await blob.text();save(value);return {error:null}},
 remove:async(paths:string[])=>{const value=state();for(const [id,file] of Object.entries(value.files))if(paths.includes(file.path))delete value.files[id];save(value);return {error:null}},
 download:async(path:string)=>({data:new Blob([Object.values(state().files).find(file=>file.path===path)?.text ?? ''],{type:'text/plain'}),error:null}),
})}
