import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'
const root=process.cwd()
let server,browser
try{
 const bundle=await build({
   root,configFile:false,envFile:false,logLevel:'error',plugins:[react(),tailwindcss()],
   resolve:{alias:{'@':path.join(root,'src')}},
   build:{write:false,cssCodeSplit:false,rollupOptions:{input:path.join(root,'dev-tools/ai-workflow/browser-fixture/draft-sheet-entry.tsx')}},
 })
 const {output}=Array.isArray(bundle)?bundle[0]:bundle
 const entry=output.find(asset=>asset.type==='chunk'&&asset.isEntry)
 const css=output.find(asset=>asset.fileName.endsWith('.css'))
 assert.ok(entry&&css)
 const files=new Map(output.map(asset=>['/'+asset.fileName,asset]))
 server=createServer((req,res)=>{
   const asset=files.get(req.url)
   if(asset){
     res.setHeader('Content-Type',asset.type==='chunk'?'text/javascript':asset.fileName.endsWith('.css')?'text/css':'application/octet-stream')
     res.end(asset.type==='chunk'?asset.code:asset.source)
   }else if(req.url==='/'){
     res.setHeader('Content-Type','text/html; charset=utf-8')
     res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/${css.fileName}"><div id="root"></div><script type="module" src="/${entry.fileName}"></script>`)
   }else{res.statusCode=404;res.end()}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin='http://127.0.0.1:'+server.address().port
 browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1800,height:950}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')||route.request().url().startsWith('data:')?route.continue():route.abort())
 await page.goto(origin,{waitUntil:'commit',timeout:45000});const row=page.locator('.draft-sheet-row');await row.waitFor({timeout:60000})
 const geometry=()=>row.locator(':scope > td').evaluateAll(cells=>cells.map(cell=>({x:Math.round(cell.getBoundingClientRect().x),width:Math.round(cell.getBoundingClientRect().width),height:Math.round(cell.getBoundingClientRect().height)})))
 const ownerGeometry=await geometry()
 const names=await row.locator('input,textarea').evaluateAll(fields=>fields.map(field=>field.value))
 await page.getByRole('button',{name:'다른 직원으로 전환'}).click()
 assert.deepEqual(await geometry(),ownerGeometry,'Same six columns and row size for all viewers')
 assert.deepEqual(await row.locator('input,textarea').evaluateAll(fields=>fields.map(field=>field.value)),names)
 for(const text of ['컬러샘플','블랙','아이보리','생산 일정 협의','11월 출시'])assert.ok((await row.textContent()).includes(text)||names.includes(text),text)
 const nameButton=row.getByRole('button',{name:'PL-TEST 한글명',exact:true})
 assert.equal(await nameButton.textContent(),'회의용 기획안')
 await nameButton.click()
 assert.equal(await page.getByTestId('opened').textContent(),'1')
 for(const label of ['네임확정','컬러 문서','컬러 구성 확정','일정 수정'])assert.equal(await row.getByRole('button',{name:label,exact:true}).isDisabled(),true,label)
 assert.equal(await row.getByRole('button',{name:/합격|불합격/}).count(),0,'샘플 판정 버튼 없음')
 assert.equal(await row.getByRole('button',{name:'수령 확인',exact:true}).isDisabled(),true,'컬러샘플 수령도 작성자만 기록')
 assert.equal(await row.getByRole('button',{name:'컬러명확정',exact:true}).count(),0)
 const fabricTrigger=row.getByRole('button',{name:'Fabric',exact:true}).first()
 await fabricTrigger.click()
 const panel=page.getByRole('dialog',{name:'PL-TEST INFORMATION'})
 const fields=panel.getByRole('group',{name:'INFORMATION 입력 항목'})
 const fabric=panel.getByRole('form',{name:'블랙 Fabric'})
 const triggers=row.locator('td').nth(4).getByRole('button',{name:/^(size|Fabric|Weight|스펙 문서)$/})
 assert.equal(await panel.evaluate(el=>el.parentElement===document.body&&getComputedStyle(el).position==='fixed'),true)
 assert.deepEqual(await geometry(),ownerGeometry,'입력창을 열어도 기획안 표의 행 크기와 위치를 유지한다')
 const panelBox=await panel.boundingBox()
 for(const trigger of await triggers.all()) {
   const triggerBox=await trigger.boundingBox()
   assert.ok(triggerBox.x+triggerBox.width<=panelBox.x||triggerBox.x>=panelBox.x+panelBox.width||
     triggerBox.y+triggerBox.height<=panelBox.y||triggerBox.y>=panelBox.y+panelBox.height,'입력창이 기존 INFORMATION 버튼을 가리지 않는다')
 }
 assert.equal(await fabric.getByLabel('Fabric 값').inputValue(),'나일론')
 assert.equal(await fabric.getByLabel('Fabric 값').getAttribute('readonly'),'')
 assert.equal(await fabric.getByRole('button',{name:'저장',exact:true}).isDisabled(),true)
 await fabric.evaluate(form=>form.requestSubmit());assert.equal(await page.getByTestId('writes').textContent(),'0')
 await row.getByRole('button',{name:'스펙 문서',exact:true}).first().click()
 assert.equal(await panel.getByRole('form',{name:'블랙 스펙 문서'}).getByLabel('스펙 문서 값').inputValue(),'공유 스펙 본문')
 await fields.getByRole('button',{name:'Weight',exact:true}).click()
 assert.equal(await panel.getByRole('form',{name:'아이보리 Weight'}).getByLabel('Weight 값').inputValue(),'240g')
 await fields.getByRole('button',{name:'size',exact:true}).click()
 assert.equal(await panel.getByRole('form',{name:'블랙 size'}).getByLabel(/가로 \(W\)/).inputValue(),'300')
 await panel.press('Escape')
 assert.equal(await panel.count(),0)
 assert.equal(await row.getByRole('button',{name:'스펙 문서',exact:true}).first().evaluate(el=>el===document.activeElement),true)
 await row.locator('button.draft-sheet-photo').click()
 await row.getByRole('button',{name:'PL-TEST 기획안 조회'}).click();assert.equal(await page.getByTestId('opened').textContent(),'3')
 await page.screenshot({path:'.tmp/draft-sheet-readonly-desktop.png',fullPage:true})
 for(const [phase,label]of [['new','샘플 작업지시서'],['color-upload','다음샘플']]){
   await page.getByLabel('검증 단계').selectOption(phase)
   await row.getByRole('button',{name:label,exact:true}).click()
   assert.equal(await page.getByTestId('writes').textContent(),'0')
 }
 assert.equal(await page.getByTestId('opened').textContent(),'5')
 await page.getByRole('button',{name:'작성자로 전환'}).click()
 await row.getByRole('button',{name:'PL-TEST 기획안 편집',exact:true}).click()
 assert.equal(await page.getByTestId('opened').textContent(),'6')
 await row.getByRole('button',{name:'일정 수정',exact:true}).click()
 await page.getByTestId('writes').getByText('1',{exact:true}).waitFor()
 await row.getByRole('button',{name:'size',exact:true}).first().click()
 const size=panel.getByRole('form',{name:'블랙 size'})
 await size.getByLabel(/가로 \(W\)/).fill('320')
 await page.screenshot({path:'.tmp/draft-information-overlay.png'})
 await size.getByRole('button',{name:'다른 컬러에 적용',exact:true}).click()
 assert.deepEqual(JSON.parse(await page.getByTestId('saved-spec').textContent()),['black','size','W=320;D=120;H=210;STRAP=;UNIT=mm',true])
 await fields.getByRole('button',{name:'Fabric',exact:true}).click()
 await fabric.getByLabel('Fabric 값').fill('저장 전 임시 입력')
 await page.getByRole('button',{name:'다른 직원으로 전환'}).evaluate(button=>button.click())
 assert.equal(await fabric.getByRole('button',{name:'저장',exact:true}).isDisabled(),true)
 assert.equal(await fabric.getByLabel('Fabric 값').inputValue(),'나일론','Permission change restores saved spec value')
 await fabric.evaluate(form=>form.requestSubmit());assert.equal(await page.getByTestId('writes').textContent(),'2')
 await panel.press('Escape')
 await page.setViewportSize({width:800,height:950})
 const weightTrigger=row.getByRole('button',{name:'Weight',exact:true}).first()
 await weightTrigger.click()
 const narrowPanel=await panel.boundingBox()
 const narrowTrigger=await weightTrigger.boundingBox()
 assert.ok(narrowPanel.x>=0&&narrowPanel.x+narrowPanel.width<=800&&narrowPanel.y>=0&&narrowPanel.y+narrowPanel.height<=950,
   `가로 스크롤 뒤에도 입력창이 화면 안에 표시된다 ${JSON.stringify(narrowPanel)}`)
 assert.ok(narrowTrigger.y+narrowTrigger.height<=narrowPanel.y||narrowTrigger.y>=narrowPanel.y+narrowPanel.height,
   '좁은 화면에서도 선택한 기존 버튼을 가리지 않는다')
 await panel.getByRole('button',{name:'INFORMATION 닫기'}).click()
 assert.equal(await panel.count(),0)
 assert.deepEqual(errors,[])
 console.log('draft-sheet-readonly: same layout/content, detail links, spec/confirm/schedule permissions and live permission transition; owner actions preserved')
}finally{await browser?.close();await server?.close()}
