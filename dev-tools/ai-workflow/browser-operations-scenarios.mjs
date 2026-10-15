import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export async function documentsScenario({page,origin}) {
  const base=origin+'/__fixture/operations?part=documents'
  await page.goto(base);await page.getByRole('heading',{name:'서류 출력',exact:true}).waitFor()
  assert.equal(await page.getByRole('tab',{name:'서류 출력',exact:true}).getAttribute('aria-selected'),'true')
  await page.locator('#document-output-member').selectOption('member-0')
  const year=String(new Date().getFullYear()+1)
  await page.locator('#document-output-year').selectOption(year)
  const summary=page.getByRole('region',{name:'선택 조건 요약'})
  assert.match(await summary.innerText(),new RegExp(year+'년'));assert.match(await summary.innerText(),/검증 사원/)
  for(const kind of ['월별 근태','신청 처리 내역']){
    await page.getByRole('button',{name:kind,exact:true}).click();await page.locator('#document-output-month').fill('2026-09')
    assert.match(await summary.innerText(),/2026년 9월/);assert.match(await summary.innerText(),new RegExp(kind))
  }
  assert.equal(await page.getByRole('button',{name:'인쇄',exact:true}).isDisabled(),true)
  await page.getByRole('heading',{name:'서류 미리보기 자리',exact:true}).waitFor()
  const states=[]
  for(const mode of ['loading','error','empty']){
    await page.goto(base+'&directory='+mode)
    const select=page.locator('#document-output-member');await select.waitFor()
    if(mode==='loading'){assert.equal(await select.isDisabled(),true);await page.getByText('직원 목록을 불러오는 중입니다.',{exact:true}).waitFor()}
    if(mode==='empty')await page.getByText('등록된 직원이 없습니다.',{exact:true}).waitFor()
    if(mode==='error'){
      await page.getByRole('button',{name:'다시 불러오기',exact:true}).waitFor();assert.equal(await select.isDisabled(),true)
      await page.evaluate(()=>{window.__fixtureDirectoryMode='ready'})
      await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await select.selectOption('member-0');assert.equal(await select.isDisabled(),false)
    }
    states.push({mode,checked:true})
  }
  await page.goto(base)
  for(const tab of ['조직도','근태','연차관리','승인자 설정','서류 출력']){await page.getByRole('tab',{name:tab,exact:true}).click();await page.getByRole('tab',{name:tab,exact:true,selected:true}).waitFor()}
  await page.goto(base+'&department='+encodeURIComponent('디자인팀'))
  await page.getByText('운영지원팀 전용 화면입니다.',{exact:true}).waitFor();assert.equal(await page.locator('#document-output-member').count(),0)
  return {directEntry:true,kindYearMonthMemberSummary:true,disabledPrint:true,previewPlaceholder:true,states,existingTabs:true,deniedSubtreeNotMounted:true}
}

export async function profileScenario({page,origin}) {
  const checked=[]
  for(const values of [{grade:'대리',hire:'2020-01-01',expected:['대리','2020년 1월 1일']},{grade:'',hire:'',expected:['직급 미정','입사일 미등록']}]){
    await page.goto(origin+'/__fixture/profile?'+new URLSearchParams({grade:values.grade,hire:values.hire}))
    await page.getByRole('tab',{name:'내 정보',exact:true}).click()
    const panel=page.locator('#personal-profile-panel');await panel.waitFor()
    for(const text of values.expected)await panel.getByText(text,{exact:true}).waitFor()
    assert.equal(await panel.locator('input,textarea,select').count(),0)
    await panel.getByText('계정 정보',{exact:true}).waitFor()
    await page.getByRole('tab',{name:'근태·신청',exact:true}).click();assert.equal(await panel.isVisible(),false)
    await page.getByRole('tab',{name:'내 정보',exact:true}).click();await panel.waitFor()
    checked.push({grade:values.grade,hire:values.hire,dateNotShifted:true,readOnly:true,tabsRetained:true})
  }
  return {checked}
}

export async function attendancePolicyScenario({page,origin,root}) {
  const missing=[]
  await page.goto(origin+'/__fixture/operations?part=attendance')
  await page.getByRole('button',{name:'출근시간 확인',exact:true}).click()
  if(!/5분/.test(await page.locator('body').innerText()))missing.push('운영지원의 읽기 전용 출근시간 화면에 5분 안내가 없습니다.')
  for(const route of ['/__fixture/start-settings','/__fixture/my-start']){
    await page.goto(origin+route);await page.getByText('검증 사원',{exact:true}).first().waitFor()
    if(!/5분/.test(await page.locator('body').innerText()))missing.push(`${route} 초기 화면에 5분 안내가 없습니다.`)
    assert.equal(await page.getByRole('spinbutton',{name:/인정|유예/}).count(),0)
    if(route.endsWith('start-settings')){
      await page.getByRole('region',{name:'부서 기본 출근시간'}).getByRole('button',{name:'설정',exact:true}).click()
      await page.getByRole('button',{name:'출근시간 저장',exact:true}).click()
    }else{
      await page.getByRole('checkbox',{name:'검증 사원 선택',exact:true}).check()
      await page.getByRole('button',{name:/월 · 1명 적용/}).click()
    }
    await page.waitForFunction(()=>window.__fixtureRpcCalls?.length>0)
    const calls=await page.evaluate(()=>window.__fixtureRpcCalls)
    assert.ok(calls.every(v=>v.name==='save_attendance_start_settings'&&v.args.p_grace===5))
  }
  await page.goto(origin+'/__fixture/profile');await page.getByRole('tab',{name:'근태·신청',exact:true}).click()
  const noticeDetails=page.locator('details').filter({has:page.getByText('공지] 휴가 사용 제도 안내',{exact:true})})
  if(await noticeDetails.getAttribute('open')===null)await page.getByText('공지] 휴가 사용 제도 안내',{exact:true}).click()
  const source=fs.readFileSync(path.join(root,'src/features/settings/PersonalRequestsPanel.tsx'),'utf8'),notice=source.match(/const LEAVE_USE_NOTICE = `([\s\S]*?)`/)[1]
  assert.ok((await page.locator('body').innerText()).includes(notice),'Full confirmed leave notice missing')
  await page.getByText('연차 부여 일수·입사일·연도 계산 기준 보류 중',{exact:true}).waitFor()
  await page.goto(origin+'/__fixture/operations?part=leave');await page.getByRole('button',{name:'연차 현황 · 시안',exact:true}).click()
  assert.match(await page.locator('body').innerText(),/계산 기준은 보류 중/)
  const results={operationsReadOnlyNotice:missing.length===0,departmentSaveGrace:5,employeeSaveGrace:5,noGraceInput:true,fullLeaveNotice:true,personalBalanceDeferred:true,operationsBalanceDeferred:true}
  console.log(JSON.stringify({scenario:'attendance-policy',results,missing}))
  assert.deepEqual(missing,[],'실제 화면에서 완료 기준이 누락됨')
  return results
}
