import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { analyze } from './analyze.mjs'
import { replaceGeneratedFile } from './build.mjs'

const config = { domains: [
  { id: 'products', label: '상품', features: ['products'], libs: ['products'], stores: ['styles'] },
  { id: 'api', label: 'API', features: [], libs: ['api'], stores: [], infrastructure: true },
  { id: 'shell', label: '셸', features: [], libs: [], stores: [] },
  { id: 'other', label: '기타', features: [], libs: [], stores: [] },
] }
function fixture(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-map-test-'))
  try {
    for (const [name, source] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), source) }
    return fn(root)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('named API delegates do not imply use of other stores imported by the facade', () => fixture({
  'src/lib/api/index.ts': "import * as styles from '@/lib/supabase/styles'; import * as chat from '@/lib/supabase/chat'; export function getStyles() { return styles.listStyles() }; export function getChat() { return chat.listRooms() }",
  'src/lib/supabase/styles.ts': "export function listStyles() { return getSupabase().from('styles').select('*') }",
  'src/lib/supabase/chat.ts': "export function listRooms() { return getSupabase().from('chat_rooms').select('*') }",
  'src/features/products/Page.tsx': "import { getStyles as load } from '@/lib/api'; import type { Style } from '@/lib/types'; export const Page = () => load()",
  'src/lib/types.ts': 'export type Style = { id: string }',
}, root => {
  const result = analyze(root, config)
  const edges = result.edges.filter(e => e.from === 'src/features/products/Page.tsx')
  assert.ok(edges.some(e => e.kind === 'api' && e.to === 'src/lib/supabase/styles.ts'))
  assert.ok(!edges.some(e => e.kind === 'api' && e.to === 'src/lib/supabase/chat.ts'))
  assert.ok(edges.some(e => e.kind === 'type' && e.to === 'src/lib/types.ts'))
  const evidence = edges.find(e => e.kind === 'api').evidence[0]
  assert.equal(evidence.symbol, 'getStyles'); assert.equal(evidence.via, 'src/lib/api/index.ts'); assert.equal(evidence.line, 1)
}))

test('nested routes, gate wrappers, lazy screens and menu labels resolve without executing app code', () => fixture({
  'src/components/layout/company-routes.tsx': `import { Page } from '@/features/products/Page'; import { Drawer } from '@/features/products/Drawer';
    const LazyPage = lazy(async () => { const mod = await import('@/features/products/LazyPage'); return { default: mod.Page } });
    function LazyRoute() { return <Suspense><LazyPage /></Suspense> }
    export const routes = <Route><Route path="products" element={<Gate><Page /></Gate>}><Route path=":id" element={<Drawer />} /></Route><Route path="lazy" element={<LazyRoute />} /><Route path="old" element={<RedirectTo to="/products" />} /></Route>` ,
  'src/components/layout/company-workspace-nav.ts': "export const groups = [{ title: '상품', items: [{to:'/products', label:'전체 상품'}, {to:'/products/M0001', label:'상품 상세'}] }]",
  'src/features/products/Page.tsx': 'export const Page = () => null',
  'src/features/products/Drawer.tsx': 'export const Drawer = () => null',
  'src/features/products/LazyPage.tsx': 'export const Page = () => null',
}, root => {
  const result = analyze(root, config)
  assert.deepEqual(result.routes.find(r => r.path === '/products').targets, ['src/features/products/Page.tsx'])
  assert.ok(result.routes.find(r => r.path === '/products/:id').labels.includes('상품 · 상품 상세'))
  assert.deepEqual(result.routes.find(r => r.path === '/lazy').targets, ['src/features/products/LazyPage.tsx'])
  assert.equal(result.routes.find(r => r.path === '/old').redirect, '/products')
  assert.ok(result.edges.some(e => e.kind === 'dynamic' && e.to.endsWith('LazyPage.tsx')))
}))

test('literal data resources, constants and Edge implementations include exact evidence; dynamic calls are reported', () => fixture({
  'src/lib/supabase/styles.ts': `const BUCKET = 'images';
    getSupabase().from('styles').select('*');
    getSupabase().rpc('save_styles');
    getSupabase().storage.from(BUCKET).download('key');
    getSupabase().functions.invoke('styled-image');
    getSupabase().from(tableName);
    Array.from('hello');
    import(dynamicPath);`,
  'supabase/functions/styled-image/index.ts': 'export const handler = () => null',
}, root => {
  const result = analyze(root, config)
  assert.ok(result.nodes.some(n => n.id === 'table:styles'))
  assert.ok(result.nodes.some(n => n.id === 'rpc:save_styles'))
  assert.ok(result.nodes.some(n => n.id === 'storage:images'))
  assert.ok(!result.nodes.some(n => n.id === 'table:hello'))
  assert.ok(result.edges.some(e => e.from === 'function:styled-image' && e.to === 'supabase/functions/styled-image/index.ts'))
  assert.equal(result.edges.find(e => e.kind === 'table').evidence[0].line, 2)
  assert.ok(result.unresolved.some(e => e.kind === 'table' && e.line === 6))
  assert.ok(result.unresolved.some(e => e.kind === 'dynamic-import' && e.line === 8))
}))

