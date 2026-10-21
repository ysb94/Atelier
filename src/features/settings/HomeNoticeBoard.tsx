import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { hasPermission } from '@/lib/company/permissions'
import { companyNoticePhase } from '@/lib/company/company-notices'
import { isPreviewProfile } from '@/lib/company/profile-preview'
import {
  deleteCompanyNotice,
  listCompanyNotices,
  saveCompanyNotice,
} from '@/lib/supabase/company-notices'
import { listDepartments } from '@/lib/supabase/profiles'
import { useRenderWatch } from '@/lib/diagnostics'
import { koreaDateKey } from '@/features/settings/my-attendance'

export function HomeNoticeBoard({
  kind,
}: {
  kind: 'company' | 'department'
}) {
  useRenderWatch(kind === 'company' ? 'CompanyNoticeBoard' : 'DepartmentNoticeBoard')
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const today = koreaDateKey()
  const noticesQuery = useQuery({
    queryKey: ['company-notices', kind],
    queryFn: () => listCompanyNotices(kind),
  })
  const namedDepartment = useQuery({
    queryKey: ['departments', 'notice-board', profile?.departmentName ?? ''],
    queryFn: () => listDepartments(),
    enabled: kind === 'department',
  })
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const ownDepartmentId = profile?.departmentId
    ?? namedDepartment.data?.find((department) => department.name === profile?.departmentName)?.id
    ?? null
  const allowedDepartments = (namedDepartment.data ?? []).filter(department => department.id === ownDepartmentId || hasPermission(profile,'notice.department.write','department',department.id) || hasPermission(profile,'notice.department.delete','department',department.id))
  const departmentId = allowedDepartments.find(department => department.id === selectedDepartment)?.id ?? ownDepartmentId ?? allowedDepartments[0]?.id ?? null
  const departmentName = allowedDepartments.find(department => department.id === departmentId)?.name ?? profile?.departmentName?.trim() ?? '대상 부서'
  const canDelete = hasPermission(profile,'notice.department.delete','department',departmentId)
  const canRegister = kind === 'department'
    && hasPermission(profile, 'notice.department.write', 'department', departmentId)
    && Boolean(departmentId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const notices = (noticesQuery.data ?? []).filter((notice) => {
    if (canRegister || canDelete) {
      return notice.departmentId === departmentId
    }
    if (companyNoticePhase(notice, today) !== 'live') return false
    if (kind === 'company') return notice.departmentId === null
    return departmentId !== null && notice.departmentId === departmentId
  })

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setBody('')
    setError('')
  }

  const save = useMutation({
    mutationFn: async () => {
      if (isPreviewProfile(profile)) {
        throw new Error('화면 테스트 중에는 공지가 저장되지 않습니다. 종료 후 등록해 주세요.')
      }
      const nextTitle = title.trim()
      const nextBody = body.trim()
      if (!departmentId) throw new Error('소속 부서를 확인해 주세요.')
      if (!nextTitle || nextTitle.length > 80) throw new Error('제목은 1자에서 80자까지 입력해 주세요.')
      if (!nextBody || nextBody.length > 4000) throw new Error('내용은 1자에서 4000자까지 입력해 주세요.')
      return saveCompanyNotice({
        id: editingId,
        slot: 'department',
        departmentId,
        title: nextTitle,
        body: nextBody,
        startsOn: null,
        endsOn: null,
        published: true,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['company-notices', kind] })
      resetForm()
    },
    onError: (saveError) => {
      console.warn('[company-notices] 부서 공지 저장 실패', saveError)
      setError(saveError instanceof Error ? saveError.message : '공지를 저장하지 못했습니다.')
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isPreviewProfile(profile)) throw new Error('화면 테스트 중에는 삭제할 수 없습니다.')
      if (!canDelete) throw new Error('부서 공지 삭제 권한이 필요합니다.')
      return deleteCompanyNotice(id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['company-notices', kind] })
      resetForm()
    },
    onError: (removeError) => {
      console.warn('[company-notices] 부서 공지 삭제 실패', removeError)
      setError(removeError instanceof Error ? removeError.message : '공지를 삭제하지 못했습니다.')
    },
  })

  return (
    <section className="space-y-3" aria-label={kind === 'company' ? '회사 공지' : '부서 공지'}>
      {kind === 'department' && allowedDepartments.length > 1 && <label className="block max-w-sm text-sm">공지 대상 부서<Select value={departmentId ?? ''} onChange={event => { setSelectedDepartment(event.target.value); resetForm() }}>{allowedDepartments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</Select></label>}
      {canRegister ? (
        <form
          className="space-y-3 rounded-xl border border-border bg-card px-5 py-4"
          aria-label="부서 공지 등록"
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            save.mutate()
          }}
        >
          <div>
            <h2 className="text-sm font-semibold">{editingId ? '부서 공지 수정' : '부서 공지 등록'}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{departmentName} 공지 등록 권한을 지정받은 담당자가 이 부서 공지를 등록합니다.</p>
          </div>
          <label className="block text-xs text-muted-foreground">
            제목
            <Input className="mt-2" aria-label="부서 공지 제목" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            내용
            <Textarea className="mt-2 min-h-32" aria-label="부서 공지 내용" value={body} maxLength={4000} onChange={(event) => setBody(event.target.value)} />
          </label>
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending || remove.isPending}>{save.isPending ? '저장 중…' : editingId ? '수정 저장' : '공지 등록'}</Button>
            {editingId ? (
              <Button type="button" variant="outline" disabled={save.isPending || remove.isPending} onClick={resetForm}>취소</Button>
            ) : null}
          </div>
        </form>
      ) : null}
      {kind === 'department' && !departmentId ? (
        <p className="personal-page-notice">
          {hasPermission(profile, 'notice.department.write', 'department', departmentId)
            ? '소속 부서가 없어 부서 공지를 등록할 수 없습니다.'
            : '소속 부서가 없어 부서 공지를 볼 수 없습니다.'}
        </p>
      ) : noticesQuery.isPending || namedDepartment.isLoading ? (
        <p className="personal-page-notice" role="status">공지를 불러오는 중입니다.</p>
      ) : noticesQuery.isError ? (
        <p className="personal-page-notice is-error" role="alert">공지를 불러오지 못했습니다. 새로고침해 주세요.</p>
      ) : notices.length === 0 ? (
        <p className="personal-page-notice">등록된 공지가 없습니다.</p>
      ) : (
        notices.map((notice) => (
          <article key={notice.id} className="rounded-xl border border-border bg-card px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-base font-semibold">{notice.title}</h2>
              {canRegister || canDelete ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canRegister}
                    onClick={() => {
                      setEditingId(notice.id)
                      setTitle(notice.title)
                      setBody(notice.body)
                      setError('')
                    }}
                  >
                    수정
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={remove.isPending || !hasPermission(profile, 'notice.department.delete', 'department', departmentId)}
                    onClick={() => {
                      if (!window.confirm('이 부서 공지를 삭제할까요?')) return
                      remove.mutate(notice.id)
                    }}
                  >
                    삭제
                  </Button>
                </div>
              ) : null}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{notice.body}</p>
          </article>
        ))
      )}
    </section>
  )
}
