import assert from 'node:assert/strict'
import { prepareSabangnetUrlRows, urlImportPayload } from './sabangnet-url-import'
import type { CodeUsageTarget, CodeUsageTargetFolder, SabangnetProduct } from '@/lib/types'

const folders = [{ id: 'online', parentId: null, name: '온라인' }, { id: 'offline', parentId: null, name: '오프라인' }] as CodeUsageTargetFolder[]
const targets = [{ id: 'on', brandId: 'b', folderId: 'online', name: '텐바이텐 온라인', normalizedName: '텐바이텐온라인', groupName: '텐바이텐', siteName: '', active: true }, { id: 'off', brandId: 'b', folderId: 'offline', name: '텐바이텐 대학로점', normalizedName: '텐바이텐대학로점', groupName: '텐바이텐', siteName: '대학로점', active: true }] as CodeUsageTarget[]
const products = [{ id: 'p', code: '000123', styles: [] }, { id: 'q', code: '456', styles: [{ styleId: 'm1' }, { styleId: 'm2' }] }] as SabangnetProduct[]
const header = ['쇼핑몰명', '쇼핑몰상품코드', '품번코드', '상품명(송신)', '쇼핑몰상품코드 URL']
const row = (code: string, url: string, mall = '텐바이텐') => [mall, 'shop', code, '상품', url]
const prepare = (rows: string[][]) => prepareSabangnetUrlRows({ rows: [header, ...rows], products, targets, aliases: [], folders, existing: [] })
let result = prepare([row('000123', 'https://shop.example/1'), row('456', 'https://shop.example/2')])
assert.deepEqual(result.map(r => [r.status, r.productId, r.targetId]), [['ready', 'p', 'on'], ['ready', 'q', 'on']])
assert.equal(urlImportPayload(result).length, 2) // M번호 없음/여러 개 모두 코드 URL 저장 가능
assert.equal(urlImportPayload(result)[0]!.mall_product_name, '상품') // 업체별 송신 상품명 보존
result = prepare([row('000123', 'https://shop.example/1'), row('000123', 'https://shop.example/2')])
assert.ok(result.every(r => r.status === 'conflict')); assert.equal(urlImportPayload(result).length, 0)
result = prepare([row('000123', 'https://shop.example/1'), row('000123', 'https://shop.example/1')])
assert.deepEqual(result.map(r => r.status), ['ready', 'duplicate'])
assert.equal(prepare([row('999', 'https://shop.example/1')])[0]!.status, 'missing-code')
assert.equal(prepare([row('000123', 'https://shop.example/1', '텐바이텐 대학로점')])[0]!.status, 'missing-mall')
assert.equal(prepare([row('000123', 'javascript:alert(1)')])[0]!.status, 'invalid')
const options = { rows: [header, row('000123', 'https://shop.example/1')], products, targets, aliases: [], folders }
assert.equal(prepareSabangnetUrlRows({ ...options, existing: [{ id: 'u', brandId: 'b', productId: 'p', targetId: 'on', url: 'https://shop.example/1', mallProductCode: '', sourceFile: '', sourceMall: '', sourceRow: 1 }] })[0]!.status, 'unchanged')
assert.equal(prepareSabangnetUrlRows({ ...options, existing: [{ id: 'u', brandId: 'b', productId: 'p', targetId: 'on', url: 'https://shop.example/other', mallProductCode: '', sourceFile: '', sourceMall: '', sourceRow: 1 }] })[0]!.status, 'conflict')
assert.throws(() => prepareSabangnetUrlRows({ ...options, existing: [], rows: [['품번코드', 'URL']] }))
console.log('사방넷 URL: 온라인 범위·SKU 독립·전체 충돌 보류·재업로드 보존 PASS')
