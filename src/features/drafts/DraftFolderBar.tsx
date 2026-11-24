import { useEffect, useRef, useState } from 'react'
import { Folder, FolderOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { cn, formatNumber } from '@/lib/utils'
import './draft-board.css'

export type DraftFolderItem = {
  id: string
  label: string
  brandId: string
  brandName?: string
  name: string
  total: number
  editable: boolean
}

type FolderDraft = { brandId: string; name: string }

const folderChipClass = 'h-7 gap-1 rounded-full px-1.5 text-[13px]! font-medium! leading-none! shadow-none focus-visible:ring-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50'
const folderScopeClass = 'text-muted-foreground aria-pressed:border-foreground/30 aria-pressed:bg-muted aria-pressed:text-foreground'

export function DraftFolderBar({
  folders,
  brands,
  defaultBrandId,
  selectedIds,
  unassignedCount,
  onSelect,
  onCreate,
}: {
  folders: DraftFolderItem[]
  brands: { id: string; name: string }[]
  defaultBrandId?: string
  selectedIds: string[]
  unassignedCount: number
  onSelect: (id: string) => void
  onCreate: (value: FolderDraft) => Promise<void>
}) {
  const [creating, setCreating] = useState(false)
  const [brandId, setBrandId] = useState(defaultBrandId ?? brands[0]?.id ?? '')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const folderScroll = useRef<HTMLDivElement>(null)

  function openCreate() {
    if (folderScroll.current) folderScroll.current.scrollLeft = 0
    setCreating(true)
    setBrandId(defaultBrandId ?? brands[0]?.id ?? '')
    setName('')
    setError('')
  }

  function closeEditor() {
    if (busy) return
    setCreating(false)
    setError('')
  }

  async function save() {
    const nextName = name.trim()
    if (!nextName) {
      setError('폴더 이름을 입력하세요.')
      return
    }
    if (!brandId) {
      setError('브랜드를 고르세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onCreate({ brandId, name: nextName })
      setCreating(false)
    } catch (err) {
      console.warn('[drafts] 기획안 폴더 저장 실패', err)
      setError(err instanceof Error ? err.message : '폴더를 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <nav className="min-w-0 flex-1" aria-label="브랜드별 기획안 폴더">
      <div className="flex min-w-0 items-start gap-1.5">
        <Button type="button" variant="outline" size="sm" className={cn(folderChipClass, folderScopeClass)} aria-pressed={selectedIds.includes('all')} onClick={() => onSelect('all')}>
          전체 폴더
        </Button>
        <Button type="button" variant="outline" size="sm" className={cn(folderChipClass, folderScopeClass)} aria-pressed={selectedIds.includes('unassigned')} onClick={() => onSelect('unassigned')}>
          폴더 미지정 <span className="tabular-nums text-danger">{formatNumber(unassignedCount)}</span>
        </Button>
        <Button type="button" variant="outline" size="icon" className="size-7 shrink-0 text-muted-foreground shadow-none" aria-expanded={creating} aria-label="기획안 폴더 추가" onClick={() => (creating ? closeEditor() : openCreate())}>
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
        <div ref={folderScroll} className="flex min-w-0 flex-1 items-start gap-1.5 overflow-x-auto [scrollbar-width:thin]">
          {creating && (
            <form className={cn('draft-folder-editor min-w-0 max-w-full shrink-0', defaultBrandId ? 'w-60' : 'w-80')} onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}>
              {!defaultBrandId && (
                <Select aria-label="브랜드" className="max-w-full shadow-none" value={brandId} disabled={busy} onChange={(event) => setBrandId(event.target.value)}>
                  <option value="">브랜드 선택</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>{brand.name}</option>
                  ))}
                </Select>
              )}
              <Input aria-label="폴더 이름" placeholder="폴더 이름" className="min-w-16 flex-1 shadow-none"
                autoFocus value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
              <Button type="submit" size="sm" disabled={busy}>{busy ? '저장 중' : '저장'}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={closeEditor}>취소</Button>
              {error && <p role="alert">{error}</p>}
            </form>
          )}
          {folders.map(folder => {
            const selected = selectedIds.includes(folder.id)
            const Icon = selected ? FolderOpen : Folder
            return (
              <Button
                key={folder.id}
                type="button"
                variant="outline"
                size="sm"
                className={cn(folderChipClass, 'border-warning/25 bg-warning/5 text-muted-foreground hover:border-warning/50 hover:bg-warning/10 aria-pressed:border-warning/55 aria-pressed:bg-warning/15 aria-pressed:text-foreground')}
                aria-pressed={selected}
                onClick={() => onSelect(folder.id)}
                title={`${folder.brandName ? `${folder.brandName} · ` : ''}${folder.label} 폴더 · 기획안 ${folder.total}건`}
              >
                <Icon className="size-3" aria-hidden="true" />
                {folder.brandName && <span>{folder.brandName}</span>}
                <span>{folder.label}</span>
                <span className="tabular-nums text-danger">{formatNumber(folder.total)}</span>
              </Button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

export function DraftFolderHeading({
  folder,
  onUpdate,
  onDelete,
}: {
  folder: DraftFolderItem
  onUpdate: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.label)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setEditing(false)
    setName(folder.label)
    setError('')
  }, [folder.id, folder.label])

  async function save() {
    const nextName = name.trim()
    if (!nextName) {
      setError('폴더 이름을 입력하세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onUpdate(folder.id, nextName)
      setEditing(false)
    } catch (err) {
      console.warn('[drafts] 기획안 폴더 저장 실패', err)
      setError(err instanceof Error ? err.message : '폴더를 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await onDelete(folder.id)
    } catch (err) {
      console.warn('[drafts] 기획안 폴더 삭제 실패', err)
      setError(err instanceof Error ? err.message : '폴더를 삭제하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <div className="min-w-0">
      {editing && folder.editable ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Input
            aria-label="폴더 이름"
            className="h-7 w-40 max-w-full px-2 text-xs"
            value={name}
            disabled={busy}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" size="sm" className="h-7 px-2" disabled={busy}>{busy ? '저장 중' : '저장'}</Button>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2" disabled={busy} onClick={() => void remove()}>삭제</Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={busy}
            onClick={() => {
              setEditing(false)
              setName(folder.label)
              setError('')
            }}
          >
            취소
          </Button>
        </form>
      ) : (
        <h2 className="flex min-h-7 flex-wrap items-center gap-x-1.5 break-words text-xs font-semibold text-foreground">
          {folder.brandName && <span className="font-medium text-muted-foreground">{folder.brandName}</span>}
          {folder.editable ? (
            <button type="button" className="min-w-0 text-left hover:underline" onClick={() => setEditing(true)}>
              {folder.label}
            </button>
          ) : (
            <span>{folder.label}</span>
          )}
        </h2>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}
