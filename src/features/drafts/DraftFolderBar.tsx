import { Folder, FolderOpen, Plus } from 'lucide-react'
import { formatNumber } from '@/lib/utils'
import './draft-board.css'

export type DraftFolderItem = { id: string; label: string; brandName?: string; total: number }

export function DraftFolderBar({ folders, selectedIds, unassignedCount, onSelect }: {
  folders: DraftFolderItem[]; selectedIds: string[]; unassignedCount: number
  onSelect: (id: string) => void
}) {
  return <nav className="draft-folder-bar" aria-label="브랜드별 기획안 폴더">
    <div className="draft-folder-list">
      <button type="button" className="draft-folder-chip" aria-pressed={selectedIds.includes('all')} onClick={() => onSelect('all')}>전체 폴더</button>
      {folders.map(folder => {
        const selected = selectedIds.includes(folder.id)
        const Icon = selected ? FolderOpen : Folder
        return <button key={folder.id} type="button" className="draft-folder-chip" aria-pressed={selected} onClick={() => onSelect(folder.id)} title={`${folder.brandName ? `${folder.brandName} · ` : ''}${folder.label} 폴더 · 기획안 ${folder.total}건`}>
          <Icon size={13} aria-hidden="true" />
          {folder.brandName && <small>{folder.brandName}</small>}
          <span>{folder.label}</span><span className="draft-folder-count">{formatNumber(folder.total)}</span>
        </button>
      })}
      <button type="button" className="draft-folder-chip is-unassigned" aria-pressed={selectedIds.includes('unassigned')} onClick={() => onSelect('unassigned')}>폴더 미지정 <span className="draft-folder-count">{formatNumber(unassignedCount)}</span></button>
    </div>
    <button type="button" className="draft-folder-add" disabled aria-label="기획안 폴더 추가" title="폴더 추가 기능 준비 중"><Plus size={15} /></button>
  </nav>
}
