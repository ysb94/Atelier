import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { china, company, createMaterialTestDatabase, ids } from './verify-material-request-workflow.mjs'

const { outputFiles } = await build({
  outdir: '.tmp/material-db-browser', write: false, bundle: true, format: 'esm', jsx: 'automatic', tsconfig: 'tsconfig.app.json',
  define: { 'import.meta.env': '{"DEV":true,"PROD":false}' },
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import {BrowserRouter,useLocation,useNavigate,Link} from 'react-router-dom'
    import {useState} from 'react'
    import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query'
    import {ChinaMaterialRequests} from './src/features/china/ChinaMaterialRequests'
    import {ChinaAssignedWorkOrders} from './src/features/china/ChinaAssignedWorkOrders'
    import {ChinaWorkOrderTabs} from './src/features/china/ChinaWorkOrderTabs'
    import {getMyChinaWorkOrders} from './src/lib/supabase/china-assigned-work-orders'
    import {createRoot} from 'react-dom/client'
    import {MaterialRequestsPage} from './src/features/planning/MaterialRequestsPage'
    import {MaterialNudgeNotice} from './src/features/planning/MaterialNudgeDialog'
    import {NotificationPanel} from './src/components/layout/NotificationPanel'
    import {ReleaseAccessProvider,useReleaseAccess} from './src/components/layout/release-access-context'
    import {ReleasePageGate} from './src/components/layout/ReleasePageGate'
    import {companyNavGroupsForProfile} from './src/components/layout/company-workspace-nav'
    import {MATERIAL_REQUESTS_PATH} from './src/lib/workspace/material-request-navigation'
    const ids = ${JSON.stringify(ids)}
    const actors = { planning: ids.requester, manager: ids.manager, managerBoard: ids.manager, worker: ids.worker, other: ids.other, recipient: ids.worker, scoreRecipient: ids.viewer, dualRecipient: ids.colleague }
    function ManagerBoard() {
      const screen=useQuery({queryKey:['china-work-screen',window.actor],queryFn:getMyChinaWorkOrders})
      return <ChinaWorkOrderTabs workloads={screen.data?.workloads} unchecked={new Map()} unreceived={0}>{()=>null}</ChinaWorkOrderTabs>
    }
    function NudgeInbox() {
      const [item,setItem]=useState(null)
      const [open,setOpen]=useState(true)
      const navigate=useNavigate()
      const {href,materialNudgeAccountId,materialNudgeNotifications,refreshMaterialNudges}=useReleaseAccess()
      return <><button onClick={()=>{setOpen(true);void refreshMaterialNudges({cancelRefetch:false})}}>알림 열기</button>
        {open && <NotificationPanel items={materialNudgeNotifications} titleId="notifications" onOpen={notice=>{
          const target=notice.href && href(notice.href)
          setOpen(false)
          if(target) navigate(target); else setItem(notice)
        }} onClose={()=>setOpen(false)}/>}
        {item && <MaterialNudgeNotice item={item} accountId={materialNudgeAccountId} onClose={()=>setItem(null)}/>}</>
    }
    function FixtureNavigation() {
      const {profile,materialNudgeViewer}=useReleaseAccess()
      return <nav aria-label="부서 메뉴">{companyNavGroupsForProfile(profile,materialNudgeViewer).flatMap(group=>
        group.items.map(item=><Link key={item.to} to={item.to}>{item.label}</Link>))}</nav>
    }
    function App() {
      const [screen,setScreen]=useState(()=>{
        const selected=location.hash.slice(1) || sessionStorage.getItem('material-fixture-actor') || 'planning'
        sessionStorage.setItem('material-fixture-actor',selected)
        return selected
      })
      const locationState=useLocation()
      const navigate=useNavigate()
      const [previousActive,setPreviousActive]=useState(true)
      const [selectedAssigneeId,setSelectedAssigneeId]=useState(null)
      const recipientScreen=['recipient','scoreRecipient','dualRecipient'].includes(screen)
      window.actor=actors[screen]
      return <ReleaseAccessProvider><nav>{Object.keys(actors).map(item=><button key={item} onClick={()=>{sessionStorage.setItem('material-fixture-actor',item);navigate('/#'+item);setScreen(item)}}>{item}</button>)}</nav>
        <FixtureNavigation />
        {recipientScreen && <NudgeInbox />}
        {locationState.pathname===MATERIAL_REQUESTS_PATH ? <ReleasePageGate><MaterialRequestsPage /></ReleasePageGate>
          : screen==='planning' ? <MaterialRequestsPage/> : screen==='manager'
          ? <><button onClick={()=>setPreviousActive(v=>!v)}>Toggle previous employment</button>
              <button onClick={()=>setSelectedAssigneeId(ids.worker)}>Assigned to worker</button>
              <ChinaMaterialRequests key={screen} selectedAssigneeId={selectedAssigneeId} activeAssigneeIds={new Set(previousActive ? [ids.worker,ids.other] : [ids.other])} assignees={[{id:ids.worker,name:'담당 직원'},{id:ids.other,name:'다른 직원'}]}/></>
          : recipientScreen ? null
          : screen==='managerBoard' ? <ManagerBoard/>
          : <ChinaAssignedWorkOrders key={screen} accountId={actors[screen]} orders={[]} brandById={new Map()}/>}</ReleaseAccessProvider>
    }
    createRoot(document.querySelector('#root')).render(<QueryClientProvider client={new QueryClient()}><BrowserRouter><App/></BrowserRouter></QueryClientProvider>)
  ` },
  plugins: [{ name: 'material-fixture', setup(builder) {
    builder.onResolve({ filter: /^@\/(?:lib\/supabase\/auth|components\/layout\/company-brand-scope|components\/layout\/workspace-tab-overlay)$/ }, args => ({ path:args.path,namespace:'fixture' }))
    builder.onResolve({ filter: /^@\/(?:features\/operations-support\/use-department-approvers|lib\/company\/workforce-management-context)$/ }, args =>
      /release-access-context\.tsx$/.test(args.importer) ? {path:args.path,namespace:'fixture'} : null)
    builder.onResolve({ filter: /^@\/lib\/supabase\/profiles$/ }, args => /(?:MaterialNudge(?:Dialog|Settings)|ChinaWorkOrderTabs|ChinaAssigneeManager)\.tsx$/.test(args.importer) ? {path:args.path,namespace:'fixture'} : null)
    builder.onResolve({ filter: /^\.\/client$/ }, args => /(?:material-(?:requests|nudges|nudge-recipients)|china-(?:assigned-work-orders|work-assignees))\.ts$/.test(args.importer) ? {path:'client',namespace:'fixture'} : null)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path === 'client' ? `
        const options=()=>({'x-actor':window.actor})
        function rpc(name,payload){
          let signal;
          return { abortSignal(value){signal=value;return this}, then(ok,fail){
            return fetch('/rpc/'+name,{method:'POST',signal,headers:options(),body:JSON.stringify(payload)}).then(r=>r.json()).then(ok,fail)
          } }
        }
        const from=name=>{
          const params={operation:'select',filters:{}};
          return {select(){return this},eq(key,value){params.filters[key]=value;return this},order(){return this},
            delete(){params.operation='delete';return this},then(resolve,reject){return rpc(name,params).then(resolve,reject)}};
        }
        export const getSupabase=()=>({rpc,from,storage:{from:()=>({
          upload:(path,file)=>fetch('/files/'+path,{method:'POST',headers:options(),body:file}).then(r=>r.json()),
          download:async path=>{const r=await fetch('/files/'+path,{headers:options()});return r.ok?{data:await r.blob(),error:null}:r.json()}
        })}})
      ` :
      args.path.endsWith('/auth') ? `const people=new Map(); export const useAuth=()=>{const id=window.actor;if(!people.has(id))people.set(id,{session:{user:{id}},profile:{id,companyId:'${company}',departmentId:['${ids.requester}','${ids.colleague}'].includes(id)?'ced99f89-ea80-4eeb-8f03-272bf72f5db1':id==='${ids.viewer}'?null:'${china}',status:'active',displayName:'테스트 디자이너'}});return people.get(id)}; export const AuthProvider=({children})=>children;` :
      args.path.endsWith('/use-department-approvers') ? `const state={settings:[],loading:false,error:null,refresh:async()=>{}}; export const useDepartmentApprovers=()=>state;` :
      args.path.endsWith('/workforce-management-context') ? `export const useWorkforceManagement=()=>null;` :
      args.path.endsWith('/profiles') ? `export const listOrgChartMembers=async()=>[
        {id:'${ids.manager}',displayName:'김준영',position:'대표이사',departmentId:'${china}'},
        {id:'${ids.worker}',displayName:'김영인',position:'부대표',departmentId:'${china}'},
        {id:'${ids.other}',displayName:'다른 직원',departmentId:'${china}'},
        {id:'${ids.viewer}',displayName:'수신 직원',departmentId:null}
      ]; export const listDepartments=async()=>[{id:'${china}',name:'중국팀'}];` :
      args.path.endsWith('/company-brand-scope') ? `const brand={id:'${ids.brand}',slug:'sample',name:'Sample',color:'red',logoUrl:null}; export const useCompanyBrandScope=()=>({brandById:new Map([[brand.id,brand]]),brands:[brand]}); export const useCompanyBrandBase=()=>''; export const useScopedBrands=()=>[];` :
      'export const WorkspaceTabOverlay=({children})=>children; export const useWorkspaceTabOverlay=()=>null;',
    }))
  }}],
})

const db = await createMaterialTestDatabase()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const files = new Map()
const downloads = []
const errors = []
let holdDetail
let failConfirmation = false
await db.query('insert into public.material_nudge_recipients (company_id,profile_id) values ($1,$2),($1,$3)',
  [company, ids.manager, ids.worker])
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://material-board.invalid/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: outputFiles.find(f => f.path.endsWith('.js')).text })
    if (!/^\/(?:rpc|files)\//.test(path)) return route.fulfill({
      contentType: 'text/html', body: '<meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>',
    })
    const actor = req.headers()['x-actor']
    if (holdDetail && path.endsWith('/material_nudge_workspace') && req.postDataJSON().p_scope==='notice') {
      await holdDetail
    }
    if (failConfirmation && path.endsWith('/confirm_material_nudge_request')) {
      failConfirmation = false
      return route.fulfill({ status:503,json:{data:null,error:{code:'57014',message:'Fixture timeout'}} })
    }
    try {
      const result = await db.transaction(async tx => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor])
        await tx.exec('set local role authenticated')
        if (path.startsWith('/files/')) {
          const key = path.slice('/files/'.length)
          if (req.method() === 'POST') {
            await tx.query("insert into storage.objects values ('material-request-files',$1)", [key])
            files.set(key, req.postDataBuffer())
            return {data: {path:key},error:null}
          }
          downloads.push({actor,key})
          const { rows } = await tx.query("select name from storage.objects where name=$1 and bucket_id='material-request-files'", [key])
          return rows.length && files.has(key) ? files.get(key) : {error:{code:'42501',message:'파일에 접근할 수 없습니다.'}}
        }
        const p = req.postDataJSON()
        if (path.endsWith('/material_nudge_recipients')) {
          const { rows } = await tx.query('select profile_id from public.material_nudge_recipients order by profile_id')
          return {data:rows,error:null}
        }
        if (path.endsWith('/save_material_nudge_recipients_checked')) {
          await tx.query('select public.save_material_nudge_recipients_checked($1::uuid[],$2::uuid[])',
            [p.p_ids,p.p_expected_ids])
          return {data:null,error:null}
        }
        if (path.endsWith('/get_my_china_work_orders')) {
          const { rows } = await tx.query('select public.get_my_china_work_orders() as data')
          return {data:rows[0].data,error:null}
        }
        if (path.endsWith('/china_work_assignees')) {
          if (p.operation==='delete') {
            await tx.query('delete from public.china_work_assignees where company_id=$1 and profile_id=$2',
              [p.filters.company_id,p.filters.profile_id])
            return {data:null,error:null}
          }
          const { rows } = await tx.query('select profile_id,sort_order from public.china_work_assignees where company_id=$1 order by sort_order,created_at,profile_id',
            [p.filters.company_id])
          return {data:rows,error:null}
        }
        if (path.endsWith('/save_china_work_assignee_order')) {
          await tx.query('select public.save_china_work_assignee_order($1::uuid[],$2::uuid[])', [p.p_expected,p.p_ordered])
          return {data:null,error:null}
        }
        if (path.endsWith('/send_material_nudge')) {
          const { rows } = await tx.query('select public.send_material_nudge($1,$2,$3::uuid[],$4) data',
            [p.p_request,p.p_revision,p.p_recipients,p.p_event])
          return {data:rows[0].data,error:null}
        }
        if (path.endsWith('/list_my_material_nudges')) {
          const { rows } = await tx.query('select * from public.list_my_material_nudges()')
          return {data:rows,error:null}
        }
        if (path.endsWith('/material_nudge_workspace')) {
          const { rows } = await tx.query('select public.material_nudge_workspace($1,$2,$3) data',
            [p.p_scope,p.p_id??null,p.p_round??null])
          return {data:rows[0].data,error:null}
        }
        if (path.endsWith('/read_material_nudge')) {
          await tx.query('select public.read_material_nudge($1)', [p.p_id])
          return {data:null,error:null}
        }
        if (path.endsWith('/confirm_material_nudge_request')) {
          const { rows } = await tx.query('select public.confirm_material_nudge_request($1,$2::uuid[]) data',
            [p.p_request,p.p_notice_ids])
          return {data:rows[0].data,error:null}
        }
        const { rows } = path.endsWith('/read_material_requests')
          ? await tx.query('select public.read_material_requests($1,$2,$3) data', [p.p_scope,p.p_id??null,p.p_round??null])
          : await tx.query('select public.write_material_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) data',
            [p.p_action,p.p_id,p.p_revision,p.p_round,p.p_title,p.p_brand,p.p_blocks ? JSON.stringify(p.p_blocks) : null,p.p_stage,p.p_assignee,p.p_score])
        return {data:rows[0].data,error:null}
      })
      return Buffer.isBuffer(result)
        ? route.fulfill({ contentType:'image/png',body:result })
        : route.fulfill({ status:result.error ? 403 : 200,json:result })
    } catch (error) {
      return route.fulfill({ status:400,json:{data:null,error:{code:error.code,message:error.message}} })
    }
  })
  const open = async screen => {
    await page.goto('https://material-board.invalid/#'+screen)
    await page.reload()
    if (screen==='worker' || screen==='other' || screen==='managerBoard') await materialsTab.click()
  }
  const materialsTab = page.getByRole('group',{name:'중국팀 업무'}).getByRole('button',{name:/자재요청/})
  const expectWorkload = async (openCount, resting) => {
    await materialsTab.getByTitle('발송 전 자재요청 / 발송 후 완료 대기 자재요청')
      .filter({hasText: new RegExp('\\(\\s*'+openCount+'\\s*/\\s*'+resting+'\\s*\\)')}).waitFor()
  }
  await open('planning')
  await page.getByRole('button',{name:'조르기 설정',exact:true}).click()
  const settings = page.getByRole('dialog',{name:'조르기 설정',exact:true})
  const firstRecipient = settings.getByRole('checkbox',{name:'김준영 알림 받기'})
  const secondRecipient = settings.getByRole('checkbox',{name:'김영인 알림 받기'})
  await secondRecipient.uncheck()
  await db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.colleague])
    await tx.exec('set local role authenticated')
    await tx.query('select public.save_material_nudge_recipients_checked($1::uuid[],$2::uuid[])',
      [[ids.worker],[ids.manager,ids.worker]])
  })
  await settings.getByRole('button',{name:'저장',exact:true}).click()
  await settings.getByText(/다른 직원이 저장한 최신 수신자를 불러왔습니다/).waitFor()
  assert.equal(await firstRecipient.isChecked(),false)
  assert.equal(await secondRecipient.isChecked(),true)
  await firstRecipient.check()
  await settings.getByRole('button',{name:'저장',exact:true}).click()
  await settings.waitFor({state:'hidden'})
  await page.getByTitle('Sample',{exact:true}).click()
  await page.getByRole('button',{name:'자재 요청',exact:true}).click()
  await page.getByRole('textbox',{name:'요청 제목'}).fill('라벨 샘플')
  await page.locator('[contenteditable=true]').first().fill('요청 내용 확인')
  await page.locator('input[type=file]').last().setInputFiles({
    name:'swatch.png', mimeType:'image/png',
    buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64'),
  })
  await page.getByRole('button',{name:'작성 완료'}).click()
  await page.getByText('요청 예정으로 저장했습니다.').waitFor()
  const nudge = page.getByRole('button',{name:'조르기',exact:true})
  const nudgeDialog = page.getByRole('dialog',{name:'자재요청 조르기',exact:true})
  const message = '「라벨 샘플」 자재요청의 진행 상황을 확인해 주세요.'
  await nudge.click()
  await nudgeDialog.getByText('김준영 대표님, 김영인 부대표님').waitFor()
  await nudgeDialog.getByText(message,{exact:true}).waitFor()
  await nudgeDialog.getByRole('button',{name:'취소'}).click()
  assert.equal((await db.query('select count(*)::int count from app.material_nudge_notices')).rows[0].count,0)
  await nudge.click()
  await nudgeDialog.getByRole('button',{name:'확인',exact:true}).click()
  await page.getByText('2명에게 조르기 알림을 보냈습니다.').waitFor()
  await open('recipient')
  const departmentMenu = page.getByRole('navigation',{name:'부서 메뉴'})
  await departmentMenu.getByRole('link',{name:'자재요청',exact:true}).waitFor()
  assert.equal(await departmentMenu.getByRole('link',{name:'기획안',exact:true}).count(),0)
  const inboxNotice = page.getByRole('button',{name:/님의 자재요청 조르기/})
  await inboxNotice.waitFor()
  assert.equal((await db.query('select count(*)::int count from app.material_nudge_notices where read_at is not null')).rows[0].count,0)
  let resumeDetail
  holdDetail = new Promise(resolve => { resumeDetail=resolve })
  await inboxNotice.click()
  await page.waitForURL(url=>url.pathname==='/planning/material-requests' && url.searchParams.has('nudge'))
  const nudgeDetail = page.getByRole('dialog',{name:'자재요청 상세 보기'})
  await nudgeDetail.getByText('요청 내용을 불러오는 중…').waitFor()
  assert.equal((await db.query('select count(*)::int count from app.material_nudge_notices where read_at is not null')).rows[0].count,0)
  const readSaved = page.waitForResponse(response => response.url().endsWith('/read_material_nudge'))
  holdDetail = undefined
  resumeDetail()
  await nudgeDetail.getByText('요청 내용 확인',{exact:true}).waitFor()
  assert.equal(await nudgeDetail.getByRole('button',{name:'최근 저장 요청'}).getAttribute('aria-pressed'),'true')
  assert.equal(await nudgeDetail.locator('img').count(),1)
  assert.equal(await nudgeDetail.locator('[contenteditable=true]').count(),0)
  await readSaved
  assert.deepEqual((await db.query('select recipient_id from app.material_nudge_notices where read_at is not null')).rows,
    [{recipient_id:ids.worker}])
  const nudgeLink = new URL(page.url())
  await nudgeDetail.getByRole('button',{name:'자재요청 상세 닫기'}).click()
  const received = page.getByRole('table',{name:'공유받은 자재요청'})
  await received.getByRole('button',{name:'라벨 샘플'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'자재 요청',exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'조르기 설정',exact:true}).count(),0)
  await received.getByRole('button',{name:'라벨 샘플'}).click()
  await nudgeDetail.getByText('요청 내용 확인',{exact:true}).waitFor()
  await nudgeDetail.getByRole('button',{name:'자재요청 상세 닫기'}).click()
  nudgeLink.hash='other'
  await page.goto(nudgeLink.toString())
  await page.waitForURL(url=>url.pathname==='/settings/profile')
  assert.equal(await departmentMenu.getByRole('link',{name:'자재요청',exact:true}).count(),0)
  await open('manager')
  await page.getByText('새로운 자재요청이 없습니다.').waitFor()
  await open('planning')
  await page.getByRole('button',{name:'1차 요청 전송'}).click()
  await page.getByText('중국 발송 대기').waitFor()
  await open('manager')
  await page.getByRole('button',{name:'업무 배정',exact:true}).click()
  const warning=page.getByRole('alertdialog',{name:'업무 배정 전 확인'})
  await warning.getByText('담당자를 지정해 주세요.').waitFor()
  await warning.getByRole('button',{name:'확인'}).click()
  await page.getByRole('button',{name:'라벨 샘플 열기'}).click()
  await page.getByRole('dialog').getByText('요청 내용 확인',{exact:true}).waitFor()
  await page.getByRole('dialog').locator('img').waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'확인',exact:true}).click()
  await page.getByText('읽음',{exact:true}).waitFor()
  await page.getByRole('combobox',{name:'라벨 샘플 담당자 배정'}).selectOption(ids.worker)
  await page.getByRole('button',{name:'업무 배정',exact:true}).click()
  await page.getByText('새로운 자재요청이 없습니다.').waitFor()
  await open('other')
  await page.getByText('배정된 자재요청이 없습니다.').waitFor()
  await expectWorkload(0,0)
  await open('worker')
  await expectWorkload(1,0)
  assert.equal(await materialsTab.getByTitle('미확인 건수').textContent(),'1')
  assert.equal(await page.getByRole('group',{name:'내 자재요청 작업 상태'}).count(),0)
  await page.getByRole('button',{name:'라벨 샘플 열기'}).click()
  await page.getByRole('button',{name:'자재 요청 닫기'}).click()
  await page.getByRole('button',{name:'발송 처리',exact:true}).click()
  const shipping=page.getByRole('alertdialog',{name:'한국 발송 전 확인'})
  await shipping.getByText('요청 내용을 열고 확인을 눌러 주세요.').waitFor()
  await shipping.getByRole('button',{name:'확인'}).click()
  await page.getByRole('button',{name:'라벨 샘플 열기'}).click()
  await page.getByRole('dialog').getByRole('button',{name:'확인',exact:true}).click()
  await open('worker')
  await page.getByText('읽음',{exact:true}).waitFor()
  assert.equal(await materialsTab.getByTitle('미확인 건수').count(),0)
  await page.getByRole('button',{name:'발송 처리',exact:true}).click()
  await expectWorkload(0,1)
  await open('managerBoard')
  const assigneeTabs=page.getByRole('group',{name:'자재요청 담당자',exact:true})
  const workerTab=assigneeTabs.getByRole('button',{name:/김영인/})
  await workerTab.getByTitle('진행 중 / 완료 대기').filter({hasText:/0\s*\/\s*1/}).waitFor()
  const savedOrder = () => db.query('select profile_id from public.china_work_assignees order by sort_order,created_at,profile_id')
    .then(({rows}) => rows.map(row => row.profile_id))
  const oldOrder = await savedOrder()
  const orderSaved = page.waitForResponse(response => response.url().endsWith('/save_china_work_assignee_order'))
  await workerTab.press('Alt+ArrowRight')
  assert.ok((await orderSaved).ok())
  const swappedOrder = [oldOrder[1],oldOrder[0],...oldOrder.slice(2)]
  assert.deepEqual(await savedOrder(),swappedOrder)
  await page.getByRole('button',{name:'담당자 삭제 관리',exact:true}).click()
  const removal=page.getByRole('dialog',{name:'담당자 삭제 관리',exact:true})
  const removeWorker=removal.getByRole('button',{name:'김영인 삭제',exact:true})
  assert.equal(await removeWorker.isDisabled(),true)
  await removal.getByText('완료 대기 1건',{exact:true}).waitFor()
  await removal.getByRole('button',{name:'닫기',exact:true}).last().click()
  await open('planning')
  await page.getByRole('button',{name:'수령 확인'}).click()
  await page.getByRole('combobox',{name:'1차 만족도'}).selectOption('8')
  await page.getByRole('button',{name:'2차 요청 작성'}).click()
  await page.getByRole('textbox',{name:'요청 제목'}).fill('라벨 샘플 추가')
  await page.locator('[contenteditable=true]').first().fill('두 번째 요청 내용')
  await page.getByRole('button',{name:'작성 완료'}).click()
  await page.getByRole('button',{name:'2차 요청 전송'}).click()
  await page.getByText(/2차 요청 전송/).waitFor()
  await open('recipient')
  await page.getByRole('button',{name:'전체 기록',exact:true}).click()
  const recipientDownloads = () => downloads.filter(item=>item.actor===ids.worker).length
  const beforeLatest = recipientDownloads()
  await inboxNotice.click()
  await nudgeDetail.getByText('두 번째 요청 내용',{exact:true}).waitFor()
  assert.equal(await nudgeDetail.getByRole('button',{name:'2차 작성'}).getAttribute('aria-pressed'),'true')
  assert.equal(recipientDownloads(),beforeLatest,'Older attachments are not requested on open')
  await nudgeDetail.getByRole('button',{name:'1차 작성'}).click()
  await nudgeDetail.getByText('요청 내용 확인',{exact:true}).waitFor()
  assert.equal(recipientDownloads(),beforeLatest+1,'Older attachment is retrieved on demand')
  assert.equal(await nudgeDetail.getByText(/만족도|8\/10/).count(),0)
  await nudgeDetail.getByRole('button',{name:'자재요청 상세 닫기'}).click()
  await open('planning')
  await page.getByRole('button',{name:'조르기 설정',exact:true}).click()
  await settings.getByRole('checkbox',{name:'수신 직원 알림 받기'}).check()
  await settings.getByRole('button',{name:'저장',exact:true}).click()
  await settings.waitFor({state:'hidden'})
  await nudge.click()
  await nudgeDialog.getByRole('button',{name:'확인',exact:true}).click()
  await page.getByText('3명에게 조르기 알림을 보냈습니다.').waitFor()
  await open('scoreRecipient')
  await inboxNotice.click()
  await nudgeDetail.getByText('두 번째 요청 내용',{exact:true}).waitFor()
  assert.equal(await nudgeDetail.getByRole('button',{name:'2차 작성',exact:true}).getAttribute('aria-pressed'),'true')
  await nudgeDetail.getByRole('button',{name:/1차 작성/}).getByText('만족도 8/10',{exact:true}).waitFor()
  assert.equal(await nudgeDetail.getByRole('button',{name:/^(수정|확인|확인 완료|저장|작성 완료)$/}).count(),0)
  await nudgeDetail.getByRole('button',{name:'자재요청 상세 닫기'}).click()
  const receivedRated = received.getByRole('button',{name:'라벨 샘플 추가',exact:true})
  await receivedRated.click()
  await nudgeDetail.getByText('두 번째 요청 내용',{exact:true}).waitFor()
  await nudgeDetail.getByRole('button',{name:/1차 작성/}).getByText('만족도 8/10',{exact:true}).waitFor()
  const confirmReceived = nudgeDetail.getByRole('button',{name:'확인 완료',exact:true})
  failConfirmation = true
  await confirmReceived.click()
  await nudgeDetail.getByText('확인 완료를 저장하지 못했습니다. 다시 시도해 주세요.').waitFor()
  assert.equal((await db.query('select count(*)::int count from app.material_nudge_notices where confirmed_at is not null')).rows[0].count,0)
  await confirmReceived.click()
  await nudgeDetail.waitFor({state:'hidden'})
  await received.getByText('확인할 조르기가 없습니다.').waitFor()
  await page.reload()
  await received.getByText('확인할 조르기가 없습니다.').waitFor()
  await page.getByRole('button',{name:'전체 기록',exact:true}).click()
  await inboxNotice.click()
  await nudgeDetail.getByRole('button',{name:/1차 작성/}).getByText('만족도 8/10',{exact:true}).waitFor()
  assert.equal(await confirmReceived.count(),0)
  await nudgeDetail.getByRole('button',{name:'자재요청 상세 닫기'}).click()
  await db.transaction(async tx => {
    const { rows:[request] } = await tx.query('select id,revision from app.material_requests where owner_id=$1 and deleted_at is null', [ids.requester])
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [ids.requester])
    await tx.exec('set local role authenticated')
    const recipients = [ids.manager,ids.worker,ids.viewer,ids.colleague]
    await tx.query('select public.save_material_nudge_recipients($1::uuid[])', [recipients])
    await tx.query('select public.send_material_nudge($1,$2,$3::uuid[],gen_random_uuid())', [request.id,request.revision,recipients])
  })
  await page.getByRole('button',{name:'알림 열기',exact:true}).click()
  await receivedRated.waitFor()
  await open('dualRecipient')
  await departmentMenu.getByRole('link',{name:'자재요청',exact:true}).click()
  await page.getByRole('button',{name:'받은 조르기',exact:true}).click()
  await receivedRated.click()
  await nudgeDetail.getByText('두 번째 요청 내용',{exact:true}).waitFor()
  await page.reload()
  await nudgeDetail.getByText('두 번째 요청 내용',{exact:true}).waitFor()
  await confirmReceived.click()
  await received.getByText('확인할 조르기가 없습니다.').waitFor()
  await page.reload()
  await received.getByText('확인할 조르기가 없습니다.').waitFor()
  await page.getByRole('button',{name:'일반 자재요청',exact:true}).click()
  await page.getByRole('button',{name:'자재 요청',exact:true}).waitFor()
  await open('recipient')
  await departmentMenu.getByRole('link',{name:'자재요청',exact:true}).click()
  await receivedRated.click()
  await nudgeDetail.getByText('두 번째 요청 내용',{exact:true}).waitFor()
  assert.equal(await nudgeDetail.getByText(/만족도|8\/10/).count(),0)
  await confirmReceived.waitFor()
  await nudgeDetail.getByRole('button',{name:'자재요청 상세 닫기'}).click()
  await open('manager')
  const managerGroup=page.getByRole('table',{name:'중국팀 자재요청 목록'}).locator('tbody')
  await managerGroup.getByText('2차 요청',{exact:true}).waitFor()
  assert.equal(await managerGroup.count(),1)
  assert.deepEqual(await managerGroup.getByText(/^[12]차 요청$/).allTextContents(),['1차 요청','2차 요청'])
  assert.deepEqual((await page.getByRole('columnheader').allTextContents()).slice(2,4),['요청 내용','요청 차수'])
  const mergedTitle=managerGroup.locator('th[scope="rowgroup"][rowspan="2"]')
  assert.equal(await mergedTitle.textContent(),'라벨 샘플 추가')
  assert.equal(await mergedTitle.getByRole('button',{name:'라벨 샘플 추가 열기'}).count(),1)
  const continuation=page.getByRole('combobox',{name:'라벨 샘플 추가 담당자 배정'})
  assert.equal(await managerGroup.locator('td[rowspan="2"]').filter({has:continuation}).count(),1)
  assert.equal(await managerGroup.locator('td[rowspan="2"]').filter({has:page.getByRole('button',{name:'업무 배정',exact:true})}).count(),1)
  const previousRow=managerGroup.getByRole('row').filter({hasText:'1차 요청'})
  const currentRow=managerGroup.getByRole('row').filter({hasText:'2차 요청'})
  assert.match(await previousRow.getByTitle('요청부터 한국 발송까지 걸린 기간').textContent(),/^\d+\s*(일|days)$/)
  assert.match(await currentRow.getByTitle('요청부터 오늘까지 지난 기간').textContent(),/^\+\s*\d+\s*(일|days)$/)
  assert.equal(await previousRow.getByText('읽음',{exact:true}).count(),1)
  assert.equal(await currentRow.getByText('읽음',{exact:true}).count(),0)
  assert.equal(await continuation.inputValue(),ids.worker)
  assert.equal(await continuation.isDisabled(),true)
  await page.getByRole('button',{name:'Toggle previous employment'}).click()
  assert.equal(await continuation.inputValue(),'')
  assert.equal(await continuation.isEnabled(),true)
  assert.equal(await continuation.locator('option').filter({hasText:'담당 직원'}).count(),0)
  await page.getByRole('button',{name:'Toggle previous employment'}).click()
  assert.equal(await continuation.inputValue(),ids.worker)
  await open('worker')
  await page.getByText('1차 요청',{exact:true}).waitFor()
  assert.equal(await page.getByText('2차 요청',{exact:true}).count(),0)
  await open('manager')
  await page.getByRole('button',{name:'라벨 샘플 추가 열기'}).click()
  const review=page.getByRole('dialog')
  await review.getByRole('button',{name:'1차 작성',exact:true}).waitFor()
  assert.equal(await review.getByText(/만족도|8\/10/).count(),0)
  await page.getByRole('dialog').getByRole('button',{name:'확인',exact:true}).click()
  await currentRow.getByText('읽음',{exact:true}).waitFor()
  assert.equal(await continuation.inputValue(),ids.worker)
  await page.getByRole('button',{name:'업무 배정',exact:true}).click()
  await page.getByText('새로운 자재요청이 없습니다.').waitFor()
  await page.getByRole('button',{name:'Assigned to worker'}).click()
  await managerGroup.getByText('2차 요청',{exact:true}).waitFor()
  assert.deepEqual(await managerGroup.getByText(/^[12]차 요청$/).allTextContents(),['1차 요청','2차 요청'])
  await open('worker')
  await expectWorkload(1,0)
  const group=page.getByRole('table',{name:'중국팀 자재요청 목록'}).locator('tbody')
  await group.getByText('2차 요청',{exact:true}).waitFor()
  assert.equal(await group.count(),1)
  assert.deepEqual(await group.getByText(/^[12]차 요청$/).allTextContents(),['1차 요청','2차 요청'])
  await page.getByRole('button',{name:'라벨 샘플 추가 열기'}).click()
  await review.getByRole('button',{name:'1차 작성',exact:true}).waitFor()
  assert.equal(await review.getByText(/만족도|8\/10/).count(),0)
  await page.getByRole('dialog').getByRole('button',{name:'확인',exact:true}).click()
  await page.getByRole('button',{name:'발송 처리',exact:true}).click()
  await expectWorkload(0,1)
  await open('planning')
  await page.getByRole('button',{name:'수령 확인'}).click()
  await page.getByRole('combobox',{name:'2차 만족도'}).selectOption('10')
  await page.getByText('만족도 10/10',{exact:true}).waitFor()
  await open('worker')
  await expectWorkload(0,0)
  await page.getByText('배정된 자재요청이 없습니다.').waitFor()
  await open('managerBoard')
  await workerTab.getByTitle('진행 중 / 완료 대기').filter({hasText:/0\s*\/\s*0/}).waitFor()
  await workerTab.click()
  await page.getByText('배정된 자재요청이 없습니다.').waitFor()
  await assigneeTabs.getByRole('button',{name:/완료 이력/}).click()
  const history=page.getByRole('table',{name:'중국팀 자재요청 목록'})
  await history.getByText('라벨 샘플 추가',{exact:true}).waitFor()
  await history.getByText('완료',{exact:true}).waitFor()
  await page.getByRole('button',{name:'담당자 삭제 관리',exact:true}).click()
  await removeWorker.click()
  await removeWorker.waitFor({state:'hidden'})
  await removal.getByRole('button',{name:'닫기',exact:true}).last().click()
  await history.getByText('라벨 샘플 추가',{exact:true}).waitFor()
  assert.deepEqual(await history.getByText(/^[12]차 요청$/).allTextContents(),['1차 요청','2차 요청'])
  assert.deepEqual(errors,[])
  console.log('Material request browser + SQL: manager grouping and assignee carry-forward, employee change, worker confirmation, shipment and completion passed')
  console.log('Material nudge browser + SQL: recipient menu, direct latest detail, on-demand attachments, read-on-view and unassigned route denial passed')
  console.log('Material safeguards browser + SQL: conflict reload, waiting deletion block, completion, roster deletion and history passed')
  console.log('Material nudge scores: historical score shown under the round tab for the recipient, and hidden for China roles')
} finally {
  await browser.close()
  await db.close()
}
