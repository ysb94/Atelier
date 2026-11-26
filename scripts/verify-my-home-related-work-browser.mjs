import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = process.cwd(), dir = path.join(root, '.tmp', 'my-home-related-work-browser')
await mkdir(dir, { recursive: true })
const actor = '10000000-0000-4000-8000-000000000001'
await writeFile(path.join(dir, 'auth.ts'), `export const useAuth=()=>({profile:{id:window.fixture.actor,companyId:'e0000000-0000-4000-8000-000000000001',status:'active'},session:{user:{id:window.fixture.actor}}});`)
await writeFile(path.join(dir, 'client.ts'), `
const actor='${actor}',worker='10000000-0000-4000-8000-000000000002';
const id=i=>'20000000-0000-4000-8000-'+String(i).padStart(12,'0');
const now='2026-11-26T12:00:00Z';
const card={id:id(1),title:'개인 피드백 검증',description:'이 상세를 열었을 때만 읽음',status:'feedback',round:1,revision:3,created_at:now,created_by:actor,creator_name:'요청자',assignee_id:worker,assignee_name:'담당자',reviewer_id:actor,reviewer_name:'검토자',events:[]};
const notice={id:id(2),card_id:card.id,card_revision:3,round:1,title:card.title,requester_name:'담당자',created_at:now,read_at:null,resolved_at:null,note:'검토해 주세요.'};
window.fixture={actor,audit:[],cards:[card,{...card,id:id(3),title:'본인 개인 할 일',assignee_id:actor,status:'todo',reviewer_id:null}],error:false,cardError:false,missing:false};
const state=window.fixture;
function result(data,error=null){const promise=Promise.resolve({data,error});promise.abortSignal=()=>promise;return promise;}
function summary(card){return {key:'personal:'+card.id,source:'personal',id:card.id,owner:null,title:card.title,requesterName:card.creator_name,assigneeNames:[card.assignee_name],status:card.status,round:1,noticeId:notice.resolved_at?null:notice.id,targets:[],activityAt:now};}
const department=Array.from({length:24},(_,i)=>({key:'department:'+id(i+10),source:'department',id:id(i+10),owner:['planning','design','md','logistics'][i%4],title:i===0?'긴업무제목'.repeat(30):'지시한 부서 업무 '+i,requesterName:'요청자',assigneeNames:['담당자'],isRequester:true,status:['completed','cancelled','rejected','inProgress'][i%4],activityAt:now,round:null,noticeId:null,targets:[]}));
export const getSupabase=()=>({
 rpc(name,args={}){
  state.audit.push({name,args});
  if(name==='list_personal_work_cards')return state.cardError?result(null,{code:'08006',message:'card read failure'}):result(structuredClone(state.actor===actor?state.cards:[]));
  if(name==='list_personal_work_members')return result([]);
  if(name==='list_my_home_related_work'){
   if(state.missing)return result(null,{code:'PGRST202',message:'missing'});
   if(state.error)return result(null,{code:'08006',message:'test connection failure'});
   const visual={...department[1],title:'Visual 두 분류 피드백',status:'completionReview',isRequester:false,targets:[{categoryId:'banner',label:'배너',kind:'middle_review',version:5},{categoryId:'video',label:'영상',kind:'supervisor_review',version:6}]};
   let items=state.actor!==actor?[]:args.p_view==='feedback'?(card.status==='feedback'?[summary(card),visual]:[visual]):[summary(card),...department];
   const total=items.length,offset=args.p_before_key?20:0;
   return result({items:items.slice(offset,offset+20),total,nextCursor:offset+20<total?{at:now,key:'next-page'}:null});
  }
  if(name==='read_personal_work_feedback_notice'){
   if(args.p_id!==notice.id||args.p_revision!==notice.card_revision)return result(null);
   notice.read_at=now;return result(now);
  }
  if(name==='personal_work_action'){
   card.status=args.p_action==='approve'?'done':'todo';card.revision++;notice.resolved_at=now;return result(card.revision);
  }
  throw new Error('Unexpected RPC '+name);
 },
 from(table){
  if(table!=='personal_work_feedback_notices')throw new Error('Unexpected table '+table);
  let single=false;const filters={};
  const query={select(){return query},eq(key,value){filters[key]=value;return query},order(){return query},limit(){return query},abortSignal(){return query},maybeSingle(){single=true;return query},
   then(resolve,reject){const rows=state.actor===actor&&(!filters.id||filters.id===notice.id)?[{...notice}]:[];return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve,reject)}};
  return query;
 }
});`)
await writeFile(path.join(dir, 'entry.tsx'), `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BrowserRouter,useSearchParams}from'react-router-dom';
import{MyWorkBoard}from'@/features/settings/MyWorkBoard';import{WorkspaceTabActivityContext}from'@/components/layout/workspace-tab-activity';
import './client';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
function App(){const[params,setParams]=useSearchParams();const[active,setActive]=useState(true);const[actor,setActor]=useState(window.fixture.actor);
 Object.assign(window.fixture,{cache,toggle:()=>setActive(v=>!v),switchActor:()=>{window.fixture.actor='10000000-0000-4000-8000-000000000003';setActor(window.fixture.actor)},refresh:()=>cache.invalidateQueries({queryKey:['my-home-related-work',actor]})});
 return <main className="p-6"><WorkspaceTabActivityContext.Provider value={active}><MyWorkBoard key={actor} feedbackActorId={actor} active={active} noticeId={params.get('personalWorkFeedback')??undefined}
 onCloseNotice={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('personalWorkFeedback');return next},{replace:true})}/></WorkspaceTabActivityContext.Provider></main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><BrowserRouter><App/></BrowserRouter></QueryClientProvider>);`)
