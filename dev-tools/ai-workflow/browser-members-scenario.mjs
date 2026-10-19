import assert from 'node:assert/strict'
export async function membersDepartmentScenario({page,origin}) {
  await page.goto(origin+'/__fixture/members?admin=true&position='+encodeURIComponent('대표이사'))
  const input=page.getByRole('textbox',{name:'회사 부서 추가',exact:true})
  await input.waitFor()
  const save=input.locator('..').getByRole('button',{name:'저장',exact:true})
  assert.equal(await save.isDisabled(),true)
  await input.fill('합성 신규 부서');await save.click()
  await page.locator('input[value="합성 신규 부서"]').waitFor()
  await page.waitForFunction(()=>document.querySelector('input[aria-label="회사 부서 추가"]')?.value==='')
  assert.equal(await page.locator('input[value="기존 부서"]').count(),1)
  await page.evaluate(()=>{window.__fixtureDepartmentFailure=true})
  await input.fill('저장 실패 부서');await save.click()
  await page.getByRole('alert').waitFor()
  assert.equal(await input.inputValue(),'저장 실패 부서')
  assert.equal(await page.locator('input[value="기존 부서"]').count(),1)
  await page.evaluate(()=>{window.__fixtureDepartmentFailure=false})
  await input.fill('재시도 부서');await save.click()
  await page.locator('input[value="재시도 부서"]').waitFor()
  const rename=page.locator('input[value="기존 부서"]')
  await rename.fill('이름 변경 부서');await rename.press('Tab')
  await page.waitForFunction(()=>window.__fixtureDepartmentCalls.some(call=>call.kind==='update'&&call.value.name==='이름 변경 부서'))
  const calls=await page.evaluate(()=>window.__fixtureDepartmentCalls)
  assert.equal(calls.filter(call=>call.kind==='insert').length,2)
  assert.equal(await page.getByRole('alert').count(),0)
  const denied=await page.context().newPage(),errors=[]
  denied.on('pageerror',error=>errors.push(error.message))
  try{
    await denied.goto(origin+'/__fixture/members?admin=false')
    await denied.waitForURL(origin+'/')
    assert.equal(await denied.getByRole('textbox',{name:'회사 부서 추가',exact:true}).count(),0)
    assert.deepEqual(errors,[])
  }finally{await denied.close()}
  return {method:'offline actual component and profiles API adapter',emptyBlocked:true,saved:true,errorPreservesInput:true,retry:true,rename:true,adminOnly:true,remoteWrites:false}
}
