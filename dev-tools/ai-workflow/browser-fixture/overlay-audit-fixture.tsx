import { useEffect, useRef, useState } from 'react'
import { StudioImagePreview } from '@/features/design/StudioImagePreview'
import { HomeDayDialog } from '@/features/home/HomeDayDialog'
import { MyWorkDashboard } from '@/features/work-requests/MyWorkDashboard'
import type { StudioAsset } from '@/lib/design/styled-studio'
import '@/features/design/styled-studio.css'

const asset = { name: '검증.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=' } as StudioAsset

export function OverlayAuditFixture() {
  const [home, setHome] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const nested = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    Object.assign(window, { __overlayAudit: {
      home: () => setHome(true),
      show: () => dialog.current?.showModal(),
      nested: () => nested.current?.showModal(),
      closeNested: () => nested.current?.close(),
      close: () => dialog.current?.close(),
    } })
    return () => { delete (window as any).__overlayAudit }
  }, [])
  return <section aria-label="겹침 점검 화면">
    <StudioImagePreview asset={asset} title="검증 이미지" disabled={false} selected={false} onSelect={() => {}} />
    <MyWorkDashboard initialRole="employee" />
    {home && <HomeDayDialog date="2026-10-21" events={[]} members={[]} examples={false} showTeam={false} onClose={() => setHome(false)} onMove={() => {}} />}
    <dialog ref={dialog} aria-label="입력 유지 점검" className="m-auto h-[80vh] w-[90vw] overflow-hidden bg-card p-4" style={{ transform: 'translateZ(0)' }}>
      <label>기존 모달 입력<input aria-label="기존 모달 입력" autoFocus defaultValue="기존 입력" /></label>
      <button onClick={() => dialog.current?.close()}>기존 모달 닫기</button>
      <dialog ref={nested} aria-label="중첩 모달 점검" className="m-auto h-[75vh] w-[85vw] overflow-hidden bg-card p-4"><input aria-label="중첩 입력" autoFocus defaultValue="중첩 입력" /></dialog>
    </dialog>
  </section>
}
