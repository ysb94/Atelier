import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { hasPermission } from '@/lib/company/permissions'
import {
  COMPANY_NOTICE_SLOTS,
  companyNoticePhase,
  companyNoticePhaseLabel,
  type CompanyNotice,
  type CompanyNoticeSlotId,
} from '@/lib/company/company-notices'
import {
  deleteCompanyNotice,
  listCompanyNotices,
  saveCompanyNotice,
} from '@/lib/supabase/company-notices'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { koreaDateKey } from '@/features/settings/my-attendance'
import { useOpsDirectory } from './ops-directory'
import { OpsPanelFrame } from './OpsStat'

type Draft = {
  id: string | null
  slot: CompanyNoticeSlotId
  departmentId: string
  title: string
  body: string
  startsOn: string
  endsOn: string
  published: boolean
}

function emptyDraft(slot: CompanyNoticeSlotId): Draft {
  return {
    id: null,
    slot,
    departmentId: '',
    title: '',
    body: '',
    startsOn: '',
    endsOn: '',
    published: true,
  }
}

function draftFromNotice(notice: CompanyNotice): Draft {
  return {
    id: notice.id,
    slot: notice.slot,
    departmentId: notice.departmentId ?? '',
    title: notice.title,
    body: notice.body,
    startsOn: notice.startsOn ?? '',
    endsOn: notice.endsOn ?? '',
    published: notice.published,
  }
}

