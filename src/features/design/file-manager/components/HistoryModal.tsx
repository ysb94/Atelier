import { useMemo, useState } from 'react'
import type { HistoryLogEntry } from '../types'
import { formatLogSentenceParts, formatLogTimestamp } from '../file-manager-utils'

export function HistoryModal({ open, entries, loading, more, onMore, onClose }: { open: boolean; entries: HistoryLogEntry[]; loading: boolean; more: boolean; onMore: () => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => entries.filter((entry) => JSON.stringify(entry).toLowerCase().includes(query.toLowerCase())), [entries, query])
  if (!open) return null
  return <div className="history-modal open" role="dialog" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="history-panel">
    <header className="history-header"><h2>히스토리</h2><input className="history-search" type="search" placeholder="검색" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="toolbar-button" onClick={onClose}>닫기</button></header>
    <p className="history-hint">모든 작업 기록을 영구 보존합니다. 이전 달 기록은 아래 더 보기로 불러올 수 있습니다.</p>
    <div className="history-list">{rows.length ? rows.map((entry, index) => { const sentence = formatLogSentenceParts(entry); return <div className="history-row" key={`${entry.ts}-${index}`}><span className="history-row-icon">▣</span><span className="history-row-text">{sentence.parts.map((part, i) => part.kind === 'quote' ? <em key={i}>"{part.value}"</em> : <span key={i}>{part.value}</span>)}</span><time className="history-row-time">{formatLogTimestamp(entry.ts)}</time></div> }) : <div className="history-empty">{loading ? '불러오는 중...' : '표시할 기록이 없습니다.'}</div>}</div>
    <footer className="history-footer"><button className="toolbar-button" disabled={loading || !more} onClick={onMore}>{more ? loading ? '불러오는 중...' : '더 보기' : '더 이상 없음'}</button></footer>
  </div></div>
}
