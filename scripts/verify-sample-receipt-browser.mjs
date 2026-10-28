import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

const root = process.cwd(), folder = path.join(root, '.tmp/sample-receipt-browser'), origin = 'http://127.0.0.1:5198'
fs.mkdirSync(folder, { recursive: true })
fs.writeFileSync(path.join(folder, 'entry.tsx'), `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {DraftSheetRow} from '@/features/drafts/DraftSheetRow';import {emptyDraftInput} from '@/lib/drafts/empty-draft';import {receiveSample,registerNextReceivedSample} from '@/lib/drafts/sample-receipt';import {normalizeSampleWorkOrders,setLatestSampleWorkOrderPassed} from '@/lib/drafts/sample-work-order';import '@/index.css';
const seed={...emptyDraftInput(),id:'draft',draftNo:'PL-TEST',nameKo:'검증 상품',owner:'기획 담당',originCountry:'중국',createdAt:'2026-10-19',sampleWorkOrders:[{id:'first',round:1,url:'data:text/plain,old',name:'first.pdf',shipped:true,shippedAt:'2026-10-20T01:00:00Z',returnedAt:'2026-10-22T01:00:00Z',passed:false,passedAt:null,failReason:'',assigneeId:null,assigneeName:'',fileCheckedAt:null}]};
function Fixture(){const [draft,setDraft]=useState(()=>{const data=JSON.parse(sessionStorage.getItem('sample-fixture')||'null')||seed;return {...data,sampleWorkOrders:normalizeSampleWorkOrders(data.sampleWorkOrders)}});const [readOnly,setReadOnly]=useState(false);const state=window.__sampleFixture={draft,writes:window.__writes||0,fail:window.__fail||false};const noop=async()=>{};
async function persist(next){if(window.__fail){window.__fail=false;throw new Error('검증 저장 실패')}window.__writes=(window.__writes||0)+1;sessionStorage.setItem('sample-fixture',JSON.stringify(next));setDraft(next)}
return <main className='p-4'><button onClick={()=>setReadOnly(v=>!v)}>권한 전환</button><button onClick={()=>setDraft({...seed,sampleWorkOrders:[{...seed.sampleWorkOrders[0],shipped:false,returnedAt:null}]})}>발송 대기 검증</button><div className='draft-board-scroll'><table className='draft-board-table'><colgroup>{Array.from({length:6},(_,i)=><col key={i}/>)}</colgroup><thead><tr>{['BRAND','SAMPLE','PRICE','COLOR','INFORMATION','MD TEAM'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody><DraftSheetRow draft={draft} readOnly={readOnly} onOpen={()=>{}} onSchedule={()=>{}} onAddColor={noop} onRenameProduct={noop} onRenameColor={noop} onSaveSheetValue={noop} onUploadSampleWorkOrder={noop} onUploadColorWorkOrder={noop} onPassColorSample={noop} onRequestNextColorSampleRound={noop} onToggleConfirm={noop} onReceiveSample={async id=>persist({...draft,sampleWorkOrders:receiveSample(draft.sampleWorkOrders,id,draft.originCountry)})} onRequestNextSampleRound={async(file,country)=>persist({...draft,originCountry:country,sampleWorkOrders:registerNextReceivedSample(draft.sampleWorkOrders,file,country,draft.originCountry)})} onPassSample={async()=>persist({...draft,sampleWorkOrders:setLatestSampleWorkOrderPassed(draft.sampleWorkOrders,true)})}/></tbody></table></div></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`)
const server = await createServer({ root, configFile: false, envDir: false, logLevel: 'error', plugins: [{ name: 'sample-receipt-fixture', configureServer(vite) { vite.middlewares.use((req, res, next) => { if (!req.headers.accept?.includes('text/html')) return next(); vite.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.tmp/sample-receipt-browser/entry.tsx"></script></body></html>').then(html => { res.setHeader('Content-Type','text/html');res.end(html) }).catch(next) }) } }, react(), tailwindcss()], resolve: { alias: { '@': path.join(root,'src') } }, server: { host:'127.0.0.1',port:5198,strictPort:true,hmr:false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true })
  const page = await browser.newPage({viewport:{width:1500,height:1000}}), errors=[], remote=[]
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(remote.push(route.request().url()),route.abort()))
  await page.goto(origin,{timeout:120000})
  const row=page.locator('.draft-sheet-row'), receipt=page.getByRole('button',{name:'수령 확인',exact:true})
  await receipt.waitFor();assert.equal(await row.getByRole('button',{name:'샘플 합격',exact:true}).count(),0)
  await page.evaluate(()=>{window.__fail=true});await receipt.click();await row.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.__sampleFixture.draft.sampleWorkOrders.length),1)
  await receipt.click();const next=page.getByRole('button',{name:'2차 작업지시서 작성',exact:true});await next.waitFor();assert.equal(await page.evaluate(()=>window.__sampleFixture.draft.sampleWorkOrders[0].passed),false)
  const routeBox=await row.locator('.draft-sample-route').first().boundingBox(),intervalBox=await row.locator('.draft-sample-interval').first().boundingBox(),nextBox=await next.boundingBox()
  assert.ok(intervalBox.y>=routeBox.y+routeBox.height-1,'경과일은 등록·발송 구분선 아래에 표시')
  assert.ok(nextBox.y>=intervalBox.y,'다음 지시서 버튼은 경과일 아래 영역에 표시')
  assert.equal(await page.getByRole('columnheader').nth(1).textContent(),'SAMPLE')
  assert.ok((await row.locator(':scope > td').nth(1).boundingBox()).width>=340,'원본처럼 SAMPLE 열 너비 확보')
  await page.screenshot({path:'.tmp/sample-reference-desktop.png',fullPage:true})
  await next.click();const dialog=page.getByRole('dialog',{name:'2차 작업지시서 작성',exact:true});await dialog.waitFor();assert.equal(await page.evaluate(()=>window.__writes),1)
  await dialog.getByRole('button',{name:'취소',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.__sampleFixture.draft.sampleWorkOrders.length),1)
  await next.click();await dialog.getByRole('button',{name:'2차 작업지시서 등록',exact:true}).click();await dialog.getByRole('alert').waitFor()
  await dialog.getByLabel('작업지시서 파일',{exact:true}).setInputFiles({name:'second.pdf',mimeType:'application/pdf',buffer:Buffer.from('new work order')})
  await dialog.getByText('선택한 파일: second.pdf',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__writes),1)
  await dialog.getByLabel('제조국',{exact:true}).selectOption('한국');await page.setViewportSize({width:390,height:844});assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false)
  await page.screenshot({path:'.tmp/sample-reference-mobile-dialog.png',fullPage:false})
  await page.evaluate(()=>{window.__fail=true});await dialog.getByRole('button',{name:'2차 작업지시서 등록',exact:true}).click();await dialog.getByRole('alert').getByText('검증 저장 실패',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__sampleFixture.draft.sampleWorkOrders.length),1);await dialog.getByText('선택한 파일: second.pdf',{exact:true}).waitFor()
  await dialog.getByRole('button',{name:'2차 작업지시서 등록',exact:true}).click();await dialog.waitFor({state:'detached'});await page.getByRole('region',{name:'2차 샘플',exact:true}).waitFor()
  const saved=await page.evaluate(()=>window.__sampleFixture.draft);assert.equal(saved.sampleWorkOrders.length,2);assert.equal(saved.sampleWorkOrders[0].url,'data:text/plain,old');assert.equal(saved.sampleWorkOrders[0].returnedAt,'2026-10-22T01:00:00Z');assert.ok(saved.sampleWorkOrders[0].receivedAt);assert.equal(saved.sampleWorkOrders[1].originCountry,'한국');assert.equal(saved.sampleWorkOrders[1].receivedAt??null,null)
  await page.reload();await receipt.waitFor();assert.equal(await page.evaluate(()=>window.__sampleFixture.draft.sampleWorkOrders.length),2);assert.ok(await row.getByText(/수령 후 \d+일/).count());assert.equal(await receipt.isEnabled(),true,'국내 샘플은 중국 발송 없이 수령 확인')
  const progress=row.locator('[aria-label="샘플 등록·수령 이력"]'),text=await progress.textContent();await page.getByRole('button',{name:'권한 전환',exact:true}).click();assert.equal(await progress.textContent(),text);assert.equal(await receipt.isDisabled(),true)
  await page.getByRole('button',{name:'권한 전환',exact:true}).click();await page.getByRole('button',{name:'발송 대기 검증',exact:true}).click();assert.equal(await receipt.isDisabled(),true)
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[])
  console.log('sample-receipt-browser: 실제 목록의 수령·재시도·등록 전 무저장·취소·파일 유지·차수 이력·재조회·권한별 동일 표시·국내/중국·모바일 검증 통과')
} finally { await browser?.close();await server.close() }
