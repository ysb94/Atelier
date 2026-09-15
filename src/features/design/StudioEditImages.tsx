import { ImagePlus } from 'lucide-react'
import type { StudioAsset, StudioVersion } from '../../lib/design/styled-studio'

export function StudioEditImages({ assets, versions, parent, selected, busy, onChange, onUpload }: {
  assets: Record<string, StudioAsset>; versions: StudioVersion[]; parent: StudioVersion
  selected: Record<string, string> | undefined; busy: boolean
  onChange: (id: string, role: string | null) => void
  onUpload: (files: FileList | null) => void
}) {
  const ids = Object.keys(selected ?? {})
  const choices = Object.values(assets).slice().reverse()
  return <section className="cs-edit-picker" aria-label="이어가기 이미지 선택">
    <div className="cs-edit-picker-head"><div><strong>이번 요청에 사용할 이미지</strong><p>체크한 이미지만 전달합니다. 시안과 원본도 직접 골라 주세요.</p></div><span>{ids.length}/14장</span></div>
    <div className="cs-edit-picker-toolbar"><label className="cs-edit-add"><ImagePlus size={16} />사진 추가<input type="file" aria-label="이어가기 이미지 추가" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={(event) => { onUpload(event.target.files); event.target.value = '' }} /></label><span>추가한 사진도 체크해야 사용됩니다.</span></div>
    <div className="cs-edit-picker-grid">{choices.map((asset) => {
      const version = versions.find((item) => item.resultId === asset.id)
      const title = version?.title ?? asset.name
      const checked = ids.includes(asset.id)
      return <article key={asset.id} className={checked ? 'is-checked' : ''}>
        <label className="cs-edit-picker-photo"><input type="checkbox" checked={checked} disabled={busy || (!checked && ids.length >= 14)} aria-label={`${title} 사용`} onChange={(event) => onChange(asset.id, event.target.checked ? asset.id === parent.resultId ? '편집 대상' : '요청 참고' : null)} /><img loading="lazy" src={asset.data} alt="" /><span className="cs-edit-image-number">{checked ? `사진 ${ids.indexOf(asset.id) + 1}` : version ? '시안' : '사진'}</span><strong title={title}>{title}</strong></label>
        {checked ? <select aria-label={`${title} 참고 역할`} disabled={busy} value={selected?.[asset.id]} onChange={(event) => onChange(asset.id, event.target.value)}>{[...new Set(['요청 참고', '편집 대상', '제품 사진', '연출 레퍼런스', '원단 디테일', '끈·구조', '크기 비교', selected?.[asset.id] ?? '요청 참고'])].map((role) => <option key={role} value={role}>{role === '요청 참고' ? '요청에 맞게 참고' : role}</option>)}</select> : <small>체크해서 사용</small>}
      </article>
    })}</div>
    <p className="cs-edit-picker-hint">{ids.length ? `선택한 ${ids.length}장을 디렉터와 이미지 AI가 함께 봅니다. “사진 2의 원단처럼”처럼 번호로 요청할 수 있어요.` : '자동으로 포함되는 이미지는 없습니다. 사용할 사진을 한 장 이상 체크해 주세요.'}</p>
  </section>
}
