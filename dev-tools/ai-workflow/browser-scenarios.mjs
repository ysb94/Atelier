import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {documentsScenario,profileScenario,attendancePolicyScenario} from './browser-operations-scenarios.mjs'
import {dataMenuScenario,brandInfoScenario,seasonsRemovalScenario} from './browser-navigation-scenarios.mjs'

async function openForm(page,origin,owner='design') {
  await page.goto(`${origin}/work-requests/${owner}?mode=new`)
  await page.locator('#work-request-title').waitFor()
}
async function fillForm(page,title) {
  await page.locator('#work-request-title').fill(title)
  await page.locator('form input[type=date]').fill('2026-12-15')
  await page.locator('[contenteditable=true]').first().fill('브라우저에서 실제 입력한 검증 본문')
}
async function dimensions(image) {
  await image.waitFor()
  await image.evaluate(async img=>{if(!img.complete)await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject})})
  return image.evaluate(img=>({width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}))
}
async function imageScenario({page,origin}) {
  await openForm(page,origin)
  await fillForm(page,'이미지 업로드 검증')
  const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='#3765aa';x.fillRect(0,0,800,600);return c.toDataURL('image/png').split(',')[1]})
  const names=['body-drop.png','body-paste.png','reference-drop.png','file-select.png']
  for(let index=0;index<3;index++) {
    const target=index===2?page.locator('input[type=file]').locator('..'):page.locator('[contenteditable=true]').first()
    await target.evaluate((element,{encoded,name,index})=>{
      const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),data=new DataTransfer()
      data.items.add(new File([bytes],name,{type:'image/png'}))
      const rect=element.getBoundingClientRect(),event=index===1?new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}):new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:rect.x+30,clientY:rect.y+10})
      element.dispatchEvent(event)
    },{encoded,name:names[index],index})
    await page.getByRole('img',{name:names[index],exact:true}).waitFor()
  }
  await page.locator('input[type=file]').setInputFiles({name:names[3],mimeType:'image/png',buffer:Buffer.from(encoded,'base64')})
  const initial=[]
  for(const name of names)initial.push({name,...await dimensions(page.getByRole('img',{name,exact:true}))})
  assert.ok(initial.every(item=>Math.abs(item.width-initial[0].width)<=2),`Upload widths differ: ${JSON.stringify(initial)}`)
  assert.ok(initial.every(item=>Math.abs(item.height-initial[0].height)<=2),`Upload heights differ: ${JSON.stringify(initial)}`)
  const resized=[]
  for(const name of [names[0],names[3]]) {
    const image=page.getByRole('img',{name,exact:true}),box=image.locator('..')
    await image.scrollIntoViewIfNeeded()
    const handle=box.getByRole('button',{name:'너비만 조절',exact:true}).first()
    const rect=await handle.boundingBox()
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2)
    await page.mouse.down();await page.mouse.move(rect.x+rect.width/2-90,rect.y+rect.height/2,{steps:10});await page.mouse.up()
    const size=await dimensions(image)
    assert.ok(size.width<initial[0].width-30,`Resize failed: ${name}`)
    resized.push({name,...size})
  }
  await page.locator('input[type=file]').locator('..').evaluate(element=>{
    const file=new File(['fixture'],'regression.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',lastModified:1})
    const data=new DataTransfer();data.items.add(file)
    element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}))
  })
  await page.getByText('regression.xlsx',{exact:true}).waitFor()
  await page.locator('input[type=file]').locator('..').evaluate(element=>{
    const data=new DataTransfer();data.items.add(new File(['fixture'],'regression.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',lastModified:1}))
    element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}))
  })
  assert.equal(await page.getByText('regression.xlsx',{exact:true}).count(),1,'Duplicate file was added')
  await page.getByRole('button',{name:'regression.xlsx 제거',exact:true}).click()
  assert.equal(await page.getByText('regression.xlsx',{exact:true}).count(),0)
  await page.getByRole('button',{name:'작업 요청 등록',exact:true}).click()
  await page.locator('aside').waitFor()
  const saved=[]
  for(const item of resized) {
    const size=await dimensions(page.locator('aside').getByRole('img',{name:item.name,exact:true}))
    assert.ok(Math.abs(size.width-item.width)<=2,`Saved width changed: ${JSON.stringify({item,size})}`)
    saved.push({name:item.name,...size})
  }
  const detailAvailableWidth=await page.locator('aside').getByRole('img',{name:names[0],exact:true}).evaluate(img=>img.closest('[data-flow-frame]').getBoundingClientRect().width)
  assert.equal(await page.locator('aside').getByRole('button',{name:/너비만 조절|높이만 조절|비율 유지/}).count(),0,'Detail has resize controls')
  await page.locator('aside').getByRole('button',{name:'수정',exact:true}).click()
  const reopenedEdit=[]
  for(const item of resized){const size=await dimensions(page.getByRole('img',{name:item.name,exact:true}));assert.ok(Math.abs(size.width-item.width)<=2,'Edit width changed');reopenedEdit.push({name:item.name,...size})}
  await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click()
  await page.locator('aside').waitFor()
  await page.locator('aside').getByRole('button',{name:'수정',exact:true}).click()
  const image=page.getByRole('img',{name:names[0],exact:true}),box=image.locator('..')
  await image.hover()
  await box.getByRole('button',{name:'글이 이미지 옆을 감싸게',exact:true}).click()
  const wrapped=await image.evaluate(img=>{const floats=[];for(let node=img.parentElement;node&&!node.hasAttribute('data-flow-frame');node=node.parentElement)floats.push(getComputedStyle(node).float);return {floats}})
  assert.ok(wrapped.floats.some(value=>value==='left'||value==='right'),'Text wrapping was not enabled')
  await box.getByRole('button',{name:'이미지를 위아래로만 배치',exact:true}).click()
  const beforeMove=await image.boundingBox()
  await page.mouse.move(beforeMove.x+beforeMove.width/2,beforeMove.y+beforeMove.height/2);await page.mouse.down()
  await page.mouse.move(beforeMove.x+beforeMove.width/2+60,beforeMove.y+beforeMove.height/2+80,{steps:12});await page.mouse.up()
  const afterMove=await image.boundingBox()
  assert.ok(Math.abs(afterMove.x-beforeMove.x)>10||Math.abs(afterMove.y-beforeMove.y)>10,'Image did not move')
  const handle=box.getByRole('button',{name:'너비만 조절',exact:true}).first();await handle.scrollIntoViewIfNeeded()
  const h=await handle.boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down()
  await page.mouse.move(1439,h.y+h.height/2,{steps:15});await page.mouse.up()
  const expansion=await image.evaluate(img=>({width:img.getBoundingClientRect().width,available:img.closest('[data-flow-frame]').getBoundingClientRect().width}))
  assert.ok(expansion.width<=expansion.available+2,'Expanded image overflows its frame')
  const remove=box.getByRole('button',{name:/제거|삭제/});await remove.click()
  assert.equal(await page.getByRole('img',{name:names[0],exact:true}).count(),0,'Image deletion failed')
  const warnings=[];const listener=message=>{if(message.type()==='warning')warnings.push(message.text())};page.on('console',listener)
  await page.locator('input[type=file]').setInputFiles({name:'broken-image.png',mimeType:'image/png',buffer:Buffer.from('invalid image bytes')})
  await page.getByText('broken-image.png',{exact:true}).waitFor()
  assert.equal(await page.getByRole('img',{name:'broken-image.png',exact:true}).count(),0)
  assert.ok(warnings.some(w=>w.includes('broken-image.png')&&w.includes('image/png')),'Missing image decode warning')
  page.off('console',listener)
  assert.match(await page.locator('body').innerText(),/새로고침하면 초기화/)
  return {initial,resized,saved,reopenedEdit,detailAvailableWidth,wrapped,movement:{before:beforeMove,after:afterMove},expansion,corruptImage:{fallback:true,warnings},
    originalFilePickerReport:'Valid PNG previews worked in this synthetic fixture; the original user file and deployed version were not supplied, so their failure cause is not established.',
    checked:['four upload paths','body and reference resize','register and reopen edit','edit save','ordinary attachment add/duplicate prevention/delete','image wrap/stack/move/delete','expansion constrained to frame','unreadable image fallback and warning']}
}
async function deadlineScenario({page,origin}) {
  const owners=['planning','design','md','logistics'],checked=[]
  for(const owner of owners) {
    await openForm(page,origin,owner)
    assert.equal(await page.locator('form input[type=date]').count(),1)
    assert.doesNotMatch(await page.locator('form').innerText(),/변경 불가 일정|변경할 수 없는 일정의 사유|희망 일정/)
    await page.locator('#work-request-title').fill(`날짜 검증 ${owner}`)
    await page.locator('[contenteditable=true]').first().fill('실제 입력한 본문')
    await page.getByRole('button',{name:'작업 요청 등록',exact:true}).click()
    await page.getByText('희망 마감일을 선택하세요.',{exact:true}).waitFor()
    await page.locator('form input[type=date]').fill('2026-12-15')
    await page.getByRole('button',{name:'작업 요청 등록',exact:true}).click()
    await page.locator('aside').waitFor()
    assert.doesNotMatch(await page.locator('aside').innerText(),/변경 불가|일정 사유/)
    await page.locator('aside').getByRole('button',{name:'수정',exact:true}).click()
    await page.locator('form input[type=date]').fill('2026-12-20')
    await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click()
    await page.locator('aside').waitFor()
    assert.match(await page.locator('aside').innerText(),/12[./\-\s]20|12월 20/)
    checked.push({owner,dateFields:1,missingDateRejected:true,registered:true,editedDate:'2026-12-20'})
  }
  return {checked}
}
async function attendanceScenario({page,origin}) {
  const excluded=['이사','상무','전무','부사장','대표이사'],checked=[]
  for(const position of ['사원','팀장',...excluded]) {
    for(const route of ['/home','/my-attendance']) {
      console.log(JSON.stringify({checking:'attendance fixture',position,route}))
      await page.goto(`${origin}${route}?position=${encodeURIComponent(position)}`)
      await page.getByText(route==='/home'?'오늘의 근무':'월별 근태',{exact:true}).waitFor()
      if(excluded.includes(position)) {
        await page.getByText(/출퇴근.*제외|근태.*제외/).first().waitFor()
        assert.equal(await page.getByRole('button',{name:/출근하기|퇴근하기|퇴근 무르기/}).count(),0)
      } else await page.getByRole('button',{name:/출근하기/}).waitFor()
      checked.push({position,route,buttonsExcluded:excluded.includes(position)})
    }
  }
  for(const route of ['/attendance','/my-start']) {
    await page.goto(origin+route)
    await page.getByText('검증 사원',{exact:true}).first().waitFor()
    for(const position of excluded)assert.equal(await page.getByText(`검증 ${position}`,{exact:true}).count(),0,`Excluded member visible: ${route} ${position}`)
    await page.getByText('검증 팀장',{exact:true}).first().waitFor()
    checked.push({route,retained:['사원','팀장'],excluded})
    if(route==='/attendance') {
      await page.getByRole('button',{name:'출근시간 확인',exact:true}).first().click()
      await page.getByText('검증 사원',{exact:true}).last().waitFor()
      for(const position of excluded)assert.equal(await page.getByText(`검증 ${position}`,{exact:true}).count(),0)
      checked.push({route:'attendance start settings',excluded})
    }
  }
  return {checked}
}
async function navigationScenario({page,origin}) {
  const query='?fixture=navigation&position='+encodeURIComponent('대표이사')+'&brand=fixture&probe=keep'
  await page.goto(origin+'/products'+query)
  await page.getByText('검증 직원',{exact:false}).first().waitFor()
  for(const title of ['기획','디자인']) {
    const button=page.locator('nav').getByRole('button',{name:title,exact:true})
    await button.click()
  }
  const links=await page.locator('nav a').evaluateAll(items=>items.map(item=>({text:item.textContent,href:item.getAttribute('href')})))
  assert.ok(links.some(item=>item.href?.includes('/work-requests/planning')),'Planning work requests missing')
  assert.ok(links.some(item=>item.href?.includes('/work-requests/design')),'Design work requests missing')
  assert.ok(!links.some(item=>/^\/(?:product-work\/(?:planning|design)|planning|design)$/.test(item.href??'')),'Removed product menu remains')
  const routes=['/product-work/planning','/product-work/design','/product-work/planning/fixture-item','/product-work/design/fixture-item','/planning','/design','/b/fixture/work/planning','/b/fixture/work/design','/b/fixture/planning','/b/fixture/design']
  const redirects=[]
  for(const route of routes){
    await page.goto(origin+route+query)
    await page.waitForURL(url=>url.pathname==='/products')
    assert.equal(new URL(page.url()).searchParams.get('probe'),'keep','Search parameters lost')
    redirects.push({from:route,to:new URL(page.url()).pathname,searchPreserved:true})
  }
  await page.goto(origin+'/products'+query)
  await page.getByRole('button',{name:'전체 상품',exact:true}).waitFor()
  const retained=['/product-work/md','/product-work/logistics','/products/fixture-item','/drafts','/work-requests/planning','/work-requests/design','/design/styled-cuts','/design/file-manager'],entered=[]
  for(const route of retained){await page.evaluate(to=>window.__fixtureNavigate(to),route+query);await page.waitForURL(url=>url.pathname===route);await page.locator('main').first().waitFor();entered.push(route)}
  await page.evaluate(to=>window.__fixtureNavigate(to),'/products'+query);await page.waitForURL(url=>url.pathname==='/products')
  await page.evaluate(to=>window.__fixtureNavigate(to),'/work-requests/planning'+query);await page.waitForURL(url=>url.pathname==='/work-requests/planning');await page.goBack();await page.waitForURL(url=>url.pathname==='/products')
  const workRequestTabIdentity=await page.evaluate(()=>{
    const owners=['planning','design','md','logistics'],searches=['','?mode=new','?requestId=R1','?requestId=R1&mode=edit','?brand=fixture&requestId=R2'],cases=[]
    for(const owner of owners)for(const search of searches){const pathname='/work-requests/'+owner;cases.push({pathname,search,result:window.__fixtureResolveTab({pathname,search})})}
    return cases
  })
  const ownerIds=new Set()
  for(const owner of ['planning','design','md','logistics']){const cases=workRequestTabIdentity.filter(v=>v.pathname==='/work-requests/'+owner),ids=new Set(cases.map(v=>v.result?.id));assert.equal(ids.size,1,'Work request view created another tab');assert.ok(!ids.has(undefined));ownerIds.add(cases[0].result.id);for(const item of cases){assert.equal(item.result.pathname,item.pathname);assert.equal(item.result.search,item.search)}}
  assert.equal(ownerIds.size,4,'Department tab identifiers collided')
  const productTabsBefore=await page.getByRole('button',{name:'전체 상품',exact:true}).count()
  const existingProductTab=await page.locator('div.border-border.bg-background > button[title="전체 상품"]').first().elementHandle()
  for(const route of ['/product-work/planning','/product-work/design']){await page.evaluate(to=>window.__fixtureNavigate(to),route+query);await page.waitForURL(url=>url.pathname==='/products');assert.equal(await page.getByRole('button',{name:'전체 상품',exact:true}).count(),productTabsBefore,'Removed route created another product tab');assert.equal(new URL(page.url()).searchParams.get('probe'),'keep')}
  assert.equal(await existingProductTab.evaluate(el=>el.isConnected),true,'Existing product tab was replaced')
  await page.waitForTimeout(250)
  assert.equal(new URL(page.url()).pathname,'/products','Hidden tab changed the active address')
  await page.goto(origin+'/__brand-home'+query)
  await page.getByText('검증 브랜드',{exact:true}).first().waitFor()
  const shortcuts=await page.locator('a').evaluateAll(items=>items.map(item=>({text:item.textContent,href:item.getAttribute('href')})))
  assert.ok(!shortcuts.some(item=>/\/(?:work\/(?:planning|design)|product-work\/(?:planning|design))$/.test(item.href??'')),'Removed brand shortcut remains')
  return {links,redirects,shortcuts,workRequestTabIdentity,retainedRoutesEntered:entered,backNavigation:true,productTabReused:true,hiddenTabsDidNotChangeAddress:true,checked:['Actual company navigation','Actual company and legacy brand route redirects','Query preservation','Actual brand home shortcuts']}
}
async function brandAccessScenario({page,origin}) {
  const checked=[]
  for(const [position,email,allowed,admin,status] of [['대표이사','fixture@example.invalid',true,false,'active'],['사원','dev@atelier.local',true,false,'active'],['팀장','fixture@example.invalid',false,true,'active'],['사원','fixture@example.invalid',false,false,'active'],['대표이사','fixture@example.invalid',false,false,'pending']]){
    const query='?'+new URLSearchParams({fixture:'brand-access',position,email,admin:String(admin),status})
    await page.goto(origin+'/__brand-management'+query)
    if(allowed)await page.getByText('검증 브랜드',{exact:true}).first().waitFor()
    else{await page.getByText('브랜드 관리는 대표이사와 개발자만 볼 수 있습니다.',{exact:true}).waitFor();assert.equal(await page.getByText('검증 브랜드',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/브랜드 추가|브랜드 생성/}).count(),0)}
    const observers=await page.evaluate(()=>window.__brandQueryObservers());assert.equal(observers,allowed?1:0,'Restricted management query hook mounted')
    await page.goto(origin+'/brands'+query)
    const expand=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await expand.isVisible())await expand.click()
    const settings=page.locator('nav').getByRole('button',{name:'설정',exact:true});if(await settings.getAttribute('aria-expanded')!=='true')await settings.click()
    assert.equal(await page.locator('nav a[href="/brands"]').count(),allowed?1:0)
    await page.getByRole('button',{name:'사이드바 접기',exact:true}).click()
    assert.equal(await page.locator('nav a[href="/brands"]').count(),allowed?1:0)
    const reads=await page.evaluate(()=>window.__atelierFixtureReads??[])
    if(!allowed)assert.ok(!reads.includes('brands'),'Restricted brand management fetched brands')
    checked.push({position,email,admin,status,allowed,expandedAndCollapsed:true,queryObservers:observers,reads})
  }
  return {checked,note:'Synthetic profiles; permissions and actual components tested without live authentication.'}
}
async function attachmentScenario({page,origin}) {
  await openForm(page,origin);await fillForm(page,'본문 파일 선택 검증')
  const body=page.locator('form .min-h-72'),encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;return c.toDataURL('image/png').split(',')[1]})
  const png=name=>({name,mimeType:'image/png',buffer:Buffer.from(encoded,'base64')})
  await page.locator('input[type=file]').setInputFiles([png('ordered-a.png'),{name:'ordered-b.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')},{name:'ordered-c.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('fixture')}])
  await body.getByRole('img',{name:'ordered-a.png',exact:true}).waitFor();await body.getByText('ordered-c.xlsx',{exact:true}).waitFor()
  const nodes=await Promise.all([body.getByRole('img',{name:'ordered-a.png',exact:true}).elementHandle(),body.getByText('ordered-b.txt',{exact:true}).elementHandle(),body.getByText('ordered-c.xlsx',{exact:true}).elementHandle()])
  assert.equal(await page.evaluate(([a,b,c])=>!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(b.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING),nodes),true,'File selection order changed')
  const picker=page.locator('input[type=file]').locator('..');assert.equal(await picker.getByText('ordered-b.txt',{exact:true}).count(),0,'Separate picker list remains')
  await body.getByRole('button',{name:'ordered-b.txt 제거',exact:true}).click();assert.equal(await page.getByText('ordered-b.txt',{exact:true}).count(),0)
  await page.getByRole('button',{name:'작업 요청 등록',exact:true}).click();await page.locator('aside').getByText('ordered-c.xlsx',{exact:true}).waitFor()
  await page.locator('aside').getByRole('button',{name:'수정',exact:true}).click()
  await page.locator('input[type=file]').setInputFiles(png('edit-d.png'));await body.getByRole('img',{name:'edit-d.png',exact:true}).waitFor()
  const editImage=body.getByRole('img',{name:'edit-d.png',exact:true});await dimensions(editImage);await editImage.scrollIntoViewIfNeeded()
  const handle=editImage.locator('..').getByRole('button',{name:'너비만 조절',exact:true}).first(),rect=await handle.boundingBox(),before=await dimensions(editImage)
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2-60,rect.y+rect.height/2,{steps:8});await page.mouse.up();const resized=await dimensions(editImage);assert.ok(resized.width<before.width-20)
  for(const type of ['paste','drop']){
    await body.locator('[contenteditable=true]').last().evaluate((el,{encoded,type})=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],type+'.png',{type:'image/png'}));el.dispatchEvent(type==='paste'?new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}):new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:el.getBoundingClientRect().x+10,clientY:el.getBoundingClientRect().y+10}))},{encoded,type});await body.getByRole('img',{name:type+'.png',exact:true}).waitFor()
  }
  await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click();await page.locator('aside').getByRole('img',{name:'edit-d.png',exact:true}).waitFor();await page.locator('aside').getByText('ordered-c.xlsx',{exact:true}).waitFor()
  return {checked:['File picker appends mixed files into body in order','No separate picker attachment list','Individual file removal','Register and reopen edit','Additional files saved in detail','Image resize, paste and drop'],resized}
}
export async function runScenario(name,fixture) {
  const scenarios={images:imageScenario,deadline:deadlineScenario,attendance:attendanceScenario,navigation:navigationScenario,'brand-access':brandAccessScenario,attachments:attachmentScenario,documents:documentsScenario,profile:profileScenario,'attendance-policy':attendancePolicyScenario,'data-menu':dataMenuScenario,'brand-info':brandInfoScenario,'seasons-removal':seasonsRemovalScenario}
  if(!scenarios[name])throw new Error(`Unknown browser scenario: ${name}`)
  const startedAt=new Date().toISOString(),results=await scenarios[name](fixture)
  assert.deepEqual(fixture.errors,[],'Browser runtime errors')
  const dir=path.resolve('dev-tools/ai-workflow/.state/browser');fs.mkdirSync(dir,{recursive:true})
  const screenshot=path.join(dir,`${name}.png`)
  await fixture.page.screenshot({path:screenshot,fullPage:true})
  const report={scenario:name,startedAt,finishedAt:new Date().toISOString(),passed:true,
    method:'Real app components in Chromium; synthetic profile and offline data; no actual login, production DB access or deployment.',
    results,sourceRoot:fixture.root,sourceHashes:fixture.root?{'src/components/layout/workspace-tabs.tsx':createHash('sha256').update(fs.readFileSync(path.join(fixture.root,'src/components/layout/workspace-tabs.tsx'))).digest('hex')}:undefined,screenshot,screenshotSha256:createHash('sha256').update(fs.readFileSync(screenshot)).digest('hex')}
  fs.writeFileSync(path.join(dir,`${name}.json`),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
}
