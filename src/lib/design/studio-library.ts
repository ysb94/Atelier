import type { StudioAsset, StudioProduct, StudioState } from './styled-studio'
export const REQUEST_ATTACH_LIMIT = 14
export function normalizeLibrary(state: StudioState): StudioState {
  let next = Math.max(state.nextPhotoNumber ?? 1, ...Object.values(state.assets).map(a => (a.photoNo ?? 0) + 1))
  const assets = Object.fromEntries(Object.values(state.assets).map(a => [a.id, a.photoNo ? a : { ...a, photoNo: next++ }]))
  let products = state.products
  if (!products) {
    products = {}
    const f = state.form
    if (f.productName || f.fabricMaterial || f.sizeWidth || f.sizeHeight || f.sizeDepth) {
      products.legacy = { id: 'legacy', name: f.productName || '기존 제품', material: f.fabricMaterial, width: f.sizeWidth, height: f.sizeHeight, depth: f.sizeDepth, unit: 'mm', basis: '', state: '' }
      for (const id of [...Object.values(state.product), ...(state.conversationUi?.sampleIds ?? [])]) {
        if (id && assets[id]) assets[id] = { ...assets[id], productIds: ['legacy'] }
      }
    }
  }
  return { ...state, assets, products, nextPhotoNumber: next }
}
export function addLibraryAssets(state: StudioState, additions: StudioAsset[]): StudioState {
  const next = normalizeLibrary(state)
  for (const asset of additions) { next.assets[asset.id] = { ...asset, photoNo: next.nextPhotoNumber! }; next.nextPhotoNumber! += 1 }
  return next
}
export function attachAssetsToRequest(state: StudioState, selectionKey: string, assetIds: string[]) {
  const current = { ...state.editInputs?.[selectionKey] }
  let leftover = 0
  for (const id of assetIds) {
    if (current[id]) continue
    if (Object.keys(current).length >= REQUEST_ATTACH_LIMIT) { leftover += 1; continue }
    current[id] = '이번 요청에서 용도 해석'
  }
  return { leftover, editInputs: { ...state.editInputs, [selectionKey]: current } }
}
export function photoLabel(asset: StudioAsset) { return `사진 ${asset.photoNo ?? '?'}` }
export function photoNote(asset?: StudioAsset) { return asset?.note?.trim() ?? '' }
export function selectedPhotoNotes(state: StudioState, ids: string[]) {
  return ids.flatMap(id => {
    const asset = state.assets[id]
    const note = photoNote(asset)
    return asset && note ? [`${photoLabel(asset)}: ${note}`] : []
  })
}
export function selectedProducts(state: StudioState, ids: string[]): StudioProduct[] {
  return [...new Set(ids.flatMap(id => state.assets[id]?.productIds ?? []))].flatMap(id => state.products?.[id] ? [{ ...state.products[id] }] : [])
}
export function productDescription(p: StudioProduct) {
  return `${p.name || '이름 없는 제품'} · 가로 ${p.width || '?'} × 세로 ${p.height || '?'} × 폭 ${p.depth || '?'} ${p.unit}${p.material ? ` · ${p.material}` : ''}${p.basis ? ` · 측정 기준: ${p.basis}` : ''}${p.state ? ` · 상태: ${p.state}` : ''}`
}
export function missingPhotoMentions(state: StudioState, request: string, ids: string[]) {
  const numbers = [...new Set([...request.matchAll(/사진\s*(\d+)/g)].map(m => Number(m[1])))]
  return numbers.filter(n => !ids.some(id => state.assets[id]?.photoNo === n))
}
export function insertAtCaret(text: string, insert: string, caret: number) {
  const pos = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, pos)
  const after = text.slice(pos)
  const left = before && !/\s$/.test(before) ? ' ' : ''
  const right = after && !/^\s/.test(after) ? ' ' : ''
  const chunk = `${left}${insert}${right}`
  return { text: `${before}${chunk}${after}`, caret: before.length + chunk.length }
}
