import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronRight, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildFolderForest, folderPath } from '@/lib/codes/outbound-folder'
import { compactOutboundPartnerKey } from '@/lib/codes/outbound-partner'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'

type Props = {
  targets: readonly CodeUsageTarget[]
  folders: readonly CodeUsageTargetFolder[]
}

export function OutboundPartnerRegistrationPreview(props: Props) {
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

function RegistrationDialog({ targets, folders, onClose }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const [mode, setMode] = useState<'company' | 'site' | null>(null)
  const [name, setName] = useState('')
  const [firstSiteName, setFirstSiteName] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(false)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    heading.current?.focus()
  }, [mode])

  const companies = useMemo(() => {
    const byLocation = new Map<string, CodeUsageTarget>()
    for (const target of targets) {
      if (!target.active || !target.groupId) continue
      const key = `${target.groupId}:${target.folderId ?? ''}`
      if (!byLocation.has(key)) byLocation.set(key, target)
    }
    return [...byLocation.values()].sort((a, b) => a.groupName.localeCompare(b.groupName, 'ko'))
  }, [targets])
  const company = companies.find((item) => item.id === companyId)
  const companyQuery = compactOutboundPartnerKey(query)
  const matches = companies.filter((item) => compactOutboundPartnerKey(item.groupName).includes(companyQuery))
  const path = folderPath(folders, mode === 'site' ? company?.folderId : folderId)
  const rootFolders = useMemo(() => buildFolderForest(folders), [folders])
  const folderOptions = folderId
    ? folders.filter((folder) => folder.parentId === folderId)
    : rootFolders
  const location = path.map((folder) => folder.name).join(' › ') || '미분류'
  const trimmedName = name.trim()
  const firstSite = firstSiteName.trim()
  const ready = Boolean(trimmedName && (mode === 'company' || company))
  const summary = mode === 'company'
    ? firstSite
      ? `${location}에 ‘${trimmedName}’ 업체와 첫 지점 ‘${firstSite}’을 함께 추가합니다.`
      : `${location}에 ‘${trimmedName}’ 업체를 추가합니다.`
    : `추가할 지점은 ${company?.groupName}의 ${trimmedName}입니다.`
  const submitLabel = mode === 'company'
    ? firstSite ? '업체와 지점 등록하기' : '업체 등록하기'
    : '지점 등록하기'

  function chooseMode(next: typeof mode) {
    setMode(next)
    setName('')
    setFirstSiteName('')
    setFolderId(null)
    setQuery('')
    setCompanyId(null)
    setReviewed(false)
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border p-5 sm:px-7">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">출고업체 등록 미리보기</p>
          <h2 ref={heading} id={titleId} tabIndex={-1} className="text-xl font-bold outline-none sm:text-2xl">
            {mode === 'company' ? '어떤 업체를 추가하나요?' : mode === 'site' ? '어느 업체에 지점을 추가하나요?' : '무엇을 추가하시나요?'}
          </h2>
        </div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="등록 창 닫기" onClick={onClose}>
          <X className="size-5" />
        </Button>
      </div>

      {mode === null ? (
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
        <form className="space-y-5 p-5 sm:p-7" onSubmit={(event) => { event.preventDefault(); if (ready) setReviewed(true) }}>
          {mode === 'site' && (
            <div className="space-y-2">
              {company ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <div>
                    <p className="font-semibold">{company.groupName}</p>
                    <p className="text-sm text-muted-foreground">{location}</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => { setCompanyId(null); setReviewed(false) }}>다시 선택</Button>
                </div>
              ) : (
                <>
                  <label className="block space-y-2 font-medium">
                    <span>업체 이름</span>
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 text-base" placeholder="예: 롯데면세점" />
                  </label>
                  <div className="grid gap-2">
                    {matches.slice(0, 5).map((item) => (
                      <Button key={item.id} type="button" variant="outline" className="h-auto min-h-12 justify-between gap-3 text-left" onClick={() => setCompanyId(item.id)}>
                        <span className="break-all font-semibold">{item.groupName}</span>
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

          {(mode === 'company' || company) && (
            <label className="block space-y-2 font-medium">
              <span>{mode === 'company' ? '업체명' : '지점명'}</span>
              <Input className="h-12 text-base" value={name} placeholder={mode === 'company' ? '예: 롯데면세점' : '예: 김포공항점'} onChange={(event) => { setName(event.target.value); setReviewed(false) }} />
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
                  setReviewed(false)
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
                  <Button type="button" variant="outline" size="sm" onClick={() => { setFolderId(path.at(-2)?.id ?? null); setReviewed(false) }}>한 단계 위로</Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {folderOptions.map((folder) => (
                  <Button key={folder.id} type="button" variant="outline" onClick={() => { setFolderId(folder.id); setReviewed(false) }}>
                    {folder.name}
                  </Button>
                ))}
              </div>
            </fieldset>
          )}

          {ready && <p className="rounded-lg bg-muted px-4 py-3 font-medium">{summary}</p>}
          {reviewed && <p role="status" className="text-sm text-muted-foreground">입력 내용을 확인했습니다. 미리보기에서는 저장되지 않습니다.</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => chooseMode(null)}>이전</Button>
            <Button type="submit" size="lg" className="flex-1 text-base" disabled={!ready}>
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  )
}