test('source changes, additions and removals change the snapshot; tests and environment files stay excluded', () => fixture({
  'src/features/new-feature/Page.tsx': 'export const Page = () => null',
  'src/features/products/a.verify.ts': "getSupabase().from('do_not_include')",
  '.env.local': 'SECRET_VALUE=not_for_the_viewer',
}, root => {
  const first = analyze(root, config)
  assert.equal(first.stats.files, 1)
  assert.equal(first.nodes[0].domain, 'other')
  fs.writeFileSync(path.join(root, 'src/features/new-feature/Page.tsx'), 'export const Page = () => 1')
  const second = analyze(root, config)
  assert.notEqual(second.fingerprint, first.fingerprint)
  fs.writeFileSync(path.join(root, 'src/features/new-feature/New.ts'), 'export const added = 1')
  assert.equal(analyze(root, config).stats.files, 2)
  fs.unlinkSync(path.join(root, 'src/features/new-feature/New.ts'))
  assert.equal(analyze(root, config).stats.files, 1)
  assert.ok(!JSON.stringify(first).includes('SECRET_VALUE'))
}))

test('Worker entry points are connected and malformed code fails instead of producing an incomplete map', () => fixture({
  'src/loader.ts': "export const worker = new Worker(new URL('./loader.worker.ts', import.meta.url))",
  'src/loader.worker.ts': 'export const handler = () => 1',
}, root => {
  const result = analyze(root, config)
  assert.ok(result.edges.some(e => e.from === 'src/loader.ts' && e.to === 'src/loader.worker.ts' && e.kind === 'worker'))
  fs.writeFileSync(path.join(root, 'src/loader.ts'), 'export const broken = (')
  assert.throws(() => analyze(root, config), /src\/loader.ts:1/)
}))

test('Korean titles and intros precede filenames and update from current source', () => fixture({
  'src/features/products/WarehousePage.tsx': `function Helper() { return <h2>보조 창 제목</h2> }
    export function WarehousePage() { return <main><PageHeader title="창고 관리" description="위치별 재고를 확인합니다." /><h2>보조 항목</h2></main> }`,
  'src/features/products/MyAttendancePanel.tsx': 'export function MyAttendancePanel() { return <section><h2>월별 근태</h2><p>출퇴근과 휴가를 확인합니다.</p></section> }',
}, root => {
  const first = analyze(root, config)
  const file = first.nodes.find(n => n.fileName === 'WarehousePage.tsx')
  assert.equal(file.label, '창고 관리')
  assert.equal(file.role, '위치별 재고를 확인합니다.')
  assert.equal(file.labelSource, '화면 제목에서 자동 추출')
  assert.equal(file.labelEvidence.line, 2)
  assert.ok(!file.sections.includes('보조 창 제목'))
  const panel = first.nodes.find(n => n.fileName === 'MyAttendancePanel.tsx')
  assert.equal(panel.label, '월별 근태'); assert.equal(panel.role, '출퇴근과 휴가를 확인합니다.')
  fs.writeFileSync(path.join(root, file.path), 'export function WarehousePage() { return <PageHeader title="재고 위치 관리" /> }')
  const changed = analyze(root, config)
  assert.equal(changed.nodes.find(n => n.id === file.id).label, '재고 위치 관리')
  assert.notEqual(changed.fingerprint, first.fingerprint)
}))

test('titleless code uses reusable Korean rules, exposes uncertainty and avoids incidental card headings', () => fixture({
  'src/lib/supabase/invoice-product-name-maps.ts': 'export function getMaps() {}; export function saveMap() {}; export function deleteMap() {}',
  'src/lib/invoice/item-name-transform.worker.ts': 'export const run = () => null',
  'src/features/products/NewWidget.tsx': 'export function NewWidget() { return <h2>{dynamicTitle}</h2> }',
  'src/features/products/InvoiceOptionMapRulesPanel.tsx': 'export function InvoiceOptionMapRulesPanel() { return <main><CardTitle>품목명 원장 가져오기</CardTitle><CardTitle>검토 필요</CardTitle></main> }',
}, root => {
  const result = analyze(root, config)
  const store = result.nodes.find(n => n.fileName === 'invoice-product-name-maps.ts')
  assert.equal(store.label, '송장 품목명 매핑')
  assert.equal(store.labelSource, '코드 이름에서 추정')
  assert.match(store.role, /조회, 등록·수정, 삭제/)
  assert.equal(result.nodes.find(n => n.path.includes('.worker.')).roleType, '백그라운드 처리')
  const unknown = result.nodes.find(n => n.fileName === 'NewWidget.tsx')
  assert.match(unknown.label, /상품/); assert.deepEqual(unknown.untranslated, ['widget'])
  const cards = result.nodes.find(n => n.fileName === 'InvoiceOptionMapRulesPanel.tsx')
  assert.equal(cards.label, '송장 옵션 매핑 규칙 패널')
  assert.deepEqual(cards.sections, ['품목명 원장 가져오기', '검토 필요'])
}))

test('atomic output replacement retries transient locks and reports permanent failures', () => {
  let attempts = 0
  const pauses = []
  replaceGeneratedFile('temporary', 'snapshot', () => {
    if (++attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' })
  }, ms => pauses.push(ms))
  assert.equal(attempts, 3); assert.deepEqual(pauses, [100, 200])
  attempts = 0
  assert.throws(() => replaceGeneratedFile('temporary', 'snapshot', () => {
    attempts++; throw Object.assign(new Error('locked'), { code: 'EBUSY' })
  }, () => {}), /locked/)
  assert.equal(attempts, 6)
  attempts = 0
  assert.throws(() => replaceGeneratedFile('missing', 'snapshot', () => {
    attempts++; throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  }, () => {}), /missing/)
  assert.equal(attempts, 1)
})
