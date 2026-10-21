import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {once} from 'node:events'
import http from 'node:http'
import {chromium} from 'playwright-core'
import {startViewer} from '../dev-tools/permission-rollout/serve.mjs'

const root=process.cwd(),directory=path.join(root,'.tmp/permission-rollout/browser-fixture')
await fs.mkdir(directory,{recursive:true})
const reportFile=path.join(directory,'report.json')
const bot=(dept,position)=>({id:`bot:${dept}:${position}`,name:`[봇] ${dept} · ${position}`,companyId:'company',departmentId:dept,departmentName:dept,position,isVirtual:true})
const report={capturedAt:'2026-10-21T00:00:00Z',counts:{profiles:1,approvers:1,departments:2,bots:4},comparisonLimit:'로컬 검증 자료',blockers:[],people:[{name:'<img src=x onerror=alert(1)>',department:'검증팀',status:'active',position:'사원',previous:[],next:[],added:[],removed:[],notes:[]}],departments:[{id:'기획팀',name:'기획팀',isActive:true},{id:'물류팀',name:'물류팀',isActive:true}],titles:[{companyId:'company',kind:'grade',name:'과장'},{companyId:'company',kind:'grade',name:'부장'}],bots:['기획팀','물류팀'].flatMap(d=>['팀장','대표이사'].map(p=>bot(d,p))),permissions:[{code:'org.manage',label:'조직·직책·직급 관리'}],approvers:[{department:'기획팀',type:'leave',approver:'실제 승인자',substitute:'미지정'}],checks:[{name:'원본 유지',detail:'로컬 검증',passed:true}]}
await fs.writeFile(reportFile,JSON.stringify(report))
const server=startViewer({port:0,reportFile})
await once(server,'listening')
const origin=`http://127.0.0.1:${server.address().port}`
let browser
const errors=[],remote=[],mutations=[]
try {
  assert.equal((await fetch(origin+'/',{method:'POST'})).status,405)
  assert.equal((await fetch(origin+'/source.json')).status,404)
  assert.equal((await fetch(origin+'/.tmp/permission-rollout/source.json')).status,404)
  const rejectedHost=await new Promise((resolve,reject)=>{const request=http.request(origin+'/',{headers:{Host:'outside.example'}},response=>{response.resume();resolve(response.statusCode)});request.on('error',reject);request.end()})
  assert.equal(rejectedHost,403)
  assert.equal((await fetch(origin+'/health')).headers.get('access-control-allow-origin'),null)
  browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  const context=await browser.newContext({viewport:{width:1440,height:1000}})
  await context.route('**/*',route=>{
    const r=route.request()
    if(!r.url().startsWith(origin+'/')){remote.push(r.url());return route.abort()}
    if(!['GET','HEAD'].includes(r.method()))mutations.push(r.method())
    return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin)
  await page.getByRole('heading',{name:'권한 전환 점검'}).waitFor()
  await page.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor()
  assert.equal(await page.locator('td img').count(),0,'이름의 HTML은 실행하지 않음')
  await page.getByRole('button',{name:'부서·직책별 봇',exact:true}).click()
  assert.equal(await page.locator('#bot-list button').count(),4)
  await page.getByLabel('부서',{exact:true}).selectOption('기획팀')
  await page.getByLabel('직책',{exact:true}).selectOption('대표이사')
  assert.equal(await page.locator('#bot-list button').count(),1)
  await page.getByRole('button',{name:'[봇] 기획팀 · 대표이사',exact:true}).click()
  await page.getByText('지정된 권한 없음 · 대표이사·팀장 직책이어도 자동 권한 없음',{exact:true}).waitFor()
  const permission=page.getByRole('checkbox',{name:'조직·직책·직급 관리'})
  await permission.check()
  await page.getByLabel('가상 직급',{exact:true}).selectOption('부장')
  await page.getByText('명시적으로 지정한 1개만 허용 · 직급: 부장 · 직급과 무관',{exact:true}).waitFor()
  await page.getByLabel('부서',{exact:true}).selectOption('물류팀')
  assert.equal(await page.getByRole('checkbox').count(),0,'필터에서 사라진 봇의 지정 화면 종료')
  await page.getByRole('button',{name:'[봇] 물류팀 · 대표이사',exact:true}).click()
  assert.equal(await permission.isChecked(),false,'다른 봇으로 지정이 섞이지 않음')
  await page.getByLabel('부서',{exact:true}).selectOption('기획팀')
  await page.getByRole('button',{name:'[봇] 기획팀 · 대표이사',exact:true}).click()
  assert.equal(await permission.isChecked(),true,'선택한 봇의 모의 지정만 메모리에 유지')
  await page.getByRole('button',{name:'이 봇 지정 초기화',exact:true}).click()
  assert.equal(await permission.isChecked(),false)
  await permission.check()
  await page.reload()
  await page.getByRole('button',{name:'부서·직책별 봇',exact:true}).click()
  await page.getByRole('button',{name:'[봇] 기획팀 · 대표이사',exact:true}).click()
  assert.equal(await permission.isChecked(),false,'새로고침하면 가상 지정 초기화')
  await page.getByRole('button',{name:'기존 승인자',exact:true}).click()
  await page.getByText('실제 승인자',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:/저장|승인하기|SQL 실행/}).count(),0)
  await page.getByRole('button',{name:'적용·복구와 검증',exact:true}).click()
  await page.getByRole('heading',{name:'검증 결과',exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'모바일에서 페이지 가로 넘침 없음')
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);assert.deepEqual(mutations,[])
  await context.close()
  console.log('permission-rollout-browser: 부서·직책 봇 필터·직급 독립·모의 지정 격리/초기화·승인자 원본 표시·HTML 안전 표시·모바일·외부 요청/쓰기 0건·루프백 GET 전용 통과')
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
