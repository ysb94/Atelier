import assert from 'node:assert/strict'
import path from 'node:path'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'
const root=process.cwd(),origin='http://127.0.0.1:5197'
let server,browser
try{
 server=await createServer({configFile:false,envDir:false,cacheDir:path.join(root,'node_modules/.cache/draft-sheet-verify'),logLevel:'error',plugins:[{name:'draft-sheet-fixture',configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.headers.accept?.includes('text/html'))return next();void vite.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/draft-sheet-entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react(),tailwindcss()],resolve:{alias:{'@':path.join(root,'src')}},server:{host:'127.0.0.1',port:5197,strictPort:true,hmr:false}})
 await server.listen();browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1800,height:950}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
 await page.goto(origin);const row=page.locator('.draft-sheet-row');await row.waitFor()
 const geometry=()=>row.locator(':scope > td').evaluateAll(cells=>cells.map(cell=>({x:Math.round(cell.getBoundingClientRect().x),width:Math.round(cell.getBoundingClientRect().width),height:Math.round(cell.getBoundingClientRect().height)})))
 const ownerGeometry=await geometry()
 const names=await row.locator('input,textarea').evaluateAll(fields=>fields.map(field=>field.value))
 await page.getByRole('button',{name:'다른 직원으로 전환'}).click()
 assert.deepEqual(await geometry(),ownerGeometry,'Same six columns and row size for all viewers')
 assert.deepEqual(await row.locator('input,textarea').evaluateAll(fields=>fields.map(field=>field.value)),names)
 for(const text of ['컬러샘플','블랙','아이보리','생산 일정 협의','11월 출시'])assert.ok((await row.textContent()).includes(text)||names.includes(text),text)
 assert.equal(await row.getByRole('textbox',{name:'PL-TEST 한글명'}).getAttribute('readonly'),'')
 assert.equal(await row.getByRole('button',{name:/합격|불합격/}).count(),0,'샘플 판정 버튼 없음')
 assert.equal(await row.getByRole('button',{name:'수령 확인',exact:true}).isDisabled(),true,'컬러샘플 수령도 작성자만 기록')
 for(const label of ['이름확정','컬러 문서','컬러 구성 확정','컬러명확정'])assert.equal(await row.getByRole('button',{name:label,exact:true}).isDisabled(),true,label)
 await row.getByRole('button',{name:'Fabric',exact:true}).first().click()
 const popover=page.locator('.draft-sheet-entry-form');assert.equal(await popover.locator('input').inputValue(),'나일론');assert.equal(await popover.locator('input').getAttribute('readonly'),'');assert.equal(await popover.getByRole('button',{name:'저장',exact:true}).isDisabled(),true)
 await popover.evaluate(form=>form.requestSubmit());assert.equal(await page.getByTestId('writes').textContent(),'0')
 await row.getByRole('button',{name:'Fabric',exact:true}).first().click()
 await row.getByRole('button',{name:'스펙 문서',exact:true}).first().click();assert.equal(await page.locator('.draft-sheet-entry-form input').inputValue(),'공유 스펙 본문');await row.getByRole('button',{name:'스펙 문서',exact:true}).first().click()
 await row.getByRole('button',{name:/사진 크게 보기/}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'사진 크게 보기 닫기'}).click()
 await row.getByRole('button',{name:'PL-TEST 기획안 조회'}).click();assert.equal(await page.getByTestId('opened').textContent(),'1')
 await page.screenshot({path:'.tmp/draft-sheet-readonly-desktop.png',fullPage:true})
 for(const [phase,label]of [['new','샘플 작업지시서'],['color-upload','컬러 샘플 작업지시서']]){await page.getByLabel('검증 단계').selectOption(phase);assert.equal(await row.getByRole('button',{name:label,exact:true}).isDisabled(),true)}
 await page.getByRole('button',{name:'작성자로 전환'}).click()
 assert.equal(await row.getByRole('button',{name:'컬러 샘플 작업지시서',exact:true}).isEnabled(),true)
 await row.getByRole('textbox',{name:'PL-TEST 한글명'}).fill('작성자 변경');await row.getByRole('textbox',{name:'PL-TEST 한글명'}).blur();await page.waitForFunction(()=>document.querySelector('[data-testid="writes"]').textContent==='1')
 await row.getByRole('button',{name:'Fabric',exact:true}).first().click();await page.locator('.draft-sheet-entry-form input').fill('저장 전 임시 입력');await page.getByRole('button',{name:'다른 직원으로 전환'}).click();assert.equal(await page.locator('.draft-sheet-entry-form').getByRole('button',{name:'저장',exact:true}).isDisabled(),true)
 assert.equal(await page.locator('.draft-sheet-entry-form input').inputValue(),'나일론','Permission change restores saved spec value')
 await page.locator('.draft-sheet-entry-form').evaluate(form=>form.requestSubmit());assert.equal(await page.getByTestId('writes').textContent(),'1')
 assert.deepEqual(errors,[])
 console.log('draft-sheet-readonly: same layout/content, readable specs/photo/details, blocked inline/sample/confirm/schedule writes and live permission transition; owner editing preserved')
}finally{await browser?.close();await server?.close()}
