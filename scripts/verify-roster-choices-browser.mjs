import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import path from 'node:path'
import {build} from 'esbuild'
import {createServer} from 'node:http'
import {chromium} from 'playwright-core'
const root=process.cwd(),dir=path.join(root,'.tmp','roster-choices-browser')
await mkdir(dir,{recursive:true})
await writeFile(path.join(dir,'auth.ts'),`export const useAuth=()=>({profile:{id:'manager',companyId:'company',status:'active'}});`)
await writeFile(path.join(dir,'client.ts'),`
const rows=[{header_key:'bankName',label:'급여은행',choice_options:['은행 A'],choice_revision:1}];
export function concurrent(){rows[0].choice_options=['서버 변경 은행'];rows[0].choice_revision++}
export function getSupabase(){return {from:()=>{const q={select:()=>q,eq:()=>q,in:()=>q,then:(ok)=>Promise.resolve({data:structuredClone(rows),error:null}).then(ok)};return q},rpc:async(name,args)=>{let row=rows.find(r=>r.header_key===args.p_key);if(row&&row.choice_revision!==args.p_revision)return {data:null,error:{code:'40001',message:'목록 충돌'}};if(!row){row={header_key:args.p_key,label:args.p_key,choice_revision:0};rows.push(row)}row.choice_options=args.p_options;row.choice_revision++;return {data:null,error:null}}}}
`)
await writeFile(path.join(dir,'entry.tsx'),`
import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{RosterChoiceSettings}from'@/features/org/RosterChoiceSettings';import{useRosterChoiceSettings}from'@/features/org/use-roster-choice-settings';import{rosterChoiceValues}from'@/lib/company/roster-choices';import{concurrent}from'./client';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
function Screen(){const query=useRosterChoiceSettings();return <main style={{padding:24,maxWidth:1100,margin:'auto'}}><h1>직원 배치 선택 목록 · 격리 검증</h1><label>기존 직원 값 보존<select aria-label="은행명 선택 미리보기" defaultValue="예전 은행">{rosterChoiceValues(query.data?.settings.find(r=>r.key==='bankName')?.options??[],'예전 은행').map(value=><option key={value}>{value}</option>)}</select></label><button onClick={async()=>{concurrent();await cache.invalidateQueries({queryKey:['employee-roster-choice-settings']})}}>다른 관리자 저장</button><RosterChoiceSettings canEdit={true}/></main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><Screen/></QueryClientProvider>);
`)
await build({entryPoints:[path.join(dir,'entry.tsx')],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',jsx:'automatic',define:{'import.meta.env':'{}'},plugins:[{name:'mock-client',setup(b){b.onResolve({filter:/^\./},args=>{const target=path.resolve(path.dirname(args.importer),args.path).replace(/\.tsx?$/,'');if(target===path.join(root,'src/lib/supabase/client'))return {path:path.join(dir,'client.ts')}})}}],alias:{'@/lib/supabase/auth':path.join(dir,'auth.ts'),'@/lib/supabase/client':path.join(dir,'client.ts'),'@':path.join(root,'src')},logLevel:'silent'})
const css=(await readdir('dist/assets')).find(name=>/^index-.*\.css$/.test(name))
const server=createServer(async(req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.join(dir,'app.js')))}else if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(path.join('dist/assets',css)))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')}})
let browser
try{
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',error=>errors.push(error.message))
const origin=`http://127.0.0.1:${server.address().port}`;await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin)
const bank=page.getByRole('article').filter({has:page.getByRole('heading',{name:/^급여은행/})})
await bank.getByRole('textbox',{name:'급여은행 추가'}).waitFor();assert.equal(await page.getByRole('article').count(),8)
assert.equal(await page.getByLabel('은행명 선택 미리보기').inputValue(),'예전 은행')
await bank.getByRole('textbox',{name:'급여은행 추가'}).fill('은행 B');await bank.getByRole('button',{name:'추가',exact:true}).click();await bank.getByText('은행 B',{exact:true}).waitFor()
assert.deepEqual(await page.getByLabel('은행명 선택 미리보기').locator('option').allTextContents(),['예전 은행','은행 A','은행 B'])
await bank.getByRole('button',{name:'은행 B 위로',exact:true}).click()
await page.waitForFunction(()=>document.querySelector('[aria-label="은행명 선택 미리보기"]').options[1].textContent==='은행 B')
const aRow=bank.getByRole('listitem').filter({has:page.getByText('은행 A',{exact:true})})
await aRow.getByRole('button',{name:'수정',exact:true}).click();await bank.getByRole('textbox',{name:'은행 A 이름'}).fill('은행 C');await bank.getByRole('button',{name:'저장',exact:true}).click();await bank.getByText('은행 C',{exact:true}).waitFor()
await bank.getByRole('textbox',{name:'급여은행 추가'}).fill('은행 B');await bank.getByRole('button',{name:'추가',exact:true}).click();await bank.getByText('중복된 선택 항목이 있습니다.',{exact:true}).waitFor()
const cRow=bank.getByRole('listitem').filter({has:page.getByText('은행 C',{exact:true})})
await cRow.getByRole('button',{name:'수정',exact:true}).click();await bank.getByRole('textbox',{name:'은행 C 이름'}).fill('입력 중인 은행');await page.getByRole('button',{name:'다른 관리자 저장'}).click()
await bank.getByText('목록이 변경됐습니다. 입력 중인 내용은 보존했습니다. 취소 후 최신 목록을 확인해 주세요.',{exact:true}).waitFor()
assert.equal(await bank.getByRole('textbox',{name:'은행 C 이름'}).inputValue(),'입력 중인 은행');assert.equal(await bank.getByRole('button',{name:'저장',exact:true}).isDisabled(),true)
await bank.getByRole('button',{name:'취소',exact:true}).click();await bank.getByText('서버 변경 은행',{exact:true}).waitFor()
await bank.getByRole('button',{name:'삭제',exact:true}).click();await bank.getByText('등록된 급여은행 항목이 없습니다.',{exact:true}).waitFor()
assert.equal(await page.getByLabel('은행명 선택 미리보기').inputValue(),'예전 은행')
await page.screenshot({path:path.join(dir,'verified.png'),fullPage:true});assert.deepEqual(errors,[])
console.info('Roster choices browser: eight catalogs, add/rename/reorder/delete, legacy values, duplicates and concurrent-edit preservation passed')
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
