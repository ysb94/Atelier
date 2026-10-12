import assert from 'node:assert/strict'
import { prepareBarcodeRows, resolveStyleNosToComponents } from './barcode-import'
import { parsePartnerComponentsCell } from './partner-code-import'
import type { Style } from '@/lib/types'

// These parsers only use id/styleNo. Similar product names must not merge distinct SKUs.
const styles = [
  { id: 'white-s', styleNo: 'M001', name: '동일 상품 · 흰색 S' },
  { id: 'black-s', styleNo: 'M002', name: '동일 상품 · 검정 S' },
  { id: 'white-m', styleNo: 'M003', name: '동일 상품 · 흰색 M' },
  { id: 'normalized', styleNo: 'M-004', name: '정규화 확인' },
] as Style[]
const expected = styles.slice(0, 3).map(style => ({
  styleId: style.id, styleNo: style.styleNo, qty: 1,
}))

assert.deepEqual(parsePartnerComponentsCell('m001; M002\nM003', styles), {
  components: expected, error: null,
})
assert.deepEqual(resolveStyleNosToComponents({ raw: 'm001; M002\nM003', styles }), {
  components: expected, error: null,
})
assert.deepEqual(parsePartnerComponentsCell(' m_004 ', styles), {
  components: [{ styleId: 'normalized', styleNo: 'M-004', qty: 1 }], error: null,
})
assert.deepEqual(parsePartnerComponentsCell('m001, M001, unknown', styles), {
  components: [], error: '같은 M번호가 중복됩니다: M001',
})
assert.deepEqual(resolveStyleNosToComponents({ raw: 'm001, M001, unknown', styles }), {
  components: [], error: '같은 행에서 M번호가 반복됩니다. (M001)',
})
assert.deepEqual(parsePartnerComponentsCell('M001, unknown', styles), {
  components: [], error: '등록되지 않은 M번호: unknown',
})
assert.deepEqual(resolveStyleNosToComponents({ raw: 'M001, unknown', styles }), {
  components: [], error: '등록된 상품에 없는 M번호입니다. (unknown)',
})
assert.deepEqual(parsePartnerComponentsCell('   ', styles), { components: [], error: null })
assert.deepEqual(parsePartnerComponentsCell(';,/|', styles), {
  components: [], error: '구성 M번호를 입력하세요.',
})
assert.deepEqual(resolveStyleNosToComponents({ raw: '', styles }), {
  components: [], error: 'M번호를 입력하세요.',
})

function upload(raw: string) {
  return prepareBarcodeRows({
    rows: [['88바코드', '상품명', '구성'], ['8801234567893', '상품', raw]],
    styles, fields: [], existingCodes: [],
  })[0]
}
assert.deepEqual(upload('M001,M002,M003').components, expected)
assert.equal(upload('').statusLabel, 'pending')
assert.equal(upload('').message, 'M번호 미지정으로 88코드만 등록합니다.')
assert.equal(upload('M001,M001').statusLabel, 'error')
assert.deepEqual(upload('M001,M001').components, [])
assert.equal(upload('unknown').statusLabel, 'error')
assert.deepEqual(upload('unknown').components, [])
console.info('style-components verify: SKU 구분·정규화·오류 우선순위·빈 입력·업로드 검증 통과')
