import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {transform} from 'esbuild'
import * as core from '../supabase/functions/_shared/styled-image-core.ts'

const source=await readFile('supabase/functions/styled-image/index.ts','utf8')
const {code}=await transform(source,{loader:'ts',format:'cjs',target:'es2022'})
async function probe({allowed=false,active=true,spoof=false,grantFailure=false,authorization=true}={}){
 let handler,providerCalls=0
 const actor='10000000-0000-4000-8000-000000000005'
 const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{status:active?'active':'pending',company_id:'e0000000-0000-4000-8000-000000000001'},error:null})}),rpc:async name=>{assert.equal(name,'get_my_basic_work_access');return {data:{profileId:spoof?'different-actor':actor,domains:allowed?['design']:[]},error:grantFailure?{message:'lookup failed'}:null}}}
 const imports={'npm:@supabase/supabase-js@2.112.2':{createClient:()=>client},'../_shared/styled-image-core.ts':core,'../_shared/cors.ts':{corsHeaders:{}},'../_shared/styled-director.ts':{},'../_shared/styled-image-job.ts':{}}
 const module={exports:{}}
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert.ok(imports[name],name);return imports[name]},Deno:{serve:fn=>{handler=fn},env:{get:()=>''}},Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,Date,console:{...console,warn:()=>{},error:()=>{}},fetch:async()=>{providerCalls++;throw Error('Provider calls are outside this authorization test')}},{filename:'styled-image-auth-test'})
 const response=await handler(new Request('http://local.invalid',{method:'POST',headers:authorization?{Authorization:'Bearer local-fixture'}:{},body:JSON.stringify({action:'models'})}))
 assert.equal(providerCalls,0)
 return response
}
assert.equal((await probe({allowed:true})).status,200,'A newly allowed designer/operator can reach the existing models action without is_admin or legacy capabilities')
assert.equal((await probe()).status,403)
assert.equal((await probe({allowed:true,active:false})).status,403)
assert.equal((await probe({allowed:true,spoof:true})).status,403,'Never carry an operator response into another employee session')
assert.notEqual((await probe({allowed:true,grantFailure:true})).status,200,'Permission lookup errors must fail closed')
assert.equal((await probe({allowed:true,authorization:false})).status,401)
console.log('basic-work-edge: actual styled-image handler accepts basic design rights; rejects missing/other-actor/inactive/lookup failure/anonymous; zero provider requests')
