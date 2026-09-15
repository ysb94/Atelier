import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StudioAsset } from '../../lib/design/styled-studio'

export function StudioImagePreview({ asset, title, disabled, selected, onSelect }: {
  asset: StudioAsset; title: string; disabled: boolean; selected: boolean; onSelect: () => void
}) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])
  return <>
    <button className={selected ? 'is-selected' : ''} disabled={disabled} aria-label={`${title} 크게 보기`} onClick={() => { onSelect(); setZoom(false); setOpen(true) }}><img src={asset.data} alt={`${title} 결과`} /><strong>{title} · 크게 보기</strong></button>
    {open && createPortal(<dialog className="cs-image-dialog" ref={dialog} aria-label={`${title} 크게 보기`} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div className="cs-image-dialog-bar"><strong>{title}</strong><button onClick={() => setZoom((value) => !value)}>{zoom ? '화면에 맞추기' : '원본 크기'}</button><a href={asset.data} download={asset.name}>다운로드</a><button autoFocus onClick={() => setOpen(false)} aria-label="크게 보기 닫기">닫기 ×</button></div>
      <div className={'cs-image-dialog-canvas' + (zoom ? ' is-zoomed' : '')}><img src={asset.data} alt={title} /></div>
    </dialog>, document.body)}
  </>
}
