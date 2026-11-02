import assert from 'node:assert/strict'
export async function verifyMeetingManualConfirmationBrowser(page,origin){
 await page.goto(origin+'/meetings')
 await page.evaluate(()=>sessionStorage.setItem('atelier:meeting-fixture',JSON.stringify({series:[{
  id:'manual-series',revision:1,kind:'project',phase:'published',manualConfirmationReady:true,title:'차수 제외 검증',host:{id:'fixture-user',name:'화면 검수'},
  members:[{id:'other-user',name:'검증 불참자'},{id:'available-user',name:'검증 참석자'}],status:'in_progress',durationMinutes:60,
  rounds:[{id:'manual-round',round:1,confirmed:true,scheduleVersion:1,startsAt:'2030-01-07T10:00',roomId:'room-1',quarterId:'q1',content:'안내',result:'',prepMaterials:[],
   responses:[{profileId:'other-user',status:'unavailable'},{profileId:'available-user',status:'pending'}]}]
 }],files:{},audit:[]})))
 await page.reload()
 const row=page.locator('li').filter({has:page.getByText('차수 제외 검증',{exact:true})})
 await row.getByText('불참 1명 · 응답 대기 1명',{exact:true}).waitFor()
 const open=async()=>{await row.getByRole('button',{name:/1차/}).click();return page.getByRole('dialog',{name:'차수 제외 검증',exact:true})}
 let detail=await open()
 assert.equal(await detail.getByRole('button',{name:'수동 확정',exact:true}).isDisabled(),true,'응답 대기 중 수동 확정 차단')
 await detail.getByRole('button',{name:'닫기',exact:true}).filter({hasText:/^닫기$/}).click()
 await page.evaluate(()=>{const s=JSON.parse(sessionStorage.getItem('atelier:meeting-fixture'));s.series[0].rounds[0].responses[1].status='available';sessionStorage.setItem('atelier:meeting-fixture',JSON.stringify(s))})
 await page.reload();detail=await open()
 await row.getByText('불참 1명 · 진행 확인 필요',{exact:true}).waitFor()
 const manual=detail.getByRole('button',{name:'수동 확정',exact:true})
 assert.equal(await manual.evaluate(button=>button.previousElementSibling.textContent),'일정 변경','일정 변경 바로 옆에 표시')
 await manual.click()
 const confirm=page.getByRole('dialog',{name:'불참자 제외하고 이번 차수 확정',exact:true})
 await confirm.getByText('검증 불참자',{exact:true}).waitFor()
 assert.equal(await confirm.getByText('검증 참석자',{exact:true}).count(),0)
 await confirm.screenshot({path:'.tmp/meeting-manual-confirmation.png'})
 await confirm.getByRole('button',{name:'불참자 제외하고 확정',exact:true}).click();await confirm.waitFor({state:'hidden'})
 await row.getByText('수동 확정 · 불참자 제외',{exact:true}).waitFor()
 await page.reload();await row.getByText('수동 확정 · 불참자 제외',{exact:true}).waitFor()
 const s=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('atelier:meeting-fixture')))
 assert.equal(s.series[0].members.length,2,'전체 멤버 유지')
 assert.deepEqual(s.series[0].rounds[0].manualConfirmation.excludedIds,['other-user'])
 assert.equal(s.series[0].rounds[0].responses[0].status,'unavailable','불참 응답 이력 유지')
 assert.equal(s.audit.filter(x=>x==='manually_confirm_meeting_round').length,1)
 detail=await open()
 await detail.getByRole('button',{name:'저장하고 다음 회의 진행',exact:true}).click()
 await detail.waitFor({state:'hidden'})
 const next=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('atelier:meeting-fixture')).series[0])
 assert.equal(next.rounds.length,2,'실제 다음 차수 생성 버튼으로 2차 생성')
 assert.equal(next.members.length,2,'다음 차수에도 기존 멤버 전원 유지')
 assert.ok(!next.rounds[1].manualConfirmation,'1차 제외가 2차로 이어지지 않음')
 await row.getByRole('button',{name:/2차/}).click()
 detail=page.getByRole('dialog',{name:'차수 제외 검증',exact:true})
 await detail.getByRole('button',{name:'검증 불참자 · 준비 중',exact:true}).waitFor()
 await detail.getByRole('button',{name:'검증 참석자 · 준비 중',exact:true}).waitFor()
 console.log('meeting-manual-confirmation-browser: 전원 응답 제한·버튼 위치·명단 확인·확정·목록 표시·새로고침·이력 보존 통과')
}
