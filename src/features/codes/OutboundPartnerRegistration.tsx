import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronRight, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildFolderForest, folderPath } from '@/lib/codes/outbound-folder'
import { outboundChannelFromFolderPath } from '@/lib/codes/outbound-partner-browser'
import { compactOutboundPartnerKey, outboundPartnerRegisteredName } from '@/lib/codes/outbound-partner'
import { CodeUsageTargetStoreError, registerOutboundPartner, type OutboundPartnerRegistrationInput } from '@/lib/supabase/code-usage-targets'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  brandId: string
  targets: readonly CodeUsageTarget[]
  folders: readonly CodeUsageTargetFolder[]
  onSaved: () => Promise<void>
}

const FIRST_SITE_ACTIONS = [
  { id: 'name-existing', label: '기존 출고처에 지점명 붙이기', description: '지금까지 출고해 온 곳과 같은 곳입니다.' },
  { id: 'add-separate', label: '별도 지점 추가하기', description: '기존 출고처와 다른 곳입니다.' },
] as const

function registrationCompanyName(target: CodeUsageTarget) {
  return target.groupName || outboundPartnerRegisteredName(target)
}

export function OutboundPartnerRegistration(props: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" size="lg" className="w-full text-base sm:w-auto" onClick={() => setOpen(true)}>
        <Plus className="size-5" />
        새 업체 또는 지점 등록
      </Button>
      {open && <RegistrationDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

function RegistrationDialog({ brandId, targets, folders, onSaved, onClose }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const [mode, setMode] = useState<'company' | 'site' | null>(null)
  const [name, setName] = useState('')
  const [firstSiteName, setFirstSiteName] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [companySelection, setCompanySelection] = useState<{ id: string; updatedAt: string; firstSite: boolean } | null>(null)
  const [firstSiteAction, setFirstSiteAction] = useState<(typeof FIRST_SITE_ACTIONS)[number]['id'] | null>(null)
  const save = useMutation({
    mutationFn: (input: OutboundPartnerRegistrationInput) => registerOutboundPartner(brandId, input),
    onSuccess: onSaved,
    onError: async (error) => {
      if (error instanceof CodeUsageTargetStoreError && error.code === 'conflict') {
        setCompanySelection(null)
        setFirstSiteAction(null)
        setName('')
        await onSaved()
      }
    },
    retry: false,
  })

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    heading.current?.focus()
  }, [mode, save.isSuccess])

  const companies = useMemo(() => {
    const byLocation = new Map<string, CodeUsageTarget>()
    for (const target of targets) {
      if (!target.active) continue
      const key = target.groupId ? `${target.groupId}:${target.folderId ?? ''}` : target.id
      if (!byLocation.has(key)) byLocation.set(key, target)
    }
    return [...byLocation.values()].sort((a, b) => registrationCompanyName(a).localeCompare(registrationCompanyName(b), 'ko'))
  }, [targets])
  const company = targets.find((item) => item.id === companySelection?.id)
  const companyName = company ? registrationCompanyName(company) : ''
  const isFirstSite = company && companySelection?.firstSite
  const canNameSite = Boolean(company && (!isFirstSite || firstSiteAction))
  const companyQuery = compactOutboundPartnerKey(query)
  const matches = companies.filter((item) => compactOutboundPartnerKey(registrationCompanyName(item)).includes(companyQuery))
  const path = folderPath(folders, mode === 'site' ? company?.folderId : folderId)
  const rootFolders = useMemo(() => buildFolderForest(folders), [folders])
  const folderOptions = folderId
    ? folders.filter((folder) => folder.parentId === folderId)
    : rootFolders
  const location = path.map((folder) => folder.name).join(' › ') || '미분류'
  const trimmedName = name.trim()
  const firstSite = firstSiteName.trim()
  const ready = Boolean(trimmedName && (mode === 'company' || canNameSite))
  const renameExistingSite = isFirstSite && firstSiteAction === 'name-existing'
  const summary = mode === 'company'
    ? firstSite
      ? `${location}에 ‘${trimmedName}’ 업체와 첫 지점 ‘${firstSite}’을 함께 추가합니다.`
      : `${location}에 ‘${trimmedName}’ 업체를 추가합니다.`
    : renameExistingSite
      ? `기존 ${companyName} 출고처에 ‘${trimmedName}’ 지점명을 붙입니다.`
      : `추가할 지점은 ${companyName}의 ${trimmedName}입니다.`
  const submitLabel = mode === 'company'
    ? firstSite ? '업체와 지점 등록하기' : '업체 등록하기'
    : renameExistingSite ? '지점명 붙이기' : '지점 등록하기'

  function chooseCompany(selected: CodeUsageTarget | null) {
    setCompanySelection(selected ? {
      id: selected.id,
      updatedAt: selected.updatedAt,
      firstSite: !targets.some((target) =>
        (target.id === selected.id || (selected.groupId && target.groupId === selected.groupId && target.folderId === selected.folderId)) && target.siteName.trim(),
      ),
    } : null)
    setFirstSiteAction(null)
    setName('')
    save.reset()
  }

  function chooseMode(next: typeof mode) {
    setMode(next)
    setFirstSiteName('')
    setFolderId(null)
    setQuery('')
    chooseCompany(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || save.isPending || save.isSuccess) return
    if (mode === 'company') {
      save.mutate({
        action: 'new-company',
        companyName: trimmedName,
        siteName: firstSite,
        folderId,
        channelType: outboundChannelFromFolderPath(folders, folderId),
      })
    } else if (company && companySelection) {
      save.mutate({
        action: renameExistingSite ? 'name-existing' : 'add-site',
        existingId: company.id,
        expectedUpdatedAt: companySelection.updatedAt,
        siteName: trimmedName,
      })
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!save.isPending) onClose() }}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border p-5 sm:px-7">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">출고업체 등록</p>
          <h2 ref={heading} id={titleId} tabIndex={-1} className="text-xl font-bold outline-none sm:text-2xl">
            {save.isSuccess ? '등록이 완료되었습니다' : mode === 'company' ? '어떤 업체를 추가하나요?' : mode === 'site' ? '어느 업체에 지점을 추가하나요?' : '무엇을 추가하시나요?'}
          </h2>
        </div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="등록 창 닫기" disabled={save.isPending} onClick={onClose}>
          <X className="size-5" />
        </Button>
      </div>

      {save.isSuccess ? (
        <div className="space-y-5 p-5 sm:p-7">
          <p role="status">출고업체 목록에서 등록한 내용을 확인할 수 있어요.</p>
          <Button type="button" size="lg" className="w-full" onClick={onClose}>확인</Button>
        </div>
      ) : mode === null ? (
        <div className="space-y-3 p-5 sm:p-7">
          <Button type="button" variant="outline" className="h-auto min-h-20 w-full justify-between px-4 py-3 text-left" onClick={() => chooseMode('company')}>
            <span>
              <span className="block text-lg font-semibold">새 업체 등록</span>
              <span className="block text-sm text-muted-foreground">업체만 등록하거나 첫 지점도 함께 등록할 수 있습니다.</span>
            </span>
            <ChevronRight className="size-5 shrink-0" />
          </Button>
          <Button type="button" variant="outline" className="h-auto min-h-20 w-full justify-between px-4 py-3 text-left" onClick={() => chooseMode('site')}>
            <span><span className="block text-lg font-semibold">기존 업체에 지점 추가</span><span className="block text-sm text-muted-foreground">등록된 업체에 새 지점을 추가합니다.</span></span>
            <ChevronRight className="size-5 shrink-0" />
          </Button>
        </div>
      ) : (
        <form className="p-5 sm:p-7" onSubmit={submit}>
          <fieldset disabled={save.isPending} className="space-y-5">
            {mode === 'site' && (
              <div className="space-y-2">
                {company ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <div>
                      <p className="font-semibold">{companyName}</p>
                      <p className="text-sm text-muted-foreground">{location}</p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => chooseCompany(null)}>다시 선택</Button>
                  </div>
                ) : (
                  <>
                    <label className="block space-y-2 font-medium">
                      <span>업체 이름</span>
                      <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 text-base" placeholder="예: 롯데면세점" />
                    </label>
                    <div className="grid gap-2">
                      {matches.slice(0, 5).map((item) => (
                        <Button key={item.id} type="button" variant="outline" className="h-auto min-h-12 justify-between gap-3 text-left" onClick={() => chooseCompany(item)}>
                          <span className="break-all font-semibold">{registrationCompanyName(item)}</span>
                          <span className="text-right text-xs text-muted-foreground">{folderPath(folders, item.folderId).map((folder) => folder.name).join(' › ') || '미분류'}</span>
                        </Button>
                      ))}
                      {matches.length === 0 && <p className="text-sm text-muted-foreground">일치하는 업체가 없습니다.</p>}
                      {matches.length > 5 && <p className="text-sm text-muted-foreground">업체 이름을 더 입력해 주세요.</p>}
                    </div>
                  </>
                )}
              </div>
            )}

            {isFirstSite && (
              <fieldset className="space-y-2">
                <legend className="font-medium">기존에 출고하던 곳에 지점명을 붙이는 건가요?</legend>
                {FIRST_SITE_ACTIONS.map((option) => (
                  <label key={option.id} className={cn(
                    'flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-2 focus-within:ring-2 focus-within:ring-ring/40',
                    firstSiteAction === option.id && 'border-primary bg-primary/5',
                  )}>
                    <input
                      type="radio"
                      name={`${titleId}-first-site`}
                      checked={firstSiteAction === option.id}
                      className="size-5 shrink-0 accent-primary"
                      onChange={() => {
                        setFirstSiteAction(option.id)
                        save.reset()
                      }}
                    />
                    <span>
                      <span className="block font-semibold">{option.label}</span>
                      <span className="block text-sm text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {(mode === 'company' || canNameSite) && (
              <label className="block space-y-2 font-medium">
                <span>{mode === 'company' ? '업체명' : '지점명'}</span>
                <Input className="h-12 text-base" value={name} placeholder={mode === 'company' ? '예: 롯데면세점' : '예: 김포공항점'} onChange={(event) => { setName(event.target.value); save.reset() }} />
              </label>
            )}

            {mode === 'company' && (
              <label className="block space-y-2 font-medium">
                <span>첫 지점명 <span className="text-sm text-muted-foreground">선택</span></span>
                <Input
                  className="h-12 text-base"
                  value={firstSiteName}
                  placeholder="예: 인천공항점"
                  onChange={(event) => {
                    setFirstSiteName(event.target.value)
                    save.reset()
                  }}
                />
              </label>
            )}

            {mode === 'company' && folders.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="font-medium">등록 위치 <span className="text-sm text-muted-foreground">선택</span></legend>
                {folderId && (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>{location}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => { setFolderId(path.at(-2)?.id ?? null); save.reset() }}>한 단계 위로</Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {folderOptions.map((folder) => (
                    <Button key={folder.id} type="button" variant="outline" onClick={() => { setFolderId(folder.id); save.reset() }}>
                      {folder.name}
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}

            {ready && (
              <div className="space-y-1 rounded-lg bg-muted px-4 py-3">
                <p className="font-medium">{summary}</p>
                {isFirstSite && (
                  <p className="text-sm text-muted-foreground">
                    {renameExistingSite ? '기존 출고 이력은 이 지점에서 이어집니다.' : '기존 출고 이력은 기존 출고처에 남습니다.'}
                  </p>
                )}
              </div>
            )}
            {save.isError && <p role="alert" className="text-sm text-danger">{save.error.message}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => chooseMode(null)}>이전</Button>
              <Button type="submit" size="lg" className="flex-1 text-base" disabled={!ready}>
                {save.isPending ? '등록 중…' : submitLabel}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </dialog>
  )
}
