import { ArrowUp, ImagePlus } from 'lucide-react'
import { StudioImagePreview } from './StudioImagePreview'
import { photoLabel, photoNote, REQUEST_ATTACH_LIMIT } from '../../lib/design/studio-library'
import type { StudioState } from '../../lib/design/styled-studio'

export function StudioLibrary({ state, selected, busy, editingId, onSelect, onMention, onUpload, onEdit, filter, onFilter, compact = false, onExpand }: {
  state: StudioState; selected: Record<string, string> | undefined; busy: boolean; editingId?: string | null
  onSelect: (id: string, checked: boolean) => void; onMention: (name: string) => void
  onUpload: (files: FileList | null) => void; onEdit: (id: string) => void
  filter: 'all' | 'attached'; onFilter: (filter: 'all' | 'attached') => void
  compact?: boolean; onExpand?: () => void
}) {
  const selectedIds = selected ?? {}
  const photos = Object.values(state.assets).slice().sort((a, b) => (b.photoNo ?? 0) - (a.photoNo ?? 0))
  const visible = filter === 'attached' ? photos.filter(asset => selectedIds[asset.id]) : photos
  return <div className={'cs-library' + (compact ? ' cs-library-compact' : '')} aria-label={compact ? '작업 사진 북마크' : '작업 사진 목록'}>
    <div className="cs-library-toolbar">
      <div className="cs-section-head"><div><span className="cs-eyebrow">PHOTOS</span><h2>작업 사진</h2></div><span>{Object.keys(selectedIds).length}/{REQUEST_ATTACH_LIMIT} 첨부</span></div>
      <div className="cs-library-filters" role="group" aria-label="사진 목록 필터">
        <button type="button" className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => onFilter('all')}>전체 사진</button>
        <button type="button" className={filter === 'attached' ? 'is-active' : ''} aria-pressed={filter === 'attached'} onClick={() => onFilter('attached')}>{compact ? '첨부한 사진' : '이번 요청에 첨부한 사진'}</button>
      </div>
      <label className="cs-upload cs-upload-add"><ImagePlus size={16} /><strong>사진 추가</strong><small>여러 장 · JPG, PNG, WEBP</small><input aria-label="사진 추가" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { onUpload(e.target.files); e.target.value = '' }} /></label>
      {compact && <button type="button" className="cs-library-expand" onClick={onExpand} aria-label="작업 사진 목록 펼쳐 보기"><ArrowUp size={14} />펼치기</button>}
    </div>
    <p className="cs-help">체크한 사진만 보냅니다. 사진 번호를 누르면 요청창 커서 위치에 들어갑니다. 자동으로 첨부하지 않습니다.</p>
    <div className="cs-library-grid">{visible.map(asset => <article key={asset.id} title={photoNote(asset) || asset.name} className={'cs-library-photo' + (selectedIds[asset.id] ? ' is-checked' : '') + (editingId === asset.id ? ' is-editing' : '')}>
      <div className="cs-library-meta">
        <label className="cs-library-check"><input type="checkbox" aria-label={`${photoLabel(asset)} 첨부`} checked={!!selectedIds[asset.id]} disabled={busy || (!selectedIds[asset.id] && Object.keys(selectedIds).length >= REQUEST_ATTACH_LIMIT)} onChange={e => onSelect(asset.id, e.target.checked)} /></label>
        <button type="button" className="cs-photo-no" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => onMention(photoLabel(asset))}>{photoLabel(asset)}</button>
      </div>
      <StudioImagePreview compact asset={asset} title={photoLabel(asset)} disabled={busy} selected={false} onSelect={() => {}} />
      <small className="cs-library-filename" title={asset.name}>{photoNote(asset) || asset.name}</small>
      <button type="button" className="cs-info-open" disabled={busy} aria-pressed={editingId === asset.id} onClick={() => onEdit(asset.id)}>정보 수정</button>
    </article>)}</div>
    {filter === 'attached' && !visible.length && <p className="cs-library-empty">{compact ? '전체 사진에서 사용할 사진을 체크하세요.' : '첨부한 사진이 없습니다. 전체 사진에서 체크하면 여기에 모입니다.'}</p>}
  </div>
}
