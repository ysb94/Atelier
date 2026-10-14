import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

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
export async function runScenario(name,fixture) {
  const scenarios={images:imageScenario,deadline:deadlineScenario,attendance:attendanceScenario}
  if(!scenarios[name])throw new Error(`Unknown browser scenario: ${name}`)
  const startedAt=new Date().toISOString(),results=await scenarios[name](fixture)
  assert.deepEqual(fixture.errors,[],'Browser runtime errors')
  const dir=path.resolve('dev-tools/ai-workflow/.state/browser');fs.mkdirSync(dir,{recursive:true})
  const screenshot=path.join(dir,`${name}.png`)
  await fixture.page.screenshot({path:screenshot,fullPage:true})
  const report={scenario:name,startedAt,finishedAt:new Date().toISOString(),passed:true,
    method:'Real app components in Chromium; synthetic profile and offline data; no actual login, production DB access or deployment.',
    results,screenshot,screenshotSha256:createHash('sha256').update(fs.readFileSync(screenshot)).digest('hex')}
  fs.writeFileSync(path.join(dir,`${name}.json`),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
}
