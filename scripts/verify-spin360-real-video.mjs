import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

// 명시적으로 제공한 로컬 영상을 실제 AI로 검수한다. 소스 영상/결과는 Git에 넣지 않는다.
const input = process.env.SPIN360_TEST_VIDEO
if (!input) throw Error('SPIN360_TEST_VIDEO에 사용자가 제공한 로컬 영상 경로를 지정하세요.')
const rawOnly = process.argv.includes('--raw'), full = process.argv.includes('--full') || rawOnly, warm = process.argv.includes('--warm-masks'), decodeOnly=process.argv.includes('--decode'), root = process.cwd()
const port = Number(process.env.SPIN360_TEST_PORT || 5201)
const folder = path.join(root, 'dev-tools/ai-workflow/.state', process.env.SPIN360_TEST_SUBFOLDER || (rawOnly ? 'spin360-raw' : warm ? 'spin360-warm' : 'spin360-real'))
await fs.mkdir(folder, { recursive: true })
const maskFolder = warm ? path.join(root, 'dev-tools/ai-workflow/.state/spin360-real/cpu-mask-v4') : path.join(folder, 'cpu-mask-v4')
const indices = process.env.SPIN360_PROBE_INDICES ? process.env.SPIN360_PROBE_INDICES.split(',').map(Number) : [0,17,35,52,69]
await fs.mkdir(maskFolder, { recursive: true })
const entryId = path.join(root, '__spin360-real.tsx').replaceAll('\\', '/')
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {Spin360Page} from '/src/features/spin360/Spin360Page.tsx';import {extractSpinFrames,finishSpinFrames,encodeSpinImage,seekSpinVideo} from '/src/features/spin360/spin-processing.ts';import {spinVideo} from '/src/features/spin360/spin-video-export.ts';import {standaloneSpinHtml,spinZip} from '/src/features/spin360/spin-export.ts';import '/src/index.css';
 import AiWorker from '/src/features/spin360/spin-ai.worker.ts?worker';
 window.realRun=async(settings,full,decodeOnly,warm,rawOnly,indices)=>{
 const file=document.querySelector('input[type=file]').files[0],url=URL.createObjectURL(file),signal=new AbortController().signal;
 const report=p=>console.log('PROGRESS',p.stage,p.done+'/'+p.total);let frames=[];
 try{
 const all=await extractSpinFrames(url,settings,signal,report);frames=warm?[...all].reverse():full?all:indices.map(index=>all[index]);
 window.rawFrames=frames;
 let done;
 if(decodeOnly||rawOnly)done={frames};else if(!warm)done=await finishSpinFrames(frames,settings,signal,report);else{
 const worker=new AiWorker(),masked=[];try{for(const frame of frames){const mask=await new Promise((resolve,reject)=>{worker.onmessage=e=>{if(e.data.type==='progress'){report({stage:e.data.message,done:masked.length,total:frames.length});return}if(e.data.type==='error')reject(Error(e.data.message));else resolve(e.data.mask)};worker.onerror=e=>reject(Error(e.message));worker.postMessage({blob:frame.blob,targetProduct:true,content:frame.content})});const c=document.createElement('canvas');c.width=c.height=settings.edge;const ctx=c.getContext('2d'),bitmap=await createImageBitmap(frame.blob),alpha=await createImageBitmap(mask);ctx.drawImage(bitmap,0,0);ctx.globalCompositeOperation='destination-in';ctx.drawImage(alpha,0,0,c.width,c.height);ctx.globalCompositeOperation='destination-over';ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);masked.push({...frame,blob:await encodeSpinImage(c)});bitmap.close();alpha.close()}done={frames:masked}}finally{worker.terminate()}}
 const data=async blob=>Array.from(new Uint8Array(await blob.arrayBuffer()));
 const pictures=[];for(let i=0;i<done.frames.length;i++)if(!full||i%7===0||i===done.frames.length-1)pictures.push({index:i,bytes:await data(done.frames[i].blob)});
 const movie=full?await spinVideo(done.frames,settings.edge,20,signal,p=>report({stage:'MP4',done:p,total:100})):null;
 const files=full?{mp4:await data(movie),html:await data(await standaloneSpinHtml('흰 배경 360 실제 영상 검수',done.frames)),zip:await data(await spinZip('흰 배경 360 실제 영상 검수',done.frames,settings,()=>{},movie))}:{};
 const raw=[];if(!full)for(let i=0;i<frames.length;i++)raw.push({index:i,bytes:await data(frames[i].blob)});
 return {count:done.frames.length,pictures,raw,files,times:done.frames.map(f=>f.time)};
 }finally{URL.revokeObjectURL(url)}};
 createRoot(document.getElementById('root')).render(<BrowserRouter><main className="p-4"><input type="file" id="test-video"/><Spin360Page/></main></BrowserRouter>);`
const server = await createServer({root,configFile:false,envFile:false,logLevel:'error',
  optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react-router-dom','mediabunny','jszip']},
  cacheDir:path.join(root,'node_modules/.cache/spin360-real/vite'),
  plugins:[{name:'spin-real',enforce:'pre',resolveId:id=>id==='/__spin360-real.tsx'?entryId:undefined,load:id=>id===entryId?entry:undefined,
    configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.headers.accept?.includes('text/html'))return next();vite.transformIndexHtml(req.url,'<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/__spin360-real.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)}).catch(next)})}},react(),tailwindcss()],
  resolve:{alias:{'@':path.join(root,'src')}},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,fs:{allow:[root]}}})
let browser
try {
 await server.listen()
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage()
 // 이 검수 실행 안에서만 모델 결과를 보관한다. 재검수 시 성공한 추론을 반복하지 않는다.
 await page.exposeFunction('readTestMask',async key=>{assert.match(key,/^[a-f0-9]{64}$/);try{return Array.from(await fs.readFile(path.join(maskFolder,key+'.png')))}catch(error){if(error.code==='ENOENT')return null;throw error}})
 await page.exposeFunction('writeTestMask',async(key,bytes)=>{assert.match(key,/^[a-f0-9]{64}$/);const target=path.join(maskFolder,key+'.png'),temporary=target+'.'+process.pid+'.tmp';await fs.writeFile(temporary,Buffer.from(bytes));await fs.rename(temporary,target)})
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data.type==='mask'&&this.testKey)void event.data.mask.arrayBuffer().then(bytes=>window.writeTestMask(this.testKey,Array.from(new Uint8Array(bytes)))).catch(error=>console.warn('mask checkpoint failed',error))})}
   postMessage(data,...args){if(!(data.blob instanceof Blob))return super.postMessage(data,...args);void(async()=>{const hash=await crypto.subtle.digest('SHA-256',await data.blob.arrayBuffer());this.testKey=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');const bytes=await window.readTestMask(this.testKey);if(bytes)this.dispatchEvent(new MessageEvent('message',{data:{type:'mask',mask:new Blob([new Uint8Array(bytes)],{type:'image/png'}),backend:'wasm'}}));else super.postMessage(data,...args)})().catch(error=>this.dispatchEvent(new ErrorEvent('error',{message:error.message}))) }
  }
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 let lastLog=0;page.on('console',msg=>{if(msg.type()==='log'&&msg.text().startsWith('PROGRESS')&&Date.now()-lastLog>2000){lastLog=Date.now();console.log(msg.text())}})
 await context.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url())
  assert.notEqual(request.method(),'POST','원본 영상/이미지를 외부로 업로드하지 않음')
  if(url.hostname==='127.0.0.1'||url.hostname==='cdn.jsdelivr.net'||url.hostname==='huggingface.co'||url.hostname.endsWith('.hf.co')||url.hostname.endsWith('.huggingface.co'))return route.continue()
  if(url.protocol==='blob:'||url.protocol==='data:')return route.continue()
  console.log('BLOCKED',url.hostname);return route.abort()
 })
 await page.goto('http://127.0.0.1:'+port+'/test/spin360',{timeout:90000})
 await page.locator('#test-video').setInputFiles(input)
 const settings={start:1.7,end:10.25,anchors:[{angle:90,time:3.0},{angle:180,time:6.35},{angle:270,time:8.1}],edge:800,ai:true,brightness:112,contrast:103,crop:0,motionSampling:true,region:{x:0.20,y:0.14,width:0.55,height:0.65}}
 if(decodeOnly)settings.region={x:0,y:0,width:1,height:1};
 if(rawOnly)settings.ai=false;
 const result=await page.evaluate(({settings,full,decodeOnly,warm,rawOnly,indices})=>window.realRun(settings,full,decodeOnly,warm,rawOnly,indices),{settings,full,decodeOnly,warm,rawOnly,indices})
 assert.equal(result.count,full||warm?70:indices.length)
 for(const picture of result.pictures)await fs.writeFile(path.join(folder,`frame-${String(picture.index+1).padStart(3,'0')}.webp`),Buffer.from(picture.bytes))
 for(const picture of result.raw??[])await fs.writeFile(path.join(folder,`raw-${String(picture.index+1).padStart(3,'0')}.webp`),Buffer.from(picture.bytes))
 for(const [ext,bytes]of Object.entries(result.files))await fs.writeFile(path.join(folder,`${rawOnly?'raw-source':'white-background-360'}.${ext}`),Buffer.from(bytes))
 await fs.writeFile(path.join(folder,full?'full-report.json':'probe-report.json'),JSON.stringify({settings,count:result.count,times:result.times,errors},null,2))
 assert.deepEqual(errors,[])
 console.log('real-video',JSON.stringify({count:result.count,full,folder}))
}finally{await browser?.close();await server.close()}
