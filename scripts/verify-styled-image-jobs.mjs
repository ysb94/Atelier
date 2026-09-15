import assert from 'node:assert/strict'
import { createImageJob, readImageJob, openAiBackgroundImageBody, readBackgroundImage } from '../supabase/functions/_shared/styled-image-job.ts'
import { PendingStudioImageError, waitForStudioImage } from '../src/lib/design/studio-job-polling.ts'
const secret='local-test-secret-not-an-api-key'
const job=await createImageJob('resp_test123','user-a','gpt-image-2',secret,1000)
assert.equal((await readImageJob(job.token,'user-a',secret,2000)).id,'resp_test123')
await assert.rejects(readImageJob(job.token,'user-b',secret,2000))
await assert.rejects(readImageJob(job.token,'user-a','different',2000))
await assert.rejects(readImageJob(job.token,'user-a',secret,31*60_000))
await assert.rejects(readImageJob(job.token+'x','user-a',secret,2000))
const req={modelId:'gpt-image-2',prompt:'사진 7의 가방을 펼쳐줘',ratio:'1:1',images:[{name:'사진 7',role:'요청 참고',data:'data:image/png;base64,aGVsbG8='}],settings:{resolution:'2K',quality:'high'}}
const body=openAiBackgroundImageBody(req)
assert.equal(body.background,true);assert.equal(body.store,false)
assert.equal(body.tools[0].model,'gpt-image-2');assert.equal(body.tools[0].size,'2048x2048');assert.equal(body.tools[0].quality,'high')
assert.equal(body.tool_choice.type,'image_generation')
assert.equal(body.input[0].content[1].text,'사진 7: 요청 참고')
assert.equal(body.input[0].content[2].image_url,req.images[0].data)
const finished=readBackgroundImage({status:'completed',output:[{type:'image_generation_call',status:'completed',result:'aGVsbG8='}]},job,5000)
assert.equal(finished.result.data,'data:image/png;base64,aGVsbG8=')
assert.equal(readBackgroundImage({status:'failed'},job).status,'failed')
assert.equal(readBackgroundImage({status:'completed',output:[]},job).status,'failed')
let now=0;let calls=0
const result=await waitForStudioImage(job,async()=>{calls++;return now<180000?{status:'in_progress',job}:finished},{now:()=>now,sleep:async ms=>{now+=ms}})
assert.equal(result.data,finished.result.data);assert.ok(now>=180000,'generation survives old 120-second limit')
assert.ok(calls>30)
let failure
try { await waitForStudioImage(job,async()=>{throw new Error('network lost')},{sleep:async()=>{}}) } catch(e){failure=e}
assert.ok(failure instanceof PendingStudioImageError);assert.equal(failure.job.token,job.token)
assert.equal((await waitForStudioImage(failure.job,async()=>finished)).data,finished.result.data,'resume reads existing job')
await assert.rejects(waitForStudioImage(job,async()=>({status:'failed',error:'provider stopped'})),/provider stopped/)
console.log('styled-image jobs: authenticated tokens, unchanged model/quality, 3-minute polling, recovery without generation and terminal failure passed')