const mocks = { '@/lib/supabase/auth': path.join(dir, 'auth.ts'), '@/lib/supabase/client': path.join(dir, 'client.ts') }
await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env': '{}' }, alias: { ...mocks, '@': path.join(root, 'src') }, logLevel: 'silent',
  plugins: [{ name: 'relative-client-auth', setup(b) { b.onResolve({ filter: /^\./ }, args => {
    const resolved = path.resolve(path.dirname(args.importer), args.path).replace(/\.tsx?$/, '')
    for (const [source, target] of Object.entries(mocks)) if (resolved === path.join(root, source.replace('@/', 'src/'))) return { path: target }
  }) } }],
})
const css = (await readdir('dist/assets')).filter(name => name.endsWith('.css'))
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(path.join(dir, 'app.js'))) }
  else if (req.url === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end((await Promise.all(css.map(name => readFile(path.join('dist/assets', name), 'utf8')))).join('\n')) }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>') }
})
let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  await page.goto(origin + '/settings/profile?part=my-work')
  const feedback = page.getByRole('region', { name: '피드백 온 업무', exact: true })
  const issued = page.getByRole('region', { name: '내가 지시한 업무', exact: true })
  await feedback.getByRole('button', { name: /개인 피드백 검증/ }).waitFor()
  for (const name of ['ToDo', 'ing', 'feedback', 'done']) assert.equal(await page.getByRole('region', { name, exact: true }).count(), 1)
  assert.equal(await issued.getByRole('link').count() + await issued.getByRole('button', { name: /개인 피드백 검증/ }).count(), 20)
  assert.equal(await issued.getByText('완료', { exact: true }).count() > 0, true)
  assert.equal(await issued.getByText('취소', { exact: true }).count() > 0, true)
  assert.equal(await issued.getByText('반려', { exact: true }).count() > 0, true)
  assert.equal(await page.evaluate(() => window.fixture.audit.filter(row => row.name.startsWith('read_')).length), 0)
  const left = await feedback.boundingBox(), right = await issued.boundingBox()
  assert.ok(Math.abs(left.width - right.width) < 1 && Math.abs(left.y - right.y) < 1 && right.x > left.x)
  assert.match(await feedback.getByRole('link', { name: '배너 · 중간 검수 대기', exact: true }).getAttribute('href'), /visualTab=banner/)
  assert.equal(await feedback.getByRole('link', { name: /Visual 두 분류 피드백/ }).count(), 1)
  await issued.getByRole('button', { name: '더 보기', exact: true }).click()
  await issued.getByRole('link', { name: /지시한 부서 업무 23/ }).waitFor()
  assert.equal(await issued.getByRole('button', { name: '더 보기', exact: true }).count(), 0)
  assert.equal(await issued.getByRole('link').count(), 24)
  await page.screenshot({ path: path.join(dir, 'desktop.png'), fullPage: true })

  await feedback.getByRole('button', { name: /개인 피드백 검증/ }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByText('이 상세를 열었을 때만 읽음', { exact: true }).waitFor()
  await page.waitForFunction(() => window.fixture.audit.some(row => row.name === 'read_personal_work_feedback_notice'))
  assert.equal(await feedback.getByRole('button', { name: /개인 피드백 검증/ }).count(), 1, 'reading does not remove pending work')
  await drawer.getByRole('button', { name: '승인', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  await feedback.getByRole('button', { name: /개인 피드백 검증/ }).waitFor({ state: 'detached' })
  assert.equal(await issued.getByRole('button', { name: /개인 피드백 검증/ }).count(), 1, 'completed personal work remains issued')
  await issued.getByRole('button', { name: /개인 피드백 검증/ }).click()
  await drawer.getByText('이 상세를 열었을 때만 읽음', { exact: true }).waitFor()
  assert.ok(!new URL(page.url()).searchParams.has('personalWorkFeedback'), 'completed work opens independently of the old feedback notice')
  await drawer.getByRole('button', { name: '업무 카드 창 닫기', exact: true }).click()

  await page.evaluate(() => { window.fixture.error = true; window.fixture.refresh() })
  await feedback.getByRole('alert').waitFor()
  await page.evaluate(() => { window.fixture.error = false })
  await feedback.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await feedback.getByRole('alert').waitFor({ state: 'detached' })

  await page.evaluate(() => window.fixture.toggle())
  const beforeHidden = await page.evaluate(() => window.fixture.audit.filter(row => row.name === 'list_my_home_related_work').length)
  await page.evaluate(() => window.fixture.refresh())
  await page.waitForTimeout(250)
  assert.equal(await page.evaluate(() => window.fixture.audit.filter(row => row.name === 'list_my_home_related_work').length), beforeHidden, 'hidden board does not refetch')
  await page.evaluate(() => window.fixture.toggle())

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLeft = await feedback.boundingBox(), mobileRight = await issued.boundingBox()
  assert.ok(Math.abs(mobileLeft.x - mobileRight.x) < 1 && mobileRight.y > mobileLeft.y)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(dir, 'mobile.png'), fullPage: true })
  await page.evaluate(() => { window.fixture.missing = true; window.fixture.refresh() })
  await feedback.getByText(/부서 업무 서버 연결 대기 중/).waitFor()
  await feedback.getByText('피드백을 기다리는 업무가 없습니다.', { exact: true }).waitFor()
  assert.equal(await issued.getByRole('button', { name: /개인 피드백 검증/ }).count(), 1)
  await page.evaluate(() => { window.fixture.cardError = true; window.fixture.cache.invalidateQueries({ queryKey: ['personal-work-cards'] }) })
  await issued.getByRole('alert').waitFor()
  const beforeUnavailable = await page.evaluate(() => window.fixture.audit.filter(row => row.name === 'list_my_home_related_work').length)
  await page.waitForTimeout(250)
  assert.equal(await page.evaluate(() => window.fixture.audit.filter(row => row.name === 'list_my_home_related_work').length), beforeUnavailable, 'unavailable RPC is not retried by card cache updates')
  await page.evaluate(() => { window.fixture.cardError = false })
  await issued.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await issued.getByRole('alert').waitFor({ state: 'detached' })
  await page.evaluate(() => window.fixture.switchActor())
  await issued.getByText('지시한 업무가 없습니다.', { exact: true }).waitFor()
  assert.equal(await issued.getByRole('button', { name: /개인 피드백 검증/ }).count(), 0, 'account switch does not leak previous work')
  assert.deepEqual(errors, [])
  console.log('My home related work browser: desktop/mobile layout, pagination, links, detail-only reads, approval sync, retry, hidden tab, fallback and account switch passed')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
