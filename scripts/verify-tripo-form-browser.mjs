// All generation and storage endpoints are mocked. No keys, paid API calls, or real cloud writes.
import { createServer as reservePort } from 'node:net'
import { createServer as httpServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { spinHtmlDownloadPlugin } from './tripo360/html-download-plugin.ts'
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createServer} from 'vite';import react from '@vitejs/plugin-react';import tailwind from '@tailwindcss/vite';import {chromium} from 'playwright-core';
const cloud={version:1,id:'tripo-test-result',title:'저장된 테스트 결과',createdAt:'2026-10-29T00:00:00Z',prefix:'spin360/tripo/tripo-test-result',frameCount:0,status:'success',cloud:{legacy:true}};
const root=process.cwd(),entryId=path.join(root,'__tripo-form-test.tsx').replaceAll('\\','/');const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {Spin360Page} from '/src/features/spin360/Spin360Page.tsx';import {PreviewPanel} from '/src/features/design/file-manager/components/PreviewPanel.tsx';import {WorkspaceTabActivityContext} from '/src/components/layout/workspace-tab-activity.ts';import '/src/index.css';function Test(){const [active,setActive]=React.useState(true);return <BrowserRouter><button id="toggle-active" onClick={()=>setActive(v=>!v)}>활성 탭 전환</button><WorkspaceTabActivityContext value={active}><main className="mx-auto max-w-[1500px] p-4">{location.pathname==='/file-preview'?<PreviewPanel selection={{type:'spin360',item:{key:'spin360/model.glb',name:'model.glb'}}} onTag={()=>{}} onUrl={()=>{}} onOpen={()=>{}} resize={()=>{}}/>:<Spin360Page/>}</main></WorkspaceTabActivityContext></BrowserRouter>}createRoot(document.getElementById('root')).render(<Test/>);`;
// Vite's port 0 defaults to 5173, which can overlap a running Windows dev server.
const probe=reservePort();
await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve)});
const fixturePort=probe.address().port;
await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
let downloadBody;
const modelService = httpServer((request, response) => {
 if (request.url !== `/job/${cloud.id}/model.glb` || !downloadBody) return response.writeHead(404).end()
 response.writeHead(200, { 'Content-Type': 'model/gltf-binary' })
 response.write(downloadBody.subarray(0, 4))
 setImmediate(() => response.end(downloadBody.subarray(4)))
})
await new Promise((resolve, reject) => { modelService.once('error', reject); modelService.listen(0, '127.0.0.1', resolve) })
const modelServiceOrigin = `http://127.0.0.1:${modelService.address().port}`
const server=await createServer({root,configFile:false,logLevel:'error',cacheDir:path.join(root,'node_modules/.cache/tripo-form/vite'),optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react-router-dom']},plugins:[spinHtmlDownloadPlugin(modelServiceOrigin),{name:'tripo-form-test',resolveId(id){if(id==='/__tripo-form-test.tsx')return entryId},load(id){if(id===entryId)return entry},configureServer(v){v.middlewares.use((req,res,next)=>{if(req.url.split('?')[0]==='/viewer.html'||!req.headers.accept?.includes('text/html'))return next();v.transformIndexHtml(req.url,'<html><meta charset="utf-8"><div id="root"></div><script type="module" src="/__tripo-form-test.tsx"></script></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react(),tailwind()],resolve:{alias:{'@':path.join(root,'src')}},server:{host:'127.0.0.1',port:fixturePort,strictPort:true,hmr:false}});
let browser;try{await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let submissions=0,localDown=false;
page.setDefaultNavigationTimeout(120_000);
let storageRequests=0,directRequests=0;
await page.route('http://127.0.0.1:4320/**',route=>{directRequests++;return route.abort()});
await page.route(`${origin}/__atelier-spin360/**`,async route=>{
 if(localDown)return route.abort();
 const url=new URL(route.request().url()),headers={'Access-Control-Allow-Origin':origin};
 if(url.pathname.endsWith('/model-360.html'))return route.continue();
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
 if(url.pathname.endsWith('/model.glb')){if(url.searchParams.has('download'))return route.continue();modelReads++;return route.fulfill({headers,contentType:'model/gltf-binary',body:model})}
 if(route.request().method()==='POST'){assert.equal(url.pathname,'/__atelier-spin360/jobs','No extraction or publish calls allowed');submissions++;const body=route.request().postDataJSON();assert.equal(body.photos.length,4);assert.equal(body.title,'브라우저 폼 검증');return route.fulfill({headers,json:{id:body.id,title:body.title,status:'queued'}})}
 return route.fulfill({headers,json:[cloud]})
});
await page.route('https://r2-worker.masmarulez-upload.workers.dev/**',route=>{storageRequests++;return route.abort()});
// A real binary glTF triangle exercises WebGL/GLTFLoader without an AI request.
const positions=Buffer.from(new Float32Array([-1,-1,0,1,-1,0,0,1,0]).buffer);
const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.15,.23,.32,1],metallicFactor:0}}],buffers:[{byteLength:positions.length}],bufferViews:[{buffer:0,byteLength:positions.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]}]};
let json=Buffer.from(JSON.stringify(gltf));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+positions.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(positions.length);binHeader.writeUInt32LE(0x004e4942,4);const model=process.env.TRIPO_VERIFY_REAL_MODEL?await fs.readFile(path.join(root,'.tmp/tripo360/model.glb')):Buffer.concat([header,json,binHeader,positions]);
downloadBody=model;
let modelReads=0,failModel=false,oldViewerReads=0;
await page.route('https://cdn2.auchee.com/**',route=>{const url=route.request().url();if(url.endsWith('manifest.json'))return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:cloud});if(url.endsWith('model.glb')){modelReads++;return route.fulfill({status:failModel?503:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'model/gltf-binary',body:failModel?Buffer.from('unavailable'):model})}if(url.endsWith('viewer.html'))oldViewerReads++;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYVQAAAAASUVORK5CYII=','base64')})});
const ready=async()=>{await page.locator('canvas').scrollIntoViewIfNeeded();await page.locator('canvas[data-ready="true"]').waitFor({timeout:60000})};
await page.goto(origin+'/test/spin360');await page.getByRole('heading',{name:'이 PC의 제작 결과',exact:true}).waitFor();await page.getByRole('button',{name:'결과 보기',exact:true}).first().waitFor({timeout:60000});assert.equal(await page.getByRole('button',{name:'영상·70프레임 생성'}).count(),0);assert.equal(await page.getByLabel('360 누끼 이미지').count(),0);assert.equal(await page.getByRole('button',{name:'중간 각도 4장 생성 · API 요금 발생'}).count(),0);
await page.getByRole('button',{name:'결과 보기',exact:true}).first().click();await ready();
const downloaded = page.waitForEvent('download')
await page.getByRole('link', { name: '360 HTML 다운로드', exact: true }).click()
const file = await downloaded
assert.equal(file.suggestedFilename(), 'model-360.html')
const html = await fs.readFile(await file.path(), 'utf8')
const modelParts = [...html.matchAll(/<script type="application\/octet-stream">([A-Za-z0-9+/=]+)<\/script>/g)]
assert.deepEqual(Buffer.concat(modelParts.map(part => Buffer.from(part[1], 'base64'))), model)
const htmlFile = path.resolve('node_modules/.cache/tripo-form/model-360.html')
await file.saveAs(htmlFile)
const offlinePage = await browser.newPage({ viewport: { width: 390, height: 420 } })
const exportRequests = []
offlinePage.on('request', req => { if (/^https?:/.test(req.url())) exportRequests.push(req.url()) })
await offlinePage.context().setOffline(true)
await offlinePage.goto(pathToFileURL(htmlFile).href)
await offlinePage.locator('canvas[data-ready="true"]').waitFor({ timeout: 60000 })
await offlinePage.getByRole('slider', { name: '3D 회전 각도' }).fill('90')
await offlinePage.locator('canvas[data-angle="90.000"]').waitFor()
if (!process.env.TRIPO_VERIFY_REAL_MODEL) {
  // Measure rendered pixels so a larger canvas with an unchanged model fails the assertion.
  const canvas = offlinePage.locator('canvas')
  async function measure(viewport) {
    await offlinePage.setViewportSize(viewport)
    const snapshot = await canvas.screenshot({ scale: 'css' })
    return offlinePage.evaluate(async encoded => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + encoded
      await image.decode()
      const scratch = document.createElement('canvas')
      const { width, height } = image
      scratch.width = width
      scratch.height = height
      const context = scratch.getContext('2d')
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, width, height)
      let left = width, right = -1, top = height, bottom = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if ((x < 8 || x >= width - 8) && (y < 8 || y >= height - 8)) continue
          const index = (y * width + x) * 4
          if (data[index] >= 235 && data[index + 1] >= 235 && data[index + 2] >= 235) continue
          left = Math.min(left, x)
          right = Math.max(right, x)
          top = Math.min(top, y)
          bottom = Math.max(bottom, y)
        }
      }
      return { width: (right - left + 1) / width, height: (bottom - top + 1) / height, pixels: bottom - top + 1 }
    }, snapshot.toString('base64'))
  }
  const small = await measure({ width: 520, height: 410 })
  const large = await measure({ width: 1020, height: 765 })
  for (const frame of [small, large]) assert.ok(frame.height >= .74 && frame.height <= .81, JSON.stringify(frame))
  assert.ok(Math.abs(small.height - large.height) < .02 && large.pixels > small.pixels * 1.8)
  const narrow = await measure({ width: 175, height: 460 })
  assert.ok(narrow.width >= .85 && narrow.width <= .92 && narrow.height < small.height, JSON.stringify(narrow))
}
assert.deepEqual(exportRequests, [], 'HTML file must work using only embedded model and renderer')
await offlinePage.close()
assert.equal(await page.getByRole('button',{name:'사이트에 저장',exact:true}).count(),0);
const canvas=page.locator('canvas');const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5,{steps:12});await page.mouse.up();await page.waitForFunction(()=>Number(document.querySelector('canvas').dataset.angle)>30);assert.equal(oldViewerReads,0);
await page.getByRole('button',{name:'자동 회전',exact:true}).click();const before=await canvas.getAttribute('data-angle');await page.waitForFunction(value=>document.querySelector('canvas').dataset.angle!==value,before);await page.getByRole('button',{name:'회전 멈춤',exact:true}).click();
await page.getByRole('slider',{name:'3D 회전 각도'}).fill('123.4');await page.waitForFunction(()=>Math.abs(Number(document.querySelector('canvas').dataset.angle)-123.4)<.01);
await page.getByText('고화질 텍스처 · 1회 40크레딧 ($0.40)',{exact:false}).waitFor();
await page.getByLabel('제품 이름',{exact:true}).fill('브라우저 폼 검증');const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYVQAAAAASUVORK5CYII=','base64');for(const label of ['앞','오른쪽','뒤','왼쪽'])await page.getByLabel(label+' 사진',{exact:true}).setInputFiles({name:label+'.png',mimeType:'image/png',buffer:bytes});await page.getByRole('button',{name:'3D 모델 제작 · 40크레딧 사용',exact:true}).click();await page.getByText('3D 생성 중 · 0%',{exact:true}).waitFor();assert.equal(submissions,1);
await page.reload();await page.getByRole('button',{name:'결과 보기',exact:true}).first().waitFor({timeout:60000});await page.getByRole('button',{name:'결과 보기',exact:true}).first().click();await ready();
await page.screenshot({path:'node_modules/.cache/tripo-form/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await ready();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await canvas.evaluate(el=>getComputedStyle(el).touchAction),'pan-y');
const cdp=await page.context().newCDPSession(page);const mobileBox=await canvas.boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mobileBox.x+mobileBox.width*.3,y:mobileBox.y+mobileBox.height*.5}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mobileBox.x+mobileBox.width*.65,y:mobileBox.y+mobileBox.height*.5}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>Number(document.querySelector('canvas').dataset.angle)>60);
await page.screenshot({path:'node_modules/.cache/tripo-form/mobile.png',fullPage:true});
// Hidden workspace tabs stop rendering, and returning does not reload the GLB.
await page.getByRole('button',{name:'자동 회전',exact:true}).click();const reads=modelReads;await page.locator('#toggle-active').evaluate(el=>el.click());const stopped=await canvas.getAttribute('data-angle');await page.waitForTimeout(150);assert.equal(await canvas.getAttribute('data-angle'),stopped);await page.locator('#toggle-active').evaluate(el=>el.click());await page.waitForFunction(value=>document.querySelector('canvas').dataset.angle!==value,stopped);assert.equal(modelReads,reads);
// File manager uses the same viewer; failed fetch has an explicit retry.
failModel=true;await page.goto(origin+'/file-preview');await page.getByRole('button',{name:'다시 불러오기',exact:true}).waitFor({timeout:60000});failModel=false;await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await ready();assert.equal(await page.locator('canvas').count(),1);await page.getByRole('slider',{name:'3D 회전 각도'}).fill('90');await page.waitForFunction(()=>Math.abs(Number(document.querySelector('canvas').dataset.angle)-90)<.01);
const sharing = await page.evaluate(async () => {
 const { buildMediaTag, getItemShareUrl, ensureTagBreak } = await import('/src/features/design/file-manager/file-manager-utils.ts')
 const item = { key: 'Prod_Images/360_test/model (1).glb' }
 const source = 'https://cdn2.auchee.com/Prod_Images/360_test/model%20(1).glb'
 return { source, viewer: getItemShareUrl(item, 'Prod_Images'), tag: ensureTagBreak(buildMediaTag('Prod_Images', source, item)),
  image: buildMediaTag('image', 'https://cdn2.auchee.com/image/test.png'),
  video: buildMediaTag('video', 'https://cdn2.auchee.com/video/test.mp4') }
})
const viewerUrl = new URL(sharing.viewer)
assert.equal(viewerUrl.pathname, '/viewer.html')
assert.equal(viewerUrl.searchParams.get('model'), sharing.source)
assert.equal(sharing.tag, `<img src="${sharing.source}"><br>`)
assert.match(sharing.image, /^<img /)
assert.match(sharing.video, /^<video /)
await page.route('https://cdn2.auchee.com/Prod_Images/360_test/**', route => route.fulfill({
 headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/octet-stream', body: model,
}))
await page.evaluate(src => {
 const frame = document.createElement('iframe')
 frame.src = src
 frame.title = '상품 360도 보기'
 document.body.replaceChildren(frame)
}, sharing.viewer)
const embedded = page.frameLocator('iframe[title="상품 360도 보기"]')
await embedded.locator('canvas[data-ready="true"]').waitFor({timeout:60000})
await embedded.getByRole('slider',{name:'3D 회전 각도'}).fill('120')
await embedded.locator('canvas[data-angle="120.000"]').waitFor()
await page.goto(origin+'/viewer.html?model=https%3A%2F%2Fexample.invalid%2Fmodel.glb')
await page.getByRole('alert').getByText('올바른 상품 3D 모델 주소를 지정해 주세요.').waitFor()
assert.equal(await page.locator('canvas').count(),0)
localDown=true;await page.goto(origin+'/test/spin360');await page.getByText('이 PC의 제작 서버에 연결하지 못했습니다.',{exact:false}).waitFor();assert.equal(directRequests,0);assert.equal(storageRequests,0);assert.equal(oldViewerReads,0);assert.equal(submissions,1);assert.deepEqual(errors,[]);console.log('PASS local GLB viewer, rotation, pause/resume, download, preview/retry, GLB share URL and embedded viewer, non-GLB tags, rejected external model and mobile; no storage writes or paid generation');
}finally{await browser?.close();await server.close();await new Promise(resolve=>modelService.close(resolve))}
