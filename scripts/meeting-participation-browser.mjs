import assert from 'node:assert/strict'

export async function verifyMeetingParticipationBrowser(page, origin) {
  await page.goto(origin + '/meetings')
  await page.getByText('회의 저장 검증', { exact: true }).waitFor()
  await page.evaluate(() => {
    const key = 'atelier:meeting-fixture', state = JSON.parse(sessionStorage.getItem(key))
    state.participation = [{ profile_id: 'other-user', titles: ['타부서 월간 회의', '상품 검토 회의'] }]
    sessionStorage.setItem(key, JSON.stringify(state))
  })
  assert.equal(await page.getByText('타부서 월간 회의', { exact: true }).count(), 0, '본문 목록에는 비참석 회의를 추가하지 않음')
  const dialog = () => page.getByRole('dialog', { name: '회의 생성', exact: true })
  async function open() {
    await page.getByRole('button', { name: '회의 생성', exact: true }).click()
    const picker = dialog().getByRole('button', { name: '멤버 목록 열기', exact: true })
    if (await picker.getAttribute('aria-expanded') !== 'true') await picker.click()
  }
  await open()
  const member = dialog().getByRole('button', { name: '검증 동료 진행 중 2건', exact: true })
  await member.waitFor(); await member.locator('span').last().hover()
  const tooltip = page.getByRole('tooltip')
  await tooltip.getByText('타부서 월간 회의', { exact: true }).waitFor()
  await tooltip.getByText('상품 검토 회의', { exact: true }).waitFor()
  assert.equal(await tooltip.getByRole('link').count(), 0, '제목에서 본문·채팅으로 이동하는 링크 없음')
  assert.equal(await tooltip.getByText(/열람 권한이 없는 회의/).count(), 0)
  await member.click(); assert.equal(await member.getAttribute('aria-pressed'), 'true', '제목 조회가 멤버 선택 동작을 바꾸지 않음')
  await dialog().getByRole('button', { name: '닫기', exact: true }).click()
  await page.evaluate(() => { const key = 'atelier:meeting-fixture', state = JSON.parse(sessionStorage.getItem(key)); state.participationError = true; sessionStorage.setItem(key, JSON.stringify(state)) })
  await open()
  await dialog().getByRole('button', { name: '검증 동료 진행 회의 확인 불가', exact: true }).waitFor()
  assert.equal(await dialog().getByRole('button', { name: '검증 동료 진행 중 0건', exact: true }).count(), 0, '조회 실패를 0건으로 표시하지 않음')
  await dialog().getByRole('button', { name: '닫기', exact: true }).click()
  await page.evaluate(() => { sessionStorage.removeItem('atelier:meeting-fixture'); localStorage.removeItem('atelier:meeting-fixture') })
  await page.reload()
  console.log('meeting-participation-browser: 본문 목록과 독립된 비참석 회의 제목·건수 표시·제목만 조회·멤버 선택 유지·조회 실패 시 0건 방지 통과')
}
