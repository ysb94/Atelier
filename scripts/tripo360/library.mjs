import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
const WORKER='https://r2-worker.masmarulez-upload.workers.dev'
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
 const running=new Set(),publishing=new Set()
 async function publish(id){
  if(publishing.has(id))throw Error('이미 저장 중입니다.');publishing.add(id)
  try{
   const item=await state(id);if(item.status!=='success'||item.frameCount!==70)throw Error('3D 생성과 70방향 추출을 먼저 완료하세요.')
   if(item.cloud)return item.cloud
   const prefix=`spin360/tripo/${id}`,zip=new JSZip(),files=[]
   const add=async(name,local,type)=>{const bytes=await fs.readFile(local);files.push({name,bytes,type});zip.file(name,bytes)}
   await add('model.glb',fileFor(id,'model.glb'),'model/gltf-binary')
   for(const name of item.originals)await add(name,fileFor(id,name),'image/'+(name.endsWith('.png')?'png':'jpeg'))
   for(let i=0;i<70;i++)await add(`frames/${String(i).padStart(3,'0')}.png`,fileFor(id,`frame-${i}.png`),'image/png')
   const viewer='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>70방향 제품 보기</title><style>body{max-width:850px;margin:auto;font-family:system-ui;padding:12px}img,input{width:100%}</style><p>70방향 3D 회전 · 원본과 상품 디테일을 비교하세요.</p><img id="p" src="frames/000.png"><input aria-label="제품 회전" type="range" min="0" max="69" value="0" oninput="document.getElementById(\'p\').src=\'frames/\'+String(this.value).padStart(3,\'0\')+\'.png\'"><p><a href="result.zip" download>전체 ZIP</a> · <a href="model.glb" download>3D 모델</a></p></html>'
   zip.file('viewer.html',viewer);files.push({name:'viewer.html',bytes:Buffer.from(viewer),type:'text/html;charset=utf-8'})
   const metadata={version:1,id,title:item.title,createdAt:item.createdAt,prefix,frameCount:70,credits:item.credits,viewerKey:prefix+'/viewer.html',zipKey:prefix+'/result.zip',modelKey:prefix+'/model.glb',originals:item.originals,thumbnailKey:prefix+'/frames/000.png'}
   zip.file('manifest.json',JSON.stringify(metadata,null,2));files.push({name:'result.zip',bytes:await zip.generateAsync({type:'nodebuffer'}),type:'application/zip'})
   // Immutable job namespace; manifest is uploaded last so partial uploads never appear as saved results.
   async function upload(file){const url=WORKER+'/'+(prefix+'/'+file.name).split('/').map(encodeURIComponent).join('/')+'?overwrite=true';const response=await fetch(url,{method:'PUT',headers:{'Content-Type':file.type},body:file.bytes,signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(`사이트 저장 실패 (HTTP ${response.status}). 생성 없이 저장만 재시도할 수 있습니다.`)}
   let next=0;await Promise.all(Array.from({length:3},async()=>{while(next<files.length)await upload(files[next++])}))
   await upload({name:'manifest.json',bytes:Buffer.from(JSON.stringify(metadata)),type:'application/json'})
   await putJson(fileFor(id,'meta.json'),{...await getJson(fileFor(id,'meta.json')),cloud:metadata})
   return metadata
  }finally{publishing.delete(id)}
 }
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
   if(req.method==='GET'&&(action==='model.glb'||/^original-[0-3]\.(jpg|png)$/.test(action))){const bytes=await fs.readFile(fileFor(id,action));res.writeHead(200,{'Content-Type':action==='model.glb'?'model/gltf-binary':action.endsWith('.png')?'image/png':'image/jpeg'});res.end(bytes);return true}
   if(req.method==='POST'&&action==='publish'){json(await publish(id));return true}
   if(req.method==='POST'&&action==='frames'){
    const input=await body(req);if(!Array.isArray(input.frames)||input.frames.length!==70)throw Error('70개 각도가 필요합니다.');const data=input.frames.map(f=>{if(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(f))throw Error('PNG 프레임이 필요합니다.');const bytes=Buffer.from(f.split(',')[1],'base64');if(bytes.length>2*1024*1024||bytes.toString('ascii',1,4)!=='PNG')throw Error('프레임 형식·크기를 확인하세요.');return bytes});for(let i=0;i<70;i++)await fs.writeFile(fileFor(id,`frame-${i}.png`),data[i]);await putJson(fileFor(id,'meta.json'),{...await getJson(fileFor(id,'meta.json')),frameCount:70});json({ok:true});return true
   }
   if(req.method==='POST'&&action==='resume'){if(!running.has(id)){const task=await getJson(fileFor(id,'task.json'));if(!task?.taskId)throw Error('접수 ID가 없어 자동 재생성하지 않습니다.');running.add(id);generate([],path.join(folder,id)).catch(e=>console.warn('[tripo360] 기존 작업 조회 실패',{id,name:e.name})).finally(()=>running.delete(id))}json({ok:true});return true}
   json({error:'지원하지 않는 요청입니다.'},405)
  }catch(e){console.warn('[tripo360] 로컬 작업 처리 실패',{name:e.name});json({error:e.message},400)}
  return true
 }
}