export function CompanyNoticesPanel() {
  useRenderWatch('CompanyNoticesPanel')
  const { profile } = useAuth()
  const directory = useOpsDirectory()
  const queryClient = useQueryClient()
  const today = koreaDateKey()
  const [slot, setSlot] = useState<CompanyNoticeSlotId>(COMPANY_NOTICE_SLOTS[0].id)
  const [draft, setDraft] = useState<Draft | null>(null)
  const canWriteNotice = (target: { slot: CompanyNoticeSlotId; departmentId: string | null }) => hasPermission(profile,
    target.slot === 'department' ? 'notice.department.write' : 'notice.company.write',
    target.slot === 'department' ? 'department' : 'company', target.departmentId || profile?.companyId)
  const canEdit = draft ? canWriteNotice(draft) : hasPermission(profile, slot === 'department' ? 'notice.department.write' : 'notice.company.write')
  const [formError, setFormError] = useState('')
  const noticesQuery = useQuery({
    queryKey: ['company-notices'],
    queryFn: () => listCompanyNotices(),
  })
  useEffect(() => {
    if (noticesQuery.error) {
      console.warn('[company-notices] 공지 목록 조회 실패', noticesQuery.error)
    }
  }, [noticesQuery.error])

  const notices = noticesQuery.data ?? emptyList<CompanyNotice>()
  const currentSlot = COMPANY_NOTICE_SLOTS.find((item) => item.id === slot) ?? COMPANY_NOTICE_SLOTS[0]
  const slotNotices = useMemo(
    () => notices.filter((notice) => notice.slot === slot),
    [notices, slot],
  )
  const liveCount = slotNotices.filter((notice) => companyNoticePhase(notice, today) === 'live').length

  const save = useMutation({
    mutationFn: saveCompanyNotice,
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['company-notices'] })
      setDraft((current) => (current ? { ...current, id } : current))
      setFormError('')
    },
    onError: (error) => {
      console.warn('[company-notices] 공지 저장 실패', error)
      setFormError(error instanceof Error ? error.message : '공지를 저장하지 못했습니다.')
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => {
      const item = notices.find(notice => notice.id === id)
      const code = item?.slot === 'department' ? 'notice.department.delete' : 'notice.company.delete'
      if (!item || !hasPermission(profile, code, item.slot === 'department' ? 'department' : 'company', item.departmentId ?? profile?.companyId)) throw new Error('공지 삭제 권한이 필요합니다.')
      return deleteCompanyNotice(id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['company-notices'] })
      setDraft(null)
      setFormError('')
    },
    onError: (error) => {
      console.warn('[company-notices] 공지 삭제 실패', error)
      setFormError(error instanceof Error ? error.message : '공지를 삭제하지 못했습니다.')
    },
  })
  const busy = save.isPending || remove.isPending

  function submit() {
    if (!draft || busy || !canEdit) return
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || title.length > 80) {
      setFormError('제목은 1자에서 80자까지 입력해 주세요.')
      return
    }
    if (!body || body.length > 4000) {
      setFormError('내용은 1자에서 4000자까지 입력해 주세요.')
      return
    }
    if (draft.slot === 'department' && !draft.departmentId) {
      setFormError('부서 공지는 대상 부서를 선택해 주세요.')
      return
    }
    if (draft.startsOn && draft.endsOn && draft.endsOn < draft.startsOn) {
      setFormError('종료일은 시작일보다 빠를 수 없습니다.')
      return
    }
    setFormError('')
    save.mutate({
      id: draft.id,
      slot: draft.slot,
      departmentId: draft.slot === 'company' ? null : draft.departmentId || null,
      title,
      body,
      startsOn: draft.startsOn || null,
      endsOn: draft.endsOn || null,
      published: draft.published,
    })
  }

  return (
    <OpsPanelFrame>
      <header>
        <h2 className="text-base font-semibold">회사 공지</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          게시 위치를 고르면 그 화면에 지금 나가는 공지가 보입니다. 기본 대상은 회사 전체입니다.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2" role="list" aria-label="공지 게시 위치">
        {COMPANY_NOTICE_SLOTS.map((item) => {
          const count = notices.filter(
            (notice) => notice.slot === item.id && companyNoticePhase(notice, today) === 'live',
          ).length
          const selected = item.id === slot
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setSlot(item.id)
                setDraft(null)
                setFormError('')
              }}
              className={`rounded-xl border px-4 py-3 text-left ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40'}`}
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
              <span className="mt-2 block text-xs">{count > 0 ? `게시 중 ${count}건` : '게시 중 없음'}</span>
            </button>
          )
        })}
      </div>
      <section className="rounded-2xl border border-border bg-card p-5" aria-label={currentSlot.label}>
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{currentSlot.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {noticesQuery.isPending ? '불러오는 중…' : `게시 중 ${liveCount}건`}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!canEdit || busy}
            onClick={() => {
              const next = emptyDraft(slot)
              if (slot === 'department') next.departmentId = directory.departments.find(department => hasPermission(profile,'notice.department.write','department',department.id))?.id ?? ''
              setDraft(next)
              setFormError('')
            }}
          >
            새 공지
          </Button>
        </header>
        {noticesQuery.error ? (
          <p className="text-sm text-danger" role="alert">공지를 불러오지 못했습니다. 새로고침해 주세요.</p>
        ) : slotNotices.length === 0 ? (
          <p className="text-sm text-muted-foreground">이 자리에는 등록된 공지가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {slotNotices.map((notice) => {
              const phase = companyNoticePhase(notice, today)
              const audience = notice.departmentId
                ? directory.departmentName(notice.departmentId)
                : '회사 전체'
              return (
                <li key={notice.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{notice.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {audience} · {companyNoticePhaseLabel(phase)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDraft(draftFromNotice(notice))
                      setFormError('')
                    }}
                  >
                    {canWriteNotice(notice) ? '수정' : '보기'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {draft ? (
        <form
          className="space-y-4 rounded-2xl border border-border bg-card p-5"
          aria-label="공지 편집"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <header className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{draft.id ? '공지 수정' : '새 공지'}</h3>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
              닫기
            </Button>
          </header>
          <label className="block text-xs text-muted-foreground">
            제목
            <Input
              className="mt-2"
              aria-label="공지 제목"
              value={draft.title}
              disabled={!canEdit || busy}
              maxLength={80}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            내용
            <Textarea
              className="mt-2 min-h-40"
              aria-label="공지 내용"
              value={draft.body}
              disabled={!canEdit || busy}
              maxLength={4000}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              시작일 · 비우면 바로
              <Input
                className="mt-2"
                type="date"
                aria-label="공지 시작일"
                value={draft.startsOn}
                disabled={!canEdit || busy}
                onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })}
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              종료일 · 비우면 계속
              <Input
                className="mt-2"
                type="date"
                aria-label="공지 종료일"
                value={draft.endsOn}
                disabled={!canEdit || busy}
                onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })}
              />
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">
            대상
            {draft.slot === 'company' ? (
              <p className="mt-2 text-sm text-foreground">회사 전체</p>
            ) : (
            <Select
              className="mt-2"
              aria-label="공지 대상"
              value={draft.departmentId}
              disabled={!canEdit || busy}
              onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}
            >
              {draft.slot === 'department' ? null : <option value="">회사 전체</option>}
              {directory.departments.filter(department => draft.slot !== 'department' || department.id === draft.departmentId || hasPermission(profile,'notice.department.write','department',department.id)).map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </Select>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.published}
              disabled={!canEdit || busy}
              onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
            />
            게시
          </label>
          {formError ? <p className="text-sm text-danger" role="alert">{formError}</p> : null}
          {!canEdit ? <p className="text-xs text-muted-foreground">이 공지 대상에 작성·수정 권한이 지정된 담당자만 저장할 수 있습니다.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!canEdit || busy}>{busy ? '저장 중…' : '저장'}</Button>
            {draft.id ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy || !hasPermission(profile, draft.slot === 'department' ? 'notice.department.delete' : 'notice.company.delete', draft.slot === 'department' ? 'department' : 'company', draft.departmentId || profile?.companyId)}
                onClick={() => {
                  if (!draft.id || !window.confirm('이 공지를 삭제할까요?')) return
                  remove.mutate(draft.id)
                }}
              >
                삭제
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </OpsPanelFrame>
  )
}
