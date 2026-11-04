import { Button } from '@/components/ui/button'
import type { useDesktopNotifications } from '@/lib/inbox/use-desktop-notifications'

type Controls = ReturnType<typeof useDesktopNotifications>
export function DesktopNotificationSettings({ controls, invitation = false }: { controls: Controls; invitation?: boolean }) {
  const { allowed, enabled, busy, error } = controls
  return <section aria-label="PC 알림 설정" className="shrink-0 border-b border-border bg-card p-3 text-sm">
    <p className="font-medium">{invitation ? '업무 알림을 PC에서도 받을까요?' : 'PC 알림'}</p>
    <p className="mt-1 text-xs text-muted-foreground">{allowed === 'unsupported' ? '이 브라우저에서는 PC 알림을 지원하지 않습니다.' : allowed === 'denied' ? '브라우저의 사이트 설정에서 알림을 허용해 주세요.' : invitation ? '사이트를 최소화하거나 다른 탭을 보는 중에도 새 업무 알림을 받을 수 있습니다.' : allowed === 'granted' && enabled ? '켜짐 · 사이트가 열린 상태에서 받을 수 있습니다.' : '꺼짐 · 이 브라우저에서 알림을 켤 수 있습니다.'}</p>
    <div className="mt-2 flex gap-2">
      {allowed !== 'unsupported' && allowed !== 'denied' && (allowed === 'granted' && enabled ? <><Button size="sm" variant="outline" onClick={controls.disable}>PC 알림 끄기</Button><Button size="sm" variant="outline" onClick={controls.test}>테스트 알림</Button></> : <Button size="sm" disabled={busy} onClick={() => { void controls.enable() }}>알림 켜기</Button>)}
      {invitation && <Button size="sm" variant="ghost" onClick={controls.dismiss}>나중에</Button>}
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
  </section>
}
