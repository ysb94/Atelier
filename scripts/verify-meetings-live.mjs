// 명시적으로 실행하는 운영 연결 검증. 이 스크립트가 만든 UUID만 삭제한다.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
const env=loadEnv('development',process.cwd(),'')
const client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const {data:login,error:loginError}=await client.auth.signInWithPassword({email:env.VITE_DEV_LOGIN_EMAIL,password:env.VITE_DEV_LOGIN_PASSWORD})
if(loginError) throw new Error('개발용 계정 인증 실패: '+loginError.message)
const stateFile='.tmp/meeting-live-state.json'
const rpc=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw new Error(name+': '+error.message);return data}
const cleanup=async state=>{
 const series=(await rpc('list_company_meetings')).find(row=>row.id===state.seriesId)
 if(series){assert.equal(series.host.id,login.user.id);assert.equal(series.title,state.title)
  const paths=await rpc('delete_company_meeting',{p_id:series.id,p_revision:series.revision})
  if(paths.length){const {error}=await client.storage.from('company-meetings').remove(paths);assert.equal(error,null);await rpc('finish_meeting_cleanup',{p_paths:paths})}
 }
 const pending=await rpc('list_meeting_cleanup_paths')
 const own=pending.filter(path=>path===state.storagePath)
 if(own.length){const {error}=await client.storage.from('company-meetings').remove(own);assert.equal(error,null);await rpc('finish_meeting_cleanup',{p_paths:own})}
 if(state.storagePath)assert.ok((await client.storage.from('company-meetings').download(state.storagePath,{cacheNonce:crypto.randomUUID()},{cache:'no-store'})).error,'삭제된 실제 파일에 접근할 수 없음')
 console.log('meeting-live: 검증용 회의·파일 삭제 완료 (기존 데이터 변경 없음)')
}
if(process.argv.includes('--cleanup')){
 await cleanup(JSON.parse(await fs.readFile(stateFile,'utf8')))
}else if(process.argv.includes('--verify-shared')){
 const state=JSON.parse(await fs.readFile(stateFile,'utf8'))
 const series=(await rpc('list_company_meetings')).find(row=>row.id===state.seriesId)
 assert.equal(series.rounds[0].content,'참석자 계정에서 저장한 검증 회의록')
 assert.equal(series.rounds[0].prepMaterials[0].name,'회의 연결 검증.txt')
 console.log('meeting-live: 참석자의 수정 내용이 주최자에게 다시 공유됨')
}else{
 const directory=await rpc('list_meeting_directory')
 const member=directory.find(person=>person.id!==login.user.id)
 assert.ok(member,'공유를 확인할 기존 직원 필요')
 const outsider=directory.find(person=>person.id!==login.user.id && person.id!==member.id)
 const id=crypto.randomUUID(),roundId=crypto.randomUUID(),title='[검증용] 회의 저장·공유 연결 '+id.slice(0,8)
 const state={seriesId:id,roundId,hostId:login.user.id,memberId:member.id,outsiderId:outsider?.id,title}
 await fs.mkdir('.tmp',{recursive:true});await fs.writeFile(stateFile,JSON.stringify(state,null,2))
 try{
  const series={id,title,host:{id:login.user.id},members:[member],status:'in_progress',durationMinutes:30,rounds:[{id:roundId,round:1,roomId:'',startsAt:'',content:'주최자가 저장한 검증 회의록',result:'파일·공유 검사',prepMaterials:[]}]}
  assert.equal(await rpc('save_company_meeting',{p_series:series,p_revision:0}),1)
  assert.equal((await rpc('list_company_meetings')).find(row=>row.id===id).title,title)
  assert.equal((await rpc('list_company_meetings')).find(row=>row.id===id).phase,'preparing')
  const bytes=new TextEncoder().encode('회의 DB·파일 연결 검증\n')
  const file=await rpc('begin_meeting_file',{p_round:roundId,p_name:'회의 연결 검증.txt',p_type:'text/plain',p_size:bytes.byteLength})
  state.fileId=file.id;state.storagePath=file.path;await fs.writeFile(stateFile,JSON.stringify(state,null,2))
  const {error:uploadError}=await client.storage.from('company-meetings').upload(file.path,bytes,{contentType:'text/plain',upsert:false,cacheControl:'0'})
  assert.equal(uploadError,null)
  await rpc('finish_meeting_file',{p_id:file.id})
  series.rounds[0].roomId='room-1';series.rounds[0].startsAt='2030-01-07T09:00'
  let revision=await rpc('confirm_company_meeting',{p_series:series,p_revision:1,p_round:roundId})
  let shared=(await rpc('list_company_meetings')).find(row=>row.id===id)
  assert.equal(shared.phase,'published');assert.equal(shared.rounds[0].confirmed,true)
  series.rounds[0].startsAt='2030-01-07T09:30'
  revision=await rpc('confirm_company_meeting',{p_series:series,p_revision:revision,p_round:roundId})
  shared=(await rpc('list_company_meetings')).find(row=>row.id===id)
  assert.equal(shared.rounds[0].scheduleVersion,2);assert.equal(shared.rounds[0].responses[0].status,'pending')
  assert.deepEqual(await rpc('list_my_meeting_invitations'),[],'호스트 본인에게 멤버 참석 요청을 만들지 않음')
  const {data:download,error:downloadError}=await client.storage.from('company-meetings').download(file.path)
  assert.equal(downloadError,null);assert.equal(await download.text(),new TextDecoder().decode(bytes))
  const anonymous=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}})
  assert.ok((await anonymous.rpc('list_company_meetings')).error)
  assert.ok((await anonymous.storage.from('company-meetings').download(file.path)).error)
  console.log('meeting-live: 실제 API 비공개 준비 저장·확정·일정 변경/응답 초기화·재조회·한글 첨부 업로드/다운로드·비로그인 차단 통과')
  console.log(JSON.stringify({seriesId:id,roundId,hostId:state.hostId,memberId:state.memberId,outsiderId:state.outsiderId,fileId:file.id,storagePath:file.path}))
  if(process.argv.includes('--verify-flow'))await cleanup(state)
 }catch(error){await cleanup(state);throw error}
}
