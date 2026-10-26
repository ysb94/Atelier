import assert from 'node:assert/strict'

export async function verifyPagePreviewRoles(page, origin) {
  await page.goto(origin + '/')
  await page.getByRole('button', { name: '채팅', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '개발자 화면 미리보기' }).count(), 0)
  assert.equal(await page.getByRole('region', { name: '직원 계정 전환' }).count(), 0, '미리보기 서버가 없으면 계정 전환 막대를 숨김')
  assert.equal(await page.getByRole('group', { name: '표시 역할' }).count(), 0)
  assert.equal(await page.getByLabel('신청 관계', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('회의 관계', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  await page.locator('#workspace-chat-panel').waitFor()
  assert.equal(await page.getByRole('region', { name: '채팅 화면 미리보기' }).count(), 0)
  await page.keyboard.press('Escape')
  await page.goto(origin + '/?identity=employee')
  await page.getByRole('button', { name: '채팅', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '직원 계정 전환' }).count(), 0, '일반 직원에게 계정 전환 비노출')
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  assert.equal(await page.getByRole('region', { name: '채팅 화면 미리보기' }).count(), 0)
  await page.goto(origin + '/chat/room/fixture-room')
  assert.equal(await page.getByRole('region', { name: '채팅 화면 미리보기' }).count(), 0)
  assert.equal(await page.getByRole('group', { name: '표시 역할' }).count(), 0)
  console.log('page-preview-roles: 역할·신청·회의 표시 전환 제거, 계정 전환 막대는 미리보기 서버 없이 숨김 통과')
}
