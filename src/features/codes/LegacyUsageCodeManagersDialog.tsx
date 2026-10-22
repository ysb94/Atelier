import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { getUsagePartnerManagerCandidates } from '@/lib/supabase/usage-partner-settings'

export function LegacyUsageCodeManagersDialog({
  brandId,
  partnerLabel,
  initialIds,
  saving,
  onClose,
  onSave,
}: {
  brandId: string
  partnerLabel: string
  initialIds: string[]
  saving: boolean
  onClose: () => void
  onSave: (ids: string[]) => Promise<void>
}) {
  const candidates = useQuery({
    queryKey: ['usagePartnerManagerCandidates', brandId],
    queryFn: () => getUsagePartnerManagerCandidates(brandId),
    retry: false,
  })
  const [ids, setIds] = useState(() => new Set(initialIds)),
    [error, setError] = useState<string | null>(null)
  async function save() {
    try {
      await onSave([...ids])
    } catch (cause) {
      console.warn('[usage-headers] 담당자 저장 실패', {
        brandId,
        message: String(cause),
      })
      setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.')
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="담당자 설정 닫기"
        disabled={saving}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="업체 담당자 설정"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-xl"
      >
        <header className="border-b border-border p-5">
          <h2 className="font-semibold">업체 담당자 설정</h2>
          <p className="mt-1 text-sm font-medium">{partnerLabel}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            선택한 담당자만 이 업체의 헤더와 전용 값을 수정합니다. 관리자·브랜드
            책임자는 기존 관리 권한을 사용합니다.
          </p>
        </header>
        <div className="space-y-2 overflow-auto p-5">
          {candidates.isLoading ? <p>담당자 목록을 확인 중입니다.</p> : null}
          {candidates.isError ? (
            <p role="alert" className="text-danger">
              {String(candidates.error)}
            </p>
          ) : null}
          {candidates.data?.map((person) => (
            <label
              key={person.id}
              className="flex items-center gap-2 rounded border border-border p-3"
            >
              <input
                type="checkbox"
                aria-label={`${person.display_name || '이름 미등록'} 담당자`}
                checked={ids.has(person.id)}
                disabled={saving || !person.display_name}
                onChange={(event) =>
                  setIds((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(person.id)
                    else next.delete(person.id)
                    return next
                  })
                }
              />
              {person.display_name ||
                '이름 미등록 · 멤버 정보에서 본명을 등록하세요.'}
            </label>
          ))}
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border p-4">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            닫기
          </Button>
          <Button
            type="button"
            disabled={saving || !candidates.isSuccess}
            onClick={() => void save()}
          >
            {saving ? '저장 중…' : '담당자 저장'}
          </Button>
        </footer>
      </section>
    </div>
  )
}
