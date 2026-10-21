import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

export async function verifyWorkspaceOverlays(page, origin) {
  await page.setViewportSize({ width: 700, height: 1000 })
  await page.goto(origin + '/__overlay-audit')
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  await page.getByRole('button', { name: /검증 대화방/ }).click()
  const message = page.getByRole('textbox', { name: '메시지 입력', exact: true })
  await message.fill('전송하지 않은 채팅 초안')
  await page.locator('#workspace-chat-panel').evaluate(panel => { window.__originalChatPanel = panel })

  async function aboveModal(panelId, name) {
    await page.waitForFunction(({ id, name }) => {
      const panel = document.getElementById(id)
      const modal = [...document.querySelectorAll('dialog:modal')].find(dialog => dialog.getAttribute('aria-label') === name || dialog.getAttribute('aria-labelledby') === name)
      return modal && modal.contains(panel) && panel.closest('[data-workspace-overlay-root]')?.matches(':popover-open')
    }, { id: panelId, name })
    const hit = await page.locator('#' + panelId).evaluate(panel => {
      const rect = panel.getBoundingClientRect()
      // 크기·클리핑·실제 포인터 수신을 함께 확인한다. 모달과 겹치는 가운데와 네 모서리.
      const points = [[.5, .5], [.1, .1], [.9, .1], [.1, .9], [.9, .9]]
      return points.map(([x, y]) => {
        const element = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y)
        return { above: panel.contains(element), hit: element?.tagName }
      })
    })
    assert.ok(hit.every(point => point.above), `${name}: ${panelId} 가림: ${JSON.stringify(hit)}`)
  }
  async function draftRetained() {
    assert.equal(await page.locator('#workspace-chat-panel').evaluate(panel => panel === window.__originalChatPanel), true, '모달 이동 시 채팅 DOM 재생성 금지')
    assert.equal(await message.inputValue(), '전송하지 않은 채팅 초안', '전송 전 입력 유지')
    await message.click()
    assert.equal(await message.evaluate(element => element === document.activeElement), true, 'native 모달 밖 inert 상태로 채팅 입력 차단 금지')
  }
  async function clickWithoutOutsideClose(locator) {
    // 페이지 모달이 프로그램적으로 열리는 상황. 외부 mousedown 없이 실제 컴포넌트의 핸들러 실행.
    await locator.evaluate(element => element.click())
  }
  async function backToBody() {
    await page.waitForFunction(() => document.querySelector('[data-workspace-overlay-root]')?.parentElement === document.body)
    await draftRetained()
  }

  // 실제 디자인 확대 창: 열기, 확대 전환, React unmount로 닫기.
  await clickWithoutOutsideClose(page.getByRole('button', { name: '검증 이미지 크게 보기', exact: true }))
  await aboveModal('workspace-chat-panel', '검증 이미지 크게 보기')
  await draftRetained()
  await clickWithoutOutsideClose(page.getByRole('button', { name: '원본 크기', exact: true }))
  await page.getByRole('button', { name: '화면에 맞추기', exact: true }).waitFor()
  await clickWithoutOutsideClose(page.getByRole('button', { name: '크게 보기 닫기', exact: true }))
  await backToBody()

  // 실제 일정 상세: 조건부 mount/unmount, cancel 핸들러와 동일한 닫기 보존.
  await page.evaluate(() => window.__overlayAudit.home())
  await aboveModal('workspace-chat-panel', 'home-day-dialog-title')
  await draftRetained()
  await clickWithoutOutsideClose(page.getByRole('button', { name: '날짜 상세 닫기', exact: true }))
  await backToBody()

  // 실제 업무 추가/공지/상세: showModal/close 및 입력·읽음 동작 보존.
  await clickWithoutOutsideClose(page.getByRole('button', { name: '업무 추가', exact: true }).first())
  await aboveModal('workspace-chat-panel', '업무 추가')
  const workTitle = page.getByPlaceholder('어떤 일을 할 예정인가요?')
  await workTitle.evaluate(input => { input.focus() })
  await workTitle.fill('저장하지 않은 업무 초안')
  await draftRetained()
  await page.keyboard.press('Escape')
  await page.locator('#workspace-chat-panel').waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('dialog', { name: '업무 추가', exact: true }).evaluate(dialog => dialog.matches(':modal')), true, '채팅 Escape가 원래 업무 모달까지 닫지 않음')
  assert.equal(await workTitle.inputValue(), '저장하지 않은 업무 초안')
  await page.waitForFunction(() => document.activeElement?.getAttribute('placeholder') === '어떤 일을 할 예정인가요?')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '업무 추가', exact: true }).waitFor({ state: 'hidden' })

  for (const [button, modalName, closeName] of [
    ['.mw-notice', '공지 내용', '공지 닫기'],
    ['.mw-task', '업무 상세', '업무 상세 닫기'],
  ]) {
    await page.getByRole('button', { name: /^알림(?:,|$)/ }).click()
    await clickWithoutOutsideClose(page.locator(button).first())
    await aboveModal('workspace-notification-panel', modalName)
    const markAll = page.locator('#workspace-notification-panel').getByRole('button', { name: '모두 읽음', exact: true })
    if (await markAll.isEnabled()) await markAll.click()
    assert.equal(await markAll.isDisabled(), true, '모두 읽음 상태가 재오픈 후에도 유지')
    await page.locator('#workspace-notification-panel').getByRole('button', { name: '전체', exact: true }).click()
    await clickWithoutOutsideClose(page.getByRole('button', { name: closeName, exact: true }))
    await page.waitForFunction(() => document.querySelector('[data-workspace-overlay-root]')?.parentElement === document.body)
    await page.keyboard.press('Escape')
  }

  // 닫힌 모달/중첩 모달/transform+overflow:hidden에서도 같은 패널과 입력 유지.
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  await page.getByRole('button', { name: /검증 대화방/ }).click()
  await message.fill('전송하지 않은 채팅 초안')
  await page.locator('#workspace-chat-panel').evaluate(panel => { window.__originalChatPanel = panel })
  await page.evaluate(() => window.__overlayAudit.show())
  await aboveModal('workspace-chat-panel', '입력 유지 점검')
  await draftRetained()
  await page.evaluate(() => window.__overlayAudit.nested())
  await aboveModal('workspace-chat-panel', '중첩 모달 점검')
  await draftRetained()
  await mkdir('.tmp', { recursive: true })
  await page.screenshot({ path: '.tmp/workspace-overlay-nested.png' })
  await page.evaluate(() => window.__overlayAudit.closeNested())
  await aboveModal('workspace-chat-panel', '입력 유지 점검')
  await draftRetained()
  await page.evaluate(() => window.__overlayAudit.close())
  await backToBody()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-workspace-overlay-root]').count(), 0, '닫힌 뒤 투명 레이어 제거')
  await page.setViewportSize({ width: 1440, height: 1000 })
  console.log('workspace-overlays-browser: 실제 이미지·일정·업무 추가/공지/상세, 중첩·클리핑, 채팅 초안·모달 입력·포커스·Escape 보존 통과')
}
