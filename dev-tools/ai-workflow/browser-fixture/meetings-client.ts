// 격리된 브라우저 검증 서버 전용. 운영 앱에서 import하지 않는다.
import { MEETING_ROOMS, seriesToDrafts, type MeetingSeries } from '@/features/meetings/meeting-schedule'
const key='atelier:meeting-fixture'
const host={id:'fixture-user',name:'화면 검수'},member={id:'other-user',name:'검증 동료'}
const actor=new URLSearchParams(location.search).has('meeting-member')?member.id:host.id
type State={series:MeetingSeries[];files:Record<string,{path:string;text:string;name:string;roundId:string}>;audit:string[];read?:string[];failNext?:boolean}
function state():State {
 const saved=sessionStorage.getItem(key)
 if(saved)return JSON.parse(saved)
 const initial={series:[{id:'fixture-meeting',revision:1,title:'회의 저장 검증',host,members:[member],status:'in_progress' as const,durationMinutes:60,rounds:[{id:'fixture-round',round:1,roomId:'room-1',startsAt:'2030-01-07T10:00',quarterId:'q1' as const,prepMaterials:[],content:'기존 회의록',result:'기존 결과'}]}],files:{},audit:[]}
 save(initial);return initial
}
function save(value:State){sessionStorage.setItem(key,JSON.stringify(value))}
export function meetingFixtureRpc(name:string,args:Record<string,unknown>={}) {
 if(name==='list_meeting_cleanup_paths')return Promise.resolve({data:[],error:null})
 if(name==='finish_meeting_cleanup')return Promise.resolve({data:null,error:null})
 if(!['list_company_meetings','list_meeting_directory','list_meeting_calendar','list_my_meeting_invitations','read_meeting_invitation','save_company_meeting','confirm_company_meeting','respond_to_meeting','open_meeting_group','open_direct_chat','delete_company_meeting','begin_meeting_file','finish_meeting_file','remove_meeting_file'].includes(name))return null
 const value=state();let data:unknown
 if(name==='list_company_meetings')data=value.series.filter(series=>series.phase!=='preparing'||series.host.id===actor||series.createdBy===actor)
 else if(name==='list_meeting_directory')data=[host,member]
 else if(name==='list_meeting_calendar')data=seriesToDrafts(value.series)
 else if(name==='list_my_meeting_invitations')data=value.series.filter(series=>series.phase==='published'&&series.members.some(person=>person.id===actor)).flatMap(series=>series.rounds.filter(round=>round.confirmed).map(round=>({id:round.id,kind:'meeting_invitation',title:series.title+' · 참석 요청',body:'확정된 일정에 참석 가능·불가로 답해 주세요.',href:`/settings/profile?part=meetings&meeting=${series.id}&round=${round.id}`,createdAt:'2026-10-21T00:00:00Z',readAt:value.read?.includes(round.id)?'2026-10-21T01:00:00Z':null})))
 else {
  if(value.failNext){value.failNext=false;save(value);return Promise.resolve({data:null,error:{message:'검증용 저장 실패'}})}
  value.audit.push(name)
  if(name==='read_meeting_invitation')value.read=[...(value.read??[]),args.p_id as string]
  else if(name==='open_meeting_group'||name==='open_direct_chat')data='fixture-room'
  else if(name==='respond_to_meeting'){
   for(const series of value.series)for(const round of series.rounds)if(round.id===args.p_round)round.responses=[...(round.responses??[]).filter(response=>response.profileId!==actor),{profileId:actor,status:args.p_status as 'available'|'unavailable'}]
  }else if(name==='save_company_meeting'||name==='confirm_company_meeting'){
   const next=args.p_series as MeetingSeries,previous=value.series.find(item=>item.id===next.id)
   if((previous?.revision ?? 0)!==args.p_revision)return Promise.resolve({data:null,error:{message:'다른 사람이 회의를 수정했습니다.'}})
   data=(previous?.revision ?? 0)+1
   if(name==='confirm_company_meeting'){
    next.phase='published';const round=next.rounds.find(row=>row.id===args.p_round)!
    round.confirmed=true;round.scheduleVersion=(previous?.rounds.find(row=>row.id===round.id)?.scheduleVersion??0)+1
    round.responses=next.members.map(person=>({profileId:person.id,status:'pending'}))
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
