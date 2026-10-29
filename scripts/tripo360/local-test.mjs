// Local-only one-shot Tripo test. No key or paid endpoint is exposed to browsers.
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createLibrary } from './library.mjs'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dir = path.join(root, '.tmp/tripo360')
await fs.mkdir(dir, { recursive: true })
const journal = path.join(dir, 'task.json')
const save = value => fs.writeFile(journal, JSON.stringify(value, null, 2))
const load = async () => { try { return JSON.parse(await fs.readFile(journal, 'utf8')) } catch(e) { if(e.code==='ENOENT')return null; throw e } }
async function generate(inputFiles, outputDir=dir) {
  const dir=outputDir,journal=path.join(dir,'task.json');await fs.mkdir(dir,{recursive:true});const save=value=>fs.writeFile(journal,JSON.stringify(value,null,2));const load=async()=>{try{return JSON.parse(await fs.readFile(journal,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
  const env = Object.fromEntries((await fs.readFile(path.join(root,'.env.local'),'utf8')).split(/\r?\n/).filter(s=>s.trim()&&!s.trim().startsWith('#')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1).trim().replace(/^(['"])(.*)\1$/,'$2')]}))
  const key=env.TRIPO_API_KEY
  if(!key?.startsWith('tsk_'))throw Error('TRIPO_API_KEY 설정을 확인하세요. 값은 출력하지 않습니다.')
  const base='https://openapi.tripo3d.ai/v3'
  async function api(route,options={}) {
    const response=await fetch(base+route,{...options,headers:{Authorization:`Bearer ${key}`,...options.headers},signal:AbortSignal.timeout(120000)})
    if(!response.ok)throw Error(`Tripo HTTP ${response.status}; 자동 재요청하지 않습니다.`)
    const body=await response.json();if(body.code!==0)throw Error(`Tripo 오류 코드 ${body.code}; 자동 재요청하지 않습니다.`)
    return body.data
  }
  let state=await load()
  if(!state) {
    const args=inputFiles??process.argv.slice(process.argv.indexOf('--generate')+1)
    if(args.length!==4)throw Error('--generate 뒤에 앞·오른쪽·뒤·왼쪽 사진 네 경로가 필요합니다.')
    const images=[]
    for(const filename of args){const bytes=await fs.readFile(filename);if(bytes.length>20*1024*1024||!/^\xff\xd8/.test(bytes.toString('latin1').slice(0,2))&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('20MB 이하 JPG/PNG 원본을 사용하세요.');images.push({bytes,name:path.basename(filename)})}
    // Exclusive reservation precedes any paid submission. Ambiguous submission is never repeated.
    const handle=await fs.open(journal,'wx');await handle.writeFile(JSON.stringify({status:'reserved',createdAt:new Date().toISOString()}));await handle.close()
    const tokens=[]
    for(const image of images){const form=new FormData();form.set('file',new Blob([image.bytes]),image.name);tokens.push((await api('/files',{method:'POST',body:form})).file_token)}
    if(tokens.some(t=>!t))throw Error('파일 업로드 토큰을 확인하지 못했습니다.')
    const request={inputs:[{front:tokens[0]},{right:tokens[1]},{back:tokens[2]},{left:tokens[3]}],model:'v3.1-20260211',texture:true,pbr:true,texture_quality:'standard'}
    await save({status:'submitting',createdAt:new Date().toISOString(),model:request.model})
    const task=await api('/generation/multiview-to-model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)})
    if(!task.task_id)throw Error('작업 ID 응답 없음. 다시 생성하지 마세요.')
    state={status:'queued',taskId:task.task_id,model:request.model};await save(state)
    console.log('3D 생성 1회 접수. 이후에는 같은 작업만 조회합니다.')
  }
  if(!state.taskId)throw Error('이전 접수 상태가 불확실합니다. 중복 과금을 막기 위해 새 생성은 차단했습니다.')
  for(let attempt=0;attempt<180;attempt++) {
    const task=await api('/tasks/'+encodeURIComponent(state.taskId));state={...state,status:task.status,progress:task.progress,credits:task.credits_consumed??task.consumed_credit??null};await save(state)
    console.log('Tripo 상태:',state.status,state.progress??'')
    if(['failed','cancelled','banned','expired'].includes(task.status))throw Error('Tripo 작업 종료: '+task.status+'; 새 생성하지 않습니다.')
    if(task.status==='success') {
      const url=task.output?.model_url??task.output?.pbr_model??task.output?.model
      if(typeof url!=='string')throw Error('완성 모델 주소를 찾지 못했습니다.')
      if(!await fs.stat(path.join(dir,'model.glb')).catch(()=>null)) {
        const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('모델 URL 형식 오류')
        const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('모델 다운로드 실패. 같은 작업 조회로 재시도할 수 있습니다.')
        const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>150*1024*1024||bytes.toString('ascii',0,4)!=='glTF')throw Error('GLB 형식·크기 확인 실패')
        await fs.writeFile(path.join(dir,'model.glb'),bytes)
      }
      console.log('완료. 실제 차감 크레딧:',state.credits,'모델은 로컬에 저장했습니다.');return
    }
    await new Promise(r=>setTimeout(r,10000))
  }
  throw Error('대기 시간 종료. 같은 명령으로 기존 작업 조회만 재개할 수 있습니다.')
}
async function serve() {
  const assets={ 'three.module.js':'build/three.module.js','three.core.js':'build/three.core.js','GLTFLoader.js':'examples/jsm/loaders/GLTFLoader.js','BufferGeometryUtils.js':'examples/jsm/utils/BufferGeometryUtils.js' }
  for(const [name,remote] of Object.entries(assets))if(!await fs.stat(path.join(dir,name)).catch(()=>null)){const response=await fetch('https://cdn.jsdelivr.net/npm/three@0.180.0/'+remote);if(!response.ok)throw Error('3D 뷰어 라이브러리 다운로드 실패');let text=await response.text();if(name==='GLTFLoader.js')text=text.replace('../utils/BufferGeometryUtils.js','./BufferGeometryUtils.js');await fs.writeFile(path.join(dir,name),text)}
  const library=await createLibrary({root,dir,generate});
  const routes=new Map([['/',[path.join(root,'scripts/tripo360/viewer.template'),'text/html; charset=utf-8']],['/model.glb',[path.join(dir,'model.glb'),'model/gltf-binary']],['/status',[journal,'application/json']],['/jszip.js',[path.join(root,'node_modules/jszip/dist/jszip.min.js'),'text/javascript']],...Object.keys(assets).map(name=>['/'+name,[path.join(dir,name),'text/javascript']])])
  http.createServer(async(req,res)=>{try{if(await library(req,res))return;if(req.method!=='GET') {res.writeHead(405);res.end();return}const entry=routes.get(new URL(req.url,'http://127.0.0.1:4320').pathname);if(!entry){res.writeHead(404);res.end();return}const content=await fs.readFile(entry[0]);res.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:"});res.end(content)}catch(e){console.warn('[tripo360] 로컬 결과 조회 실패',e.code??e.name);res.writeHead(404);res.end('아직 로컬 결과가 없습니다.')}}).listen(4320,'127.0.0.1',()=>console.log('로컬 3D 검수: http://127.0.0.1:4320/ (로컬 전용 · 키 미노출)'))
}
if(process.argv.includes('--generate'))await generate()
else if(process.argv.includes('--serve'))await serve()
else console.log('사용: node scripts/tripo360/local-test.mjs --generate 앞.jpg 오른쪽.jpg 뒤.jpg 왼쪽.jpg 또는 --serve')
