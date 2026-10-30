type Slot = { warehouseId: string; code: string; zone: 'picking' | 'box_storage' }
type Save = { warehouseId: string; zone: Slot['zone']; codes: string[] }
declare global {
  interface Window {
    __warehouseSlotsFixture: { slots: Slot[]; saves: Save[]; failLoad: boolean; failSave: boolean }
  }
}
const warehouseId = 'fixture-warehouse'
window.__warehouseSlotsFixture = {
  slots: [
    { warehouseId, code: '기존-출고자리', zone: 'picking' },
    { warehouseId, code: '2-1-1', zone: 'box_storage' },
  ],
  saves: [], failLoad: new URLSearchParams(location.search).has('fail-load'), failSave: false,
}
export async function getActiveWarehouseInventorySet() { return { warehouseId } }
export async function getWarehouseRegisteredSlots() {
  if (window.__warehouseSlotsFixture.failLoad) throw new Error('자리 조회 검증 오류')
  return window.__warehouseSlotsFixture.slots.map((slot) => ({ ...slot }))
}
export async function saveWarehouseRegisteredSlots(id: string, zone: Slot['zone'], codes: readonly string[], brandId: string) {
  if (brandId !== 'fixture-brand') throw new Error('다른 브랜드 저장을 차단합니다.')
  if (window.__warehouseSlotsFixture.failSave) throw new Error('자리 저장 검증 오류')
  window.__warehouseSlotsFixture.saves.push({ warehouseId: id, zone, codes: [...codes] })
  window.__warehouseSlotsFixture.slots = [
    ...window.__warehouseSlotsFixture.slots.filter((slot) => slot.zone !== zone && !codes.includes(slot.code)),
    ...codes.map((code) => ({ warehouseId: id, code, zone })),
  ]
  return { reclassifiedCount: 2 }
}
