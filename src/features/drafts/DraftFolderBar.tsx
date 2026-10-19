import { useEffect, useState } from 'react'
import { Folder, FolderOpen, Plus } from 'lucide-react'
import { formatNumber } from '@/lib/utils'
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

  function openCreate() {
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
    <nav className="draft-folder-bar" aria-label="브랜드별 기획안 폴더">
      <div className="draft-folder-list">
        <button type="button" className="draft-folder-chip" aria-pressed={selectedIds.includes('all')} onClick={() => onSelect('all')}>전체 폴더</button>
        <button type="button" className="draft-folder-chip is-unassigned" aria-pressed={selectedIds.includes('unassigned')} onClick={() => onSelect('unassigned')}>폴더 미지정 <span className="draft-folder-count">{formatNumber(unassignedCount)}</span></button>
        {folders.map(folder => {
          const selected = selectedIds.includes(folder.id)
          const Icon = selected ? FolderOpen : Folder
          return (
            <button key={folder.id} type="button" className="draft-folder-chip" aria-pressed={selected} onClick={() => onSelect(folder.id)} title={`${folder.brandName ? `${folder.brandName} · ` : ''}${folder.label} 폴더 · 기획안 ${folder.total}건`}>
              <Icon size={13} aria-hidden="true" />
              {folder.brandName && <small>{folder.brandName}</small>}
              <span>{folder.label}</span><span className="draft-folder-count">{formatNumber(folder.total)}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className="draft-folder-add" aria-expanded={creating} aria-label="기획안 폴더 추가" onClick={() => (creating ? closeEditor() : openCreate())}>
        <Plus size={15} />
      </button>
      {creating ? (
        <form
          className="draft-folder-editor"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {!defaultBrandId ? (
            <label>
              <span>브랜드</span>
              <select value={brandId} disabled={busy} onChange={(event) => setBrandId(event.target.value)}>
                <option value="">브랜드 선택</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>폴더 이름</span>
            <input value={name} disabled={busy} placeholder="2026년 10월 26FW" onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit" disabled={busy}>{busy ? '저장 중' : '저장'}</button>
          <button type="button" disabled={busy} onClick={closeEditor}>취소</button>
          {error ? <p>{error}</p> : null}
        </form>
      ) : null}
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
    <div className="draft-folder-heading">
      {editing && folder.editable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <input
            aria-label="폴더 이름"
            value={name}
            disabled={busy}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={busy}>{busy ? '저장 중' : '저장'}</button>
          <button type="button" disabled={busy} onClick={() => void remove()}>삭제</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false)
              setName(folder.label)
              setError('')
            }}
          >
            취소
          </button>
        </form>
      ) : (
        <h2>
          {folder.brandName ? <small>{folder.brandName}</small> : null}
          {folder.editable ? (
            <button type="button" onClick={() => setEditing(true)}>
              {folder.label}
            </button>
          ) : (
            <span>{folder.label}</span>
          )}
        </h2>
      )}
      {error ? <p>{error}</p> : null}
    </div>
  )
}
