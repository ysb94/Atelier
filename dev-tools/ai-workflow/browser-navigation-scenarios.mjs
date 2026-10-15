import assert from 'node:assert/strict'

export async function dataMenuScenario({page,origin}) {
  const query='?fixture=data-menu&position='+encodeURIComponent('대표이사')
  await page.goto(origin+'/products'+query)
  await page.getByText('검증 상품',{exact:true}).first().waitFor()
  const expand=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await expand.isVisible())await expand.click()
  assert.equal(await page.locator('nav a[href="/products"]').count(),1)
  const top=await page.locator('nav a[href="/products"]').evaluate(link=>Array.from(link.parentElement.querySelectorAll('a')).map(a=>a.textContent.trim()))
  assert.ok(top.indexOf('전체 상품')===top.indexOf('운영 현황')+1,JSON.stringify(top))
  assert.equal(await page.locator('nav').getByRole('button',{name:'상품',exact:true}).count(),0)
  await page.getByRole('button',{name:'사이드바 접기',exact:true}).click();assert.equal(await page.locator('nav a[href="/products"]').count(),1)
  await page.getByText('검증 상품',{exact:true}).first().click();await page.waitForURL(/\/products\/fixture\/F-M001/)
  await page.goto(origin+'/data/all'+query)
  await page.getByRole('heading',{name:'상품 데이터',exact:true}).waitFor()
  await page.getByText('검증 상품',{exact:true}).first().waitFor()
  const expandAgain=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await expandAgain.isVisible())await expandAgain.click()
  const data=page.locator('nav').getByRole('button',{name:'데이터',exact:true});if(await data.getAttribute('aria-expanded')!=='true')await data.click()
  assert.equal(await page.locator('nav a[href="/data/all"]').innerText(),'상품 데이터')
  await page.locator('button[title="상품 데이터"]').waitFor()
  const row=page.getByText('검증 상품',{exact:true}).first();await row.dblclick()
  // The data sheet exposes its actual detail link via the row context menu.
  await page.waitForURL(/\/data\/all\/fixture\/F-M001/)
  return {topNavigationOrder:top,expandedAndCollapsedSingleProduct:true,oldProductGroupRemoved:true,dataMenuHeadingTabLabel:'상품 데이터',productsDetailOpened:true,dataSheetDetailOpened:true}
}

export async function brandInfoScenario({page,origin}) {
  const checked=[]
  for(const [admin,lead] of [[true,false],[false,true],[false,false]]) {
    const query='?'+new URLSearchParams({fixture:'brand-info',admin:String(admin),lead:String(lead)})
    await page.goto(origin+'/__brand-management'+query)
    const card=page.locator('button[aria-controls="selected-brand-info"]').first();await card.click()
    const info=page.locator('#selected-brand-info');await info.waitFor()
    const text=await info.innerText();for(const required of ['검증 브랜드','브랜드 검사 설명','fixture','#222222','3 SKU'])assert.ok(text.includes(required),required)
    assert.equal(await info.locator('[aria-label="#222222"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 34, 34)')
    assert.equal(await info.getByRole('button',{name:'수정',exact:true}).count(),admin||lead?1:0)
    assert.equal(await info.getByRole('button',{name:'삭제',exact:true}).count(),admin?1:0)
    if(admin||lead){await info.getByRole('button',{name:'수정',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'취소',exact:true}).click()}
    if(admin){await page.getByRole('button',{name:'새 브랜드',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'취소',exact:true}).click()}
    await info.getByRole('link',{name:/상품/}).click();await page.waitForURL(/\/products\?brands=fixture/)
    checked.push({admin,lead,infoOpened:true,edit:admin||lead,delete:admin,productLink:true,formsRetained:true})
  }
  for(const route of ['/settings/brand','/b/fixture/settings/brand']){
    await page.goto(origin+route+'?fixture=brand-info');await page.waitForURL(/\/brands/)
  }
  return {checked,legacyCompanyAndBrandRedirect:true}
}

export async function seasonsRemovalScenario({page,origin}) {
  for(const [route,target] of [['/settings/seasons','/drafts'],['/b/fixture/settings/seasons','/drafts']]){
    await page.goto(origin+route+'?fixture=seasons-removal');await page.waitForURL(url=>url.pathname===target)
  }
  const settings=page.locator('nav').getByRole('button',{name:'설정',exact:true});if(await settings.getAttribute('aria-expanded')!=='true')await settings.click()
  assert.equal(await page.locator('nav a[href$="/settings/seasons"]').count(),0)
  return {companyRedirect:true,brandRedirect:true,settingsEntryRemoved:true}
}
