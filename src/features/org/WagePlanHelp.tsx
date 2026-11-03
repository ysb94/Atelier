import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { WAGE_PLANS, WAGE_PLAN_MONTHLY_THRESHOLD } from './company-information-values'

/** 근로유형 필드의 relative 컨테이너 안에서 안내가 입력 폭을 넘지 않게 표시한다. */
export function WagePlanHelp() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  }, [open])
  return <span ref={root} className="inline-flex" onPointerLeave={event => { if (event.pointerType !== 'touch') setOpen(false) }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) } }}>
    <Button type="button" variant="outline" size="icon" className="h-5 w-5 rounded-full text-xs" aria-label="근로유형 안내" aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined} onClick={() => setOpen(current => !current)}>!</Button>
    {open ? <span id={id} role="tooltip" className="absolute inset-x-0 top-5 z-20 block pt-2 text-sm font-normal">
      <span className="block space-y-1 rounded-xl border border-border bg-card p-3 text-foreground shadow-sm">
        <strong className="block">고정OT 설계(안) version2.</strong>
        {WAGE_PLANS.map((plan, index) => <span key={plan.value} className="block">{plan.value}: 1주 {plan.weeklyHours}시간 고정OT 산입 · 월 급여 {WAGE_PLAN_MONTHLY_THRESHOLD / 10_000}만원 {index === 0 ? '미만' : '이상'}</span>)}
        <span className="block text-xs text-muted-foreground">월 급여는 연봉 ÷ 12로 계산하며, 300만원부터 유형 2를 적용합니다.</span>
      </span>
    </span> : null}
  </span>
}
