import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
import JSZip from 'jszip'
import { Input, ALL_FORMATS, BlobSource, EncodedPacketSink } from 'mediabunny'

const root = process.cwd(), ai = process.argv.includes('--ai')
const entryId = path.join(root, '__spin360-test.tsx').replaceAll('\\', '/')
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {Spin360Page} from '/src/features/spin360/Spin360Page.tsx';import '/src/index.css';
  import {finishSpinFrames} from '/src/features/spin360/spin-processing.ts';
  import AiWorker from '/src/features/spin360/spin-ai.worker.ts?worker';
  window.testAi=async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,512,512);c.fillStyle='#294b38';c.fillRect(125,170,260,260);c.lineWidth=25;c.strokeStyle='#294b38';c.beginPath();c.arc(255,170,80,Math.PI,0);c.stroke();const blob=await new Promise(r=>canvas.toBlob(r));return new Promise((resolve,reject)=>{const worker=new AiWorker();const timeout=setTimeout(()=>{worker.terminate();reject(Error('AI timeout'))},240000);worker.onmessage=async e=>{if(e.data.type==='progress'){console.log(e.data.message);return}clearTimeout(timeout);worker.terminate();if(e.data.type==='error')return reject(Error(e.data.message));const bitmap=await createImageBitmap(e.data.mask);c.clearRect(0,0,512,512);c.drawImage(bitmap,0,0,512,512);const pixels=c.getImageData(0,0,512,512).data;let foreground=0,background=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]>200)foreground++;if(pixels[i]<20)background++}resolve({foreground,background,width:bitmap.width,height:bitmap.height})};worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(Error(e.message))};worker.postMessage({blob})})};
  window.testFinish=async()=>{const source=document.createElement('canvas');source.width=source.height=640;const c=source.getContext('2d'),frames=[];for(const shift of [-35,35]){c.fillStyle='#cccccc';c.fillRect(0,0,640,640);c.fillStyle='#294b38';c.fillRect(195+shift,235,250,260);c.lineWidth=25;c.strokeStyle='#294b38';c.beginPath();c.arc(320+shift,235,75,Math.PI,0);c.stroke();const blob=await new Promise(r=>source.toBlob(r));frames.push({blob,time:frames.length,sharpness:20,signature:[1]})}const result=await finishSpinFrames(frames,{start:0,end:4,anchors:[],edge:640,ai:true,brightness:100,contrast:100,crop:0},new AbortController().signal,()=>{});const boxes=[];for(const frame of result.frames){const image=await createImageBitmap(frame.blob);c.clearRect(0,0,640,640);c.drawImage(image,0,0);const p=c.getImageData(0,0,640,640).data;let left=640,right=0,top=640,bottom=0;for(let y=0;y<640;y++)for(let x=0;x<640;x++)if(p[(y*640+x)*4]<150){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}boxes.push({center:(left+right)/2,height:bottom-top,corner:p[0]});image.close()}return {count:result.frames.length,thumbnails:result.thumbnails.length,boxes}};
  createRoot(document.getElementById('root')).render(<BrowserRouter><main className="mx-auto max-w-[1500px] p-4"><Spin360Page/></main></BrowserRouter>);`
const server = await createServer({ root, configFile: false, envFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-router-dom', 'jszip'] },
  cacheDir: path.join(root, 'node_modules/.cache/spin360/vite'),
  plugins: [{ name: 'spin360-test', enforce: 'pre',
    resolveId(id) { if (id === '/__spin360-test.tsx') return entryId }, load(id) { if (id === entryId) return entry },
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (!req.headers.accept?.includes('text/html')) return next()
      vite.transformIndexHtml(req.url, '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/__spin360-test.tsx"></script></body></html>')
        .then(html => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) }).catch(next)
    }) },
  }, react(), tailwindcss()], resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 5199, strictPort: true, hmr: false, fs: { allow: [root] } },
})
let browser
try {
  await server.listen()
  const origin = 'http://127.0.0.1:5199', errors = [], blocked = [], requests = []
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  await context.route('**/*', route => {
    const url = route.request().url();requests.push({ url, method: route.request().method() })
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
    const host = new URL(url).hostname
    if (ai && (host === 'cdn.jsdelivr.net' || host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co'))) return route.continue()
    blocked.push(url);return route.abort()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  await page.goto(origin + '/test/spin360', { timeout: 90_000, waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '360 상세이미지 생성', exact: true }).waitFor()
  if (ai) {
    page.on('console', msg => { if (msg.type() === 'log') console.log('AI', msg.text()) })
    const proof = await page.evaluate(() => window.testAi())
    assert.ok(proof.foreground > 1000 && proof.background > 1000, JSON.stringify(proof))
    assert.equal(proof.width, 512)
    await fs.mkdir('node_modules/.cache/spin360', { recursive: true })
    await fs.writeFile('node_modules/.cache/spin360/ai-proof.json', JSON.stringify(proof))
    console.log('spin360-ai: real pinned BiRefNet model downloaded and inferred, foreground/background alpha verified', proof)
    const finished = await page.evaluate(() => window.testFinish())
    assert.equal(finished.count, 2);assert.equal(finished.thumbnails, 2)
    assert.ok(finished.boxes.every(box => box.corner > 245 && Math.abs(box.center - 320) < 20))
    assert.ok(Math.abs(finished.boxes[0].height - finished.boxes[1].height) < 20)
    console.log('spin360-ai: production pipeline, repeated inference, white background, constant scale and center alignment passed', finished)
  } else {
    const video = await page.evaluate(async () => {
      const mime = ['video/mp4;codecs=avc1.42001E', 'video/mp4', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type))
      const canvas = document.createElement('canvas');canvas.width=canvas.height=320
      const c=canvas.getContext('2d'),stream=canvas.captureStream(20),chunks=[]
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:600000})
      const blob=await new Promise(resolve=>{
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType}));recorder.start()
        const start=performance.now();const timer=setInterval(()=>{const elapsed=(performance.now()-start)/1000,a=elapsed/4*Math.PI*2;c.fillStyle='white';c.fillRect(0,0,320,320);c.save();c.translate(160,170);c.fillStyle='#c60920';c.fillRect(-60*Math.cos(a)-20,-65,Math.abs(120*Math.cos(a))+40,130);c.fillStyle='#252525';c.font='22px Arial';c.fillText(String(Math.round(elapsed*20)), -20,0);c.restore();if(elapsed>=4){clearInterval(timer);recorder.stop();stream.getTracks().forEach(track=>track.stop())}},50)
      })
      return { bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),mime:blob.type }
    })
    console.log('spin360-browser: recorded real test video', video.mime, video.bytes.length)
    await page.getByLabel('360 촬영 영상').setInputFiles({ name: video.mime.startsWith('video/mp4') ? 'rotation.mp4' : 'rotation.webm', mimeType: video.mime, buffer: Buffer.from(video.bytes) })
    await page.getByRole('button', { name: '영상·70프레임 생성', exact: true }).waitFor()
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(node => node.textContent === '영상·70프레임 생성').disabled)
    await page.getByLabel('출력 크기', { exact: true }).selectOption('640')
    await page.getByRole('button', {name:'영상·70프레임 생성',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'제품 영역을 먼저 지정'}).waitFor()
    await page.waitForFunction(()=>document.querySelector('[aria-label="제품 영역 드래그"] canvas')?.width===320)
    const selectionBox=await page.getByLabel('제품 영역 드래그',{exact:true}).boundingBox()
    await page.mouse.move(selectionBox.x+selectionBox.width*.2,selectionBox.y+selectionBox.height*.1)
    await page.mouse.down();await page.mouse.move(selectionBox.x+selectionBox.width*.8,selectionBox.y+selectionBox.height*.9,{steps:12});await page.mouse.up()
    assert.ok(Math.abs(Number(await page.getByLabel('제품 영역 width',{exact:true}).inputValue())-60)<1,'드래그한 제품 영역이 생성 설정에 반영됨')
    for(const [field,value]of Object.entries({x:20,y:10,width:60,height:80}))await page.getByLabel('제품 영역 '+field,{exact:true}).fill(String(value))
    await page.getByRole('checkbox', {name:'AI 배경 제거·상품 중심 정렬',exact:true}).uncheck()
    await page.getByRole('button', { name: '영상·70프레임 생성', exact: true }).click()
    await page.getByRole('button', { name: '70번 프레임 보기', exact: true }).waitFor({ timeout: 120_000 })
    assert.equal(await page.getByRole('button', { name: /번 프레임 보기$/ }).count(), 70)
    const viewer = page.getByRole('slider', { name: '360도 회전 미리보기', exact: true })
    await viewer.focus();await page.keyboard.press('ArrowLeft');assert.equal(await viewer.getAttribute('aria-valuenow'), '70')
    await page.getByRole('button', { name: '다음 프레임', exact: true }).click();assert.equal(await viewer.getAttribute('aria-valuenow'), '1')
    const bounds=await viewer.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*0.8,bounds.y+bounds.height/2,{steps:5});await page.mouse.up()
    assert.notEqual(await viewer.getAttribute('aria-valuenow'),'1','드래그 회전')
    await page.getByLabel('제품 이름', { exact: true }).fill('상품 </script><script>window.injected=1</script>')
    const download = page.waitForEvent('download');await page.getByRole('button', { name: '70장 + 뷰어 ZIP', exact: true }).click()
    const archive=await download,zip=await JSZip.loadAsync(await fs.readFile(await archive.path()))
    assert.equal(Object.keys(zip.files).filter(name=>/^frames\/\d{3}\.webp$/.test(name)).length,70)
    const manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.equal(manifest.frameCount,70);assert.equal(manifest.settings.edge,640);assert.ok(zip.file('rotation.mp4'));assert.equal(manifest.video.fps,20)
    const exported=await zip.file('viewer.html').async('string');assert.ok(!exported.includes('window.injected=1</script>'))
    const mp4Download=page.waitForEvent('download');await page.getByRole('button',{name:'360 영상 MP4',exact:true}).click();const mp4=await mp4Download;assert.ok((await fs.stat(await mp4.path())).size>1000);
    const standaloneDownload=page.waitForEvent('download');await page.getByRole('button',{name:'단일 HTML 다운로드',exact:true}).click()
    const standalone=await standaloneDownload,standaloneHtml=await fs.readFile(await standalone.path(),'utf8')
    assert.equal((standaloneHtml.match(/data:image\/webp;base64/g)??[]).length,70)
    const exportPage=await context.newPage();await exportPage.setContent(standaloneHtml)
    await exportPage.waitForFunction(()=>document.getElementById('image').complete&&document.getElementById('image').naturalWidth===640)
    await exportPage.getByRole('button',{name:'다음 각도',exact:true}).click();assert.match(await exportPage.locator('#counter').textContent(),/02 \/ 70/)
    assert.equal(await exportPage.evaluate(()=>window.injected),undefined)
    await page.getByLabel('밝기',{exact:true}).fill('110');assert.equal(await page.getByRole('button',{name:'70장 + 뷰어 ZIP',exact:true}).isDisabled(),true,'설정이 바뀌면 낡은 결과 내보내기 차단')
    await fs.mkdir('dev-tools/ai-workflow/.state',{recursive:true})
    await page.screenshot({path:'dev-tools/ai-workflow/.state/spin360-desktop.png',fullPage:true})
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'dev-tools/ai-workflow/.state/spin360-mobile.png',fullPage:true})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'모바일 가로 넘침 없음')
    await page.getByLabel('시작 시각',{exact:true}).fill('3.9');await page.getByRole('button',{name:'영상·70프레임 생성',exact:true}).click();await page.getByRole('alert').filter({hasText:'2.4초'}).waitFor()
    await page.getByLabel('시작 시각',{exact:true}).fill('0');await page.getByRole('button',{name:'영상·70프레임 생성',exact:true}).click();await page.getByRole('button',{name:'작업 취소',exact:true}).click()
    await page.getByText('작업을 취소했습니다.',{exact:false}).waitFor()
    assert.equal(await page.getByRole('button',{name:'영상·70프레임 생성',exact:true}).isDisabled(),false,'취소 후 다시 작업 가능')
    await page.getByRole('button',{name:'누끼 이미지 · AI 요금 없음',exact:true}).click()
    const pictures=await page.evaluate(async()=>{const files=[];for(let i=0;i<4;i++){const c=document.createElement('canvas');c.width=300;c.height=400;const x=c.getContext('2d');x.fillStyle=['#124c2b','#285c3b','#386c4b','#487c5b'][i];x.fillRect(110-i*15,50,80+i*30,250);x.fillStyle='white';x.fillRect(110-i*15,300,80+i*30,45);const blob=await new Promise(r=>c.toBlob(r,'image/png'));files.push(Array.from(new Uint8Array(await blob.arrayBuffer())))}return files})
    await page.getByLabel('360 누끼 이미지',{exact:true}).setInputFiles(pictures.map((bytes,index)=>({name:`0${index+1}.png`,mimeType:'image/png',buffer:Buffer.from(bytes)})))
    await page.getByRole('button',{name:'3번 이미지 앞으로',exact:true}).click()
    await page.getByLabel('사진 출력 크기',{exact:true}).selectOption('640')
    await page.getByRole('button',{name:'이미지로 회전 뷰어 생성',exact:true}).click()
    await page.getByRole('button',{name:'4번 프레임 보기',exact:true}).waitFor({timeout:120000})
    assert.equal(await page.getByRole('button',{name:/번 프레임 보기$/}).count(),4,'사진 4장을 70개 원본 각도인 것처럼 표시하지 않음')
    const photoDownload=page.waitForEvent('download');await page.getByRole('button',{name:'4장 + 뷰어 ZIP',exact:true}).click()
    const photoArchive=await photoDownload,photoBytes=await fs.readFile(await photoArchive.path()),photoZip=await JSZip.loadAsync(photoBytes)
    const photoManifest=JSON.parse(await photoZip.file('manifest.json').async('string'))
    assert.equal(photoManifest.frameCount,4);assert.equal(photoManifest.inputType,'photos');assert.equal(photoManifest.aiModel,null)
    assert.deepEqual(photoManifest.frames.map(frame=>frame.sourceFile),['01.png','03.png','02.png','04.png'])
    assert.equal(photoManifest.video.sourceViews,4);assert.equal(photoManifest.video.duration,3.5)
    const photoMovie=await photoZip.file('rotation.mp4').async('nodebuffer'),movieInput=new Input({formats:ALL_FORMATS,source:new BlobSource(new Blob([photoMovie]))})
    try{const track=await movieInput.getPrimaryVideoTrack();let count=0;for await(const packet of new EncodedPacketSink(track).packets()){assert.ok(packet.timestamp>=0);count++}assert.equal(count,70);assert.ok(Math.abs(await movieInput.computeDuration()-3.5)<.01)}finally{movieInput.dispose()}
    const photoHtmlDownload=page.waitForEvent('download');await page.getByRole('button',{name:'단일 HTML 다운로드',exact:true}).click();const photoHtml=await fs.readFile(await(await photoHtmlDownload).path(),'utf8');assert.equal((photoHtml.match(/data:image\/webp;base64/g)||[]).length,4)
    const firstImage=await photoZip.file('frames/001.webp').async('base64')
    const corner=await page.evaluate(async bytes=>{const image=await createImageBitmap(await(await fetch('data:image/webp;base64,'+bytes)).blob());const canvas=document.createElement('canvas');canvas.width=canvas.height=640;const c=canvas.getContext('2d');c.drawImage(image,0,0);image.close();return Array.from(c.getImageData(0,0,1,1).data)},firstImage)
    assert.ok(corner.slice(0,3).every(value=>value>=248),'투명 누끼 이미지의 배경을 흰색으로 합성함')
    await fs.mkdir('dev-tools/ai-workflow/.state/spin360-photo-input',{recursive:true})
    await fs.writeFile('dev-tools/ai-workflow/.state/spin360-photo-input/result.zip',photoBytes);await fs.writeFile('dev-tools/ai-workflow/.state/spin360-photo-input/result.html',photoHtml)
    await page.screenshot({path:'dev-tools/ai-workflow/.state/spin360-photo-input/mobile.png',fullPage:true})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await page.getByLabel('사진 밝기',{exact:true}).fill('111');assert.equal(await page.getByRole('button',{name:'4장 + 뷰어 ZIP',exact:true}).isDisabled(),true)
    assert.ok(!requests.some(request=>request.method==='POST'),'원본 영상 업로드와 서버 변경 없음')
    console.log('spin360-browser: real video/70 frames, 4 transparent photos/order/white background/no AI, MP470frames3.5s, drag/keyboard, ZIP, offline HTML, XSS, stale guard, cancellation and desktop/mobile passed')
  }
  assert.deepEqual(errors,[],'브라우저 오류 없음');assert.deepEqual(blocked,[],'의도하지 않은 외부 요청 없음')
} finally { await browser?.close();await server.close() }
