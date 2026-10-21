import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/** 지정 원본을 두 곳에서 관리하지 않도록 중앙 설정으로 안내한다. */
export function UsageCodeManagersDialog({ partnerLabel, onClose }: {
  brandId: string
  partnerLabel: string
  initialIds: string[]
  saving: boolean
  onClose: () => void
  onSave: (ids: string[]) => Promise<void>
}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" className="absolute inset-0 bg-black/40" aria-label="담당자 설정 닫기" onClick={onClose}/>
    <section role="dialog" aria-modal="true" aria-label="업체 담당자 설정" className="relative w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl">
      <h2 className="font-semibold">업체 담당자 설정</h2>
      <p className="text-sm">{partnerLabel}</p>
      <p className="text-sm text-muted-foreground">담당자는 권한·담당자 설정에서 한곳으로 관리합니다. ‘업체 헤더·전용 값 편집’을 선택하고 이 업체를 지정하세요.</p>
      <div className="flex justify-end gap-3"><Button variant="outline" onClick={onClose}>닫기</Button><Link className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" to="/settings/permissions" onClick={onClose}>권한·담당자 설정 열기</Link></div>
    </section>
  </div>
}
