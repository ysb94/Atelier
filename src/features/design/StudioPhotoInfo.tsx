import { X } from 'lucide-react'
import { photoLabel, productDescription } from '../../lib/design/studio-library'
import type { StudioAsset, StudioProduct, StudioState } from '../../lib/design/styled-studio'

function emptyProduct(index: number): StudioProduct {
  return { id: crypto.randomUUID(), name: `제품 ${index}`, width: '', height: '', depth: '', unit: 'cm', material: '', basis: '', state: '' }
}

export function StudioPhotoInfo({ state, assetId, busy, onState, onClose }: {
  state: StudioState; assetId: string; busy: boolean
  onState: (update: (prev: StudioState) => StudioState) => void
  onClose: () => void
}) {
  const asset = state.assets[assetId]
  const products = Object.values(state.products ?? {})
  if (!asset) return null
  function editAsset(patch: Partial<StudioAsset>) {
    onState(prev => ({ ...prev, assets: { ...prev.assets, [assetId]: { ...prev.assets[assetId], ...patch } } }))
  }
  function editProduct(id: string, patch: Partial<StudioProduct>) {
    onState(prev => ({ ...prev, products: { ...prev.products, [id]: { ...prev.products![id], ...patch } } }))
  }
  function toggleProduct(id: string, checked: boolean) {
    onState(prev => {
      const current = prev.assets[assetId]
      const productIds = checked ? [...new Set([...(current.productIds ?? []), id])] : (current.productIds ?? []).filter(item => item !== id)
      return { ...prev, assets: { ...prev.assets, [assetId]: { ...current, productIds } } }
    })
  }
  return <aside className="cs-info-panel cs-panel" aria-label={`${photoLabel(asset)} 정보 수정`}>
    <div className="cs-info-head">
      <div><span className="cs-eyebrow">PHOTO INFO</span><h2>{photoLabel(asset)} 정보</h2></div>
      <button type="button" className="cs-info-close" aria-label="정보 패널 닫기" onClick={onClose}><X size={16} /></button>
    </div>
    <div className="cs-info-scroll">
      <small className="cs-library-filename" title={asset.name}>{asset.name}</small>
      <label className="cs-field">사진 설명<textarea rows={3} maxLength={200} disabled={busy} placeholder="예: 검정 가죽 토트백, 펼친 상태" aria-label={`${photoLabel(asset)} 설명`} value={asset.note ?? ''} onChange={e => editAsset({ note: e.target.value })} /></label>
      <p className="cs-help">비워 두어도 됩니다. 같은 제품의 다른 사진에는 아래 제품 항목을 같이 체크하세요.</p>
      <h3>연결된 제품</h3>
      {!products.length && <p className="cs-help">아직 등록한 제품이 없습니다. 아래에서 추가한 뒤 이 사진에 연결하세요.</p>}
      {products.map(product => <details className="cs-details" key={product.id} open={(asset.productIds ?? []).includes(product.id)}>
        <summary>
          <label className="cs-library-check" onClick={event => event.stopPropagation()}>
            <input type="checkbox" disabled={busy} checked={(asset.productIds ?? []).includes(product.id)} onChange={e => toggleProduct(product.id, e.target.checked)} />
            {product.name || '이름 없는 제품'}
          </label>
        </summary>
        <p className="cs-help">{productDescription(product)}</p>
        <label className="cs-field">제품 이름<input maxLength={120} disabled={busy} value={product.name} onChange={e => editProduct(product.id, { name: e.target.value })} /></label>
        <label className="cs-field">소재<input maxLength={200} disabled={busy} value={product.material} onChange={e => editProduct(product.id, { material: e.target.value })} /></label>
        <label className="cs-field">단위<select disabled={busy} value={product.unit} onChange={e => editProduct(product.id, { unit: e.target.value as 'cm' | 'mm', ...Object.fromEntries((['width', 'height', 'depth'] as const).map(key => [key, product[key].trim() && Number.isFinite(Number(product[key])) ? String(Number((Number(product[key]) * (e.target.value === 'mm' ? 10 : 0.1)).toPrecision(12))) : product[key]])) })}><option>cm</option><option>mm</option></select></label>
        <div className="cs-dimensions">{(['width', 'height', 'depth'] as const).map((key, i) => <input key={key} type="number" min="0.01" step="any" disabled={busy} aria-label={`${product.name} ${['가로', '세로', '폭'][i]}`} placeholder={['가로', '세로', '폭'][i]} value={product[key]} onChange={e => editProduct(product.id, { [key]: e.target.value })} />)}</div>
        <label className="cs-field">측정 기준<input maxLength={160} disabled={busy} placeholder="예: 손잡이 제외, 본체 기준" value={product.basis} onChange={e => editProduct(product.id, { basis: e.target.value })} /></label>
        <label className="cs-field">제품 상태<input maxLength={160} disabled={busy} placeholder="예: 펼친 상태" value={product.state} onChange={e => editProduct(product.id, { state: e.target.value })} /></label>
      </details>)}
      <button type="button" disabled={busy} onClick={() => {
        const product = emptyProduct(Object.keys(state.products ?? {}).length + 1)
        onState(prev => ({
          ...prev,
          products: { ...prev.products, [product.id]: product },
          assets: { ...prev.assets, [assetId]: { ...prev.assets[assetId], productIds: [...new Set([...(prev.assets[assetId].productIds ?? []), product.id])] } },
        }))
      }}>＋ 제품 정보 추가</button>
    </div>
  </aside>
}
