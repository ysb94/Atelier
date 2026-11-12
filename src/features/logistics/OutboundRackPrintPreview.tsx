import type { CSSProperties } from 'react'
import { useRenderWatch } from '@/lib/diagnostics'
import { WarehouseFourSlotPrintPreview } from './WarehouseFourSlotPrintPreview'
function LabelSheet({ labels, slotImages, boxImages }: { labels: (string | null)[]; slotImages?: ReadonlyMap<string, string>; boxImages?: ReadonlyMap<string, string> }) {
  return <div className={'outbound-rack-sheet' + (slotImages || boxImages ? ' outbound-slot-sheet' : '')}>{labels.map((label, index) => {
    if (boxImages) return <div className="outbound-rack-label warehouse-box-label" key={label ?? 'blank-' + index}>{label && <>
      <div className="warehouse-box-label-top">
        <img className="warehouse-box-qr" src={boxImages.get(label)} alt={label + ' 왼쪽 QR'} />
        <svg className="warehouse-box-arrow" viewBox="0 0 100 110" role="img" aria-label="위쪽 방향"><path d="M50 0 100 55H75V110H25V55H0Z" fill="currentColor" /></svg>
        <img className="warehouse-box-qr" src={boxImages.get(label)} alt={label + ' 오른쪽 QR'} />
      </div>
      <strong className="warehouse-box-code" style={{ '--box-code-length': label.length } as CSSProperties}>{label}</strong>
    </>}</div>
    if (slotImages) {
      const [rack, slot] = label?.split('_') ?? []
      return <div className="outbound-rack-label outbound-slot-label" key={label ?? 'blank-' + index}>{label && <>
        <img className="outbound-slot-qr" src={slotImages.get(label)} alt={label + ' 자리 QR'} />
        <div className="outbound-slot-text" style={{ '--slot-rack-length': rack.length } as CSSProperties}>
          <span className="outbound-slot-rack">{rack}</span>
          <strong className="outbound-slot-position">{slot}</strong>
        </div>
      </>}</div>
    }
    const parts = label?.split('-') ?? []
    return <div className="outbound-rack-label" key={label ?? 'blank-' + index}>{label &&
      <div className="outbound-rack-label-content">
        <strong className="outbound-rack-label-code" aria-label={label} style={{ '--rack-part-length': Math.max(1, ...parts.map((part) => part.length)), '--rack-number-height': `${84 / parts.length}cqh`, '--rack-separator-height': `${16 / Math.max(1, parts.length - 1)}cqh` } as CSSProperties}>
          {parts.map((part, partIndex) => <span className="outbound-rack-label-part" key={partIndex}>
            {partIndex > 0 && <span className="outbound-rack-label-separator" aria-hidden="true">/</span>}
            <span className="outbound-rack-label-number">{part}</span>
          </span>)}
        </strong>
      </div>
    }</div>
  })}</div>
}

export function OutboundRackPrintPreview({ labels, slotImages, boxImages, labelKind = 'rack', onClose }: { labels: string[]; slotImages?: ReadonlyMap<string, string>; boxImages?: ReadonlyMap<string, string>; labelKind?: 'rack' | 'box'; onClose: () => void }) {
  useRenderWatch('OutboundRackPrintPreview')
  const slotMode = slotImages !== undefined
  const boxMode = labelKind === 'box'
  const landscape = slotMode || boxMode
  const title = slotMode ? '고정 자리 · A4 4칸 QR 라벨' : boxMode ? '박스창고 자리번호 · A4 4칸 라벨' : '렉 번호 · A4 4칸 라벨'
  const layoutNote = boxMode
    ? '한 칸은 가로 148.5mm × 세로 105mm입니다. 좌우 QR은 같은 자리번호입니다. 가운데 화살표가 위를 향하도록 붙여 주세요.'
    : slotMode
      ? '한 칸은 가로 148.5mm × 세로 105mm입니다. 같은 4칸 용지를 가로로 사용합니다. 위쪽 약 55%에 QR과 자리번호를 모으고 아래쪽 약 45%는 비워 둡니다.'
      : '한 칸은 가로 105mm × 세로 148.5mm입니다. 왼쪽 ¼은 비우고 오른쪽 ¾의 중앙에 세로로 표시합니다.'
  return (
    <WarehouseFourSlotPrintPreview
      labels={labels}
      landscape={landscape}
      title={title}
      unit={landscape ? '자리' : '렉'}
      printLabel={slotMode ? '전체 고정 자리 라벨 인쇄' : boxMode ? '전체 박스창고 자리 라벨 인쇄' : '전체 렉 라벨 인쇄'}
      closeLabel={boxMode ? '박스창고 라벨 미리보기 닫기' : '렉 라벨 미리보기 닫기'}
      note={layoutNote + ' 마지막 장의 남는 칸은 인쇄하지 않습니다.'}
      renderSheet={page => <LabelSheet labels={page} slotImages={slotImages} boxImages={boxImages} />}
      onClose={onClose}
    />
  )
}
