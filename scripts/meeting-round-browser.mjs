import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
export async function verifyMeetingRoundBrowser(page,origin) {
 await page.goto(origin+'/meetings')
 await page.getByText('회의 저장 검증',{exact:true}).waitFor()
 await page.evaluate(()=>{
  const key='atelier:meeting-fixture',value=JSON.parse(sessionStorage.getItem(key))
  value.roundRoles=true
  const series=value.series[0];series.kind='project';series.phase='published';series.roundMembershipReady=true
  const round=series.rounds[0];round.confirmed=true;round.scheduleVersion=1;round.detailAccess='full'
  round.membership=[{person:series.members[0],role:'attendee'}];round.sharedResults=[]
  sessionStorage.setItem(key,JSON.stringify(value))
 })
 await page.reload();await page.getByText('회의 저장 검증',{exact:true}).waitFor()
 const row=page.locator('li').filter({has:page.getByText('회의 저장 검증',{exact:true})})
 await row.getByRole('button',{name:/1차/}).click()
 const dialog=page.getByRole('dialog',{name:'회의 저장 검증'})
 await dialog.getByRole('button',{name:'회차 멤버 관리'}).click()
 await dialog.getByRole('combobox',{name:'검증 동료 회차 역할'}).selectOption('result')
 await dialog.getByRole('combobox',{name:'추가할 회차 멤버'}).selectOption('extra-user')
 await dialog.getByRole('button',{name:'멤버 추가',exact:true}).click()
 await page.evaluate(()=>{const k='atelier:meeting-fixture',s=JSON.parse(sessionStorage.getItem(k));s.failNext=true;sessionStorage.setItem(k,JSON.stringify(s))})
 await dialog.getByRole('button',{name:'명단 저장'}).click()
 await dialog.getByRole('alert').filter({hasText:'검증용 저장 실패'}).waitFor()
 assert.equal(await dialog.getByRole('combobox',{name:'검증 동료 회차 역할'}).inputValue(),'result','저장 실패 시 역할 보존')
 await dialog.getByRole('button',{name:'명단 저장'}).click()
 await dialog.getByText('결과 공유만 · 1명',{exact:true}).waitFor()
 await dialog.getByRole('textbox',{name:'회의 결과',exact:true}).fill('공유할 결정 사항')
 await dialog.getByRole('button',{name:'결과 공유',exact:true}).click()
 await dialog.getByRole('button',{name:'수정 결과 공유',exact:true}).waitFor()
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('atelier:meeting-fixture')))
 assert.equal(saved.series[0].rounds[0].sharedResults[0].body,'공유할 결정 사항')
 await fs.mkdir('.tmp/meeting-round-browser',{recursive:true})
 await page.screenshot({path:'.tmp/meeting-round-browser/host.png',fullPage:true})
 await page.evaluate(()=>{
  const k='atelier:meeting-fixture',s=JSON.parse(sessionStorage.getItem(k)),r=s.series[0].rounds[0]
  r.detailAccess='result';r.content='';r.result='';r.prepMaterials=[];s.failNext=true;s.notices=[{id:'result-notice',recipient:'other-user',kind:'meeting_result',title:'회의 결과 공유',body:'공유된 결과를 확인하세요.',href:'/settings/profile?part=meetings&meeting=fixture-meeting&round=fixture-round&resultVersion=result:1',createdAt:'2030-01-07T03:00:00Z',readAt:null}];sessionStorage.setItem(k,JSON.stringify(s))
 })
 await page.goto(origin+'/meetings?meeting-member&meeting=fixture-meeting&round=fixture-round')
 const readonly=page.getByRole('dialog',{name:'회의 저장 검증'})
 await readonly.getByText('공유할 결정 사항',{exact:true}).waitFor()
 assert.equal(await readonly.getByRole('button',{name:'참석 가능',exact:true}).count(),0)
 assert.equal(await readonly.getByRole('button',{name:'올리기',exact:true}).count(),0)
 assert.equal(await readonly.getByRole('textbox').count(),0)
 await readonly.getByRole('alert').filter({hasText:'읽음 기록을 저장하지 못했습니다.'}).waitFor()
 await readonly.getByRole('button',{name:'읽음 저장 재시도',exact:true}).click()
 await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('atelier:meeting-fixture')).read?.includes('result-notice'))
 await page.screenshot({path:'.tmp/meeting-round-browser/result-only.png',fullPage:true})
 console.log('meeting-round-browser: role UI, add member, save failure/retry, publish, result-only read-only view passed')
}
