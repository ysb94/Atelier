import fs from 'node:fs/promises'
import path from 'node:path'
const allowedOrigins=new Set(['http://127.0.0.1:4320','http://localhost:4320','http://localhost:5173','http://127.0.0.1:5173'])
const valid=id=>typeof id==='string'&&/^[a-z0-9-]{8,64}$/.test(id)
const getJson=async(file,fallback=null)=>{try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
const putJson=(file,data)=>fs.writeFile(file,JSON.stringify(data,null,2))
export async function createLibrary({root,dir,generate}) {
 const folder=path.join(dir,'library');await fs.mkdir(folder,{recursive:true})
 const legacy='local-bag-20261029',legacyDir=path.join(folder,legacy)
 if(!await fs.stat(legacyDir).catch(()=>null)&&await fs.stat(path.join(dir,'model.glb')).catch(()=>null)) {
  await fs.mkdir(legacyDir);await fs.copyFile(path.join(dir,'model.glb'),path.join(legacyDir,'model.glb'));await fs.copyFile(path.join(dir,'task.json'),path.join(legacyDir,'task.json'))
  const names=['KakaoTalk_20261029_110255119.jpg','KakaoTalk_20261029_110255119_03.jpg','KakaoTalk_20261029_110255119_02.jpg','KakaoTalk_20261029_110255119_01.jpg']
  for(let i=0;i<4;i++)await fs.copyFile(path.join('C:/Users/dbstj/Downloads',names[i]),path.join(legacyDir,`original-${i}.jpg`))
  for(let i=0;i<70;i++)await fs.copyFile(path.join(dir,`view-${String(i).padStart(3,'0')}.png`),path.join(legacyDir,`frame-${i}.png`))
  await putJson(path.join(legacyDir,'meta.json'),{id:legacy,title:'체크 백팩 · 3D 테스트',createdAt:new Date().toISOString(),originals:names.map((_,i)=>`original-${i}.jpg`),frameCount:70})
 }
 const fileFor=(id,name)=>path.join(folder,id,name)
 const state=async id=>({...await getJson(fileFor(id,'meta.json'),{}),...await getJson(fileFor(id,'task.json'),{status:'queued'})})
 async function body(req){let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>72*1024*1024)throw Error('요청 용량이 큽니다. 사진은 각 8MB 이하로 선택하세요.');parts.push(part)}return JSON.parse(Buffer.concat(parts).toString())}
 const running=new Set()
 return async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4320'),parts=url.pathname.split('/').filter(Boolean)
  if(url.pathname==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({tool:'atelier-tripo-local',root}));return true}
  if(url.pathname!=='/jobs'&&parts[0]!=='job')return false
  const origin=req.headers.origin
  if(origin&&!allowedOrigins.has(origin)){res.writeHead(403);res.end('Forbidden');return true}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
  res.setHeader('Cache-Control','no-store')
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return true}
  const json=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
  try{
   if(req.method==='POST'&&!origin)throw Error('사이트 화면에서 요청해 주세요.')
   if(url.pathname==='/jobs'&&req.method==='GET'){const entries=await fs.readdir(folder);json(await Promise.all(entries.filter(valid).map(state)));return true}
   if(url.pathname==='/jobs'&&req.method==='POST'){
    const input=await body(req);if(!valid(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>100||!Array.isArray(input.photos)||input.photos.length!==4)throw Error('제품 이름과 앞·오른쪽·뒤·왼쪽 사진 네 장을 확인하세요.')
    const target=path.join(folder,input.id);if(await fs.stat(target).catch(()=>null)){json(await state(input.id));return true}
    const photos=input.photos.map((data,i)=>{const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+=*)$/.exec(data);if(!m)throw Error('JPG·PNG 사진이 필요합니다.');const bytes=Buffer.from(m[2],'base64');if(bytes.length>8*1024*1024)throw Error('사진은 각 8MB 이하로 선택하세요.');return {name:`original-${i}.${m[1]==='png'?'png':'jpg'}`,bytes}})
    await fs.mkdir(target);for(const p of photos)await fs.writeFile(path.join(target,p.name),p.bytes)
    await putJson(path.join(target,'meta.json'),{id:input.id,title:input.title.trim(),createdAt:new Date().toISOString(),originals:photos.map(p=>p.name),frameCount:0})
    running.add(input.id);generate(photos.map(p=>path.join(target,p.name)),target).catch(async error=>{console.warn('[tripo360] 생성 작업 실패',{id:input.id,name:error.name});const task=await getJson(path.join(target,'task.json'),{});await putJson(path.join(target,'task.json'),{...task,status:'error',message:'생성 연결을 확인하지 못했습니다. 접수 이력을 확인한 뒤 기존 작업만 조회하세요.'})}).finally(()=>running.delete(input.id))
    json(await state(input.id),202);return true
   }
   const [,id,action]=parts;if(!valid(id))throw Error('잘못된 결과 ID입니다.')
   if(req.method==='GET'&&action==='status'){json(await state(id));return true}
   if(req.method==='GET'&&(action==='model.glb'||/^original-[0-3]\.(jpg|png)$/.test(action))){const bytes=await fs.readFile(fileFor(id,action));res.writeHead(200,{'Content-Type':action==='model.glb'?'model/gltf-binary':action.endsWith('.png')?'image/png':'image/jpeg',...(action==='model.glb'&&url.searchParams.get('download')==='1'?{'Content-Disposition':'attachment; filename="model.glb"'}:{})});res.end(bytes);return true}
   if(req.method==='POST'&&action==='resume'){if(!running.has(id)){const task=await getJson(fileFor(id,'task.json'));if(!task?.taskId)throw Error('접수 ID가 없어 자동 재생성하지 않습니다.');running.add(id);generate([],path.join(folder,id)).catch(e=>console.warn('[tripo360] 기존 작업 조회 실패',{id,name:e.name})).finally(()=>running.delete(id))}json({ok:true});return true}
   json({error:'지원하지 않는 요청입니다.'},405)
  }catch(e){console.warn('[tripo360] 로컬 작업 처리 실패',{name:e.name});json({error:e.message},400)}
  return true
 }
}
