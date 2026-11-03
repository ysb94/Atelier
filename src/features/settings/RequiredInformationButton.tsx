import { useEffect, useId, useRef } from 'react'
import { FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/supabase/auth'
import { RELEASE_COMPANY_ID, RELEASE_EXCEPTION_IDS } from '@/lib/company/release-access'

/** 승인 후 노출 위치 검수용. 개인정보 입력·첨부·저장 기능은 아직 연결하지 않는다. */
export function RequiredInformationButton() {
  const { profile, session } = useAuth()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const visible = profile?.status === 'active' && profile.companyId === RELEASE_COMPANY_ID
    && profile.id === RELEASE_EXCEPTION_IDS[0] && session?.user.id === profile.id
  useEffect(() => { if (!visible) dialog.current?.close() }, [visible])
  if (!visible) return null
  return <>
    <Button type="button" className="h-11 px-7 text-base font-semibold shadow-md" onClick={() => dialog.current?.showModal()}><FileText className="size-4" aria-hidden="true" />필수정보 입력</Button>
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/35">
      <div className="flex items-center justify-between gap-3 border-b border-border p-5"><h2 id={titleId} className="text-lg font-semibold">필수정보 입력</h2><Button type="button" size="icon" variant="ghost" autoFocus aria-label="필수정보 입력 닫기" onClick={() => dialog.current?.close()}><X className="size-4" /></Button></div>
      <div className="space-y-4 p-5">
        <p id={descriptionId} className="text-sm text-muted-foreground">승인 후 입사정보를 제출하는 화면 미리보기입니다. 현재는 입력 항목만 확인하며 실제 개인정보나 파일을 받지 않습니다.</p>
        {[
          ['기본 정보·연락처', '본명 · 구글 로그인 이메일 · N메일 · 전화번호 · 주소'],
          ['급여 정보', '은행 · 예금주 · 계좌번호 · 통장 사본'],
          ['인사 서류', '신분증 사본 · 학력 증명서'],
        ].map(([title, content]) => <section key={title} className="rounded-xl border border-border bg-card p-4 shadow-sm"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 text-sm text-muted-foreground">{content}</p></section>)}
      </div>
      <div className="flex justify-end border-t border-border p-4"><Button type="button" variant="outline" onClick={() => dialog.current?.close()}>닫기</Button></div>
    </dialog>
  </>
}
