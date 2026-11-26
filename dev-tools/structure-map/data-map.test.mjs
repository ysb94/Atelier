import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { changedConnections, makeDataIndex, parseContracts, sqlConnections, uncoveredChanges } from './data-map.mjs'

const migration = `
-- CREATE TABLE app.comment_only (ignored text);
CREATE TABLE app.stock (id uuid PRIMARY KEY, quantity numeric(8, 2),
  label text DEFAULT 'create table app.literal_only', CHECK (quantity >= 0));
ALTER TABLE app.stock ADD COLUMN IF NOT EXISTS position text;
CREATE OR REPLACE FUNCTION public.receive_box() RETURNS void AS $flow$
BEGIN
  UPDATE app.stock SET quantity = 2;
  PERFORM quantity FROM app.stock;
END;
$flow$ LANGUAGE plpgsql;
CREATE VIEW app.stock_positions AS SELECT * FROM app.stock;
`

const stock = {
  id: 'stock', label: '활성 재고', origin: 'app.stock', write: 'receive_box',
  propagation: '창고 목록', copies: '시트', reason: '시트 조회를 지원한다.',
  resources: ['table:app.stock', 'rpc:public.receive_box'], evidence: ['supabase/migrations/example.sql'],
}

test('migration evidence keeps columns, view definitions and function data flow separate from comments', () => {
  const entries = sqlConnections(migration)
  const fields = entries.filter(entry => entry.resource === 'table:app.stock').flatMap(entry => entry.columns)
  assert.deepEqual(fields, ['id', 'quantity', 'label', 'position'])
  assert.ok(entries.some(entry => entry.resource === 'table:app.stock_positions' && entry.operation === '정의'))
  assert.ok(entries.some(entry => entry.resource === 'table:app.stock' && entry.operation === '쓰기' && entry.owner === 'rpc:public.receive_box'))
  assert.ok(entries.some(entry => entry.resource === 'table:app.stock' && entry.operation === '조회' && !entry.owner))
  assert.ok(!entries.some(entry => entry.resource.endsWith('_only')))
})

test('index finds semantic records, migration links and integration locations without request values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-data-map-test-'))
  try {
    fs.mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true })
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, stock.evidence[0]), migration)
    fs.writeFileSync(path.join(root, 'src/stock.ts'), `
      const endpoint = 'https://example.com/private/path?token=PRIVATE_VALUE';
      fetch(endpoint, { headers: { Authorization: 'PRIVATE_HEADER' } });
      localStorage.setItem('private-key', 'PRIVATE_ROW');
    `)
    const graph = {
      nodes: [{ path: 'src/stock.ts', domain: 'warehouse' }],
      edges: [{ from: 'src/stock.ts', to: 'rpc:receive_box', kind: 'rpc', evidence: [{ line: 4 }] }],
      unresolved: [{ file: 'src/stock.ts', kind: 'table', line: 5 }],
    }
    const index = makeDataIndex(root, graph, [stock])
    assert.equal(index.contracts, 1)
    assert.match(index.markdown, /### 활성 재고 \(stock\)/)
    assert.match(index.markdown, /쓰기 \[table:app\.stock\] supabase\/migrations\/example\.sql:8/)
    assert.match(index.markdown, /앱 호출 \[warehouse\] src\/stock\.ts:4/)
    assert.match(index.markdown, /동적 이름 src\/stock\.ts:5/)
    assert.match(index.markdown, /### browser:localStorage/)
    assert.match(index.markdown, /### external:example\.com/)
    assert.doesNotMatch(index.markdown, /PRIVATE_|private-key|\/private\/path/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('guard ignores visual changes and flags changed data calls, import targets and core adapters', () => {
  const file = 'src/features/warehouse/Stock.tsx'
  const previous = "const data = supabase.from('stock').select('id'); const label = '이전 제목'"
  assert.equal(changedConnections(file, previous, previous.replace('이전', '새')), null)
  assert.deepEqual([...changedConnections(file, previous, previous.replace("'id'", "'id,quantity'"))], ['table:stock'])
  const alias = "import { listStock as load } from '../../lib/api'; useQuery({ queryFn: () => load() });"
  assert.ok(changedConnections(file, alias, alias.replace('listStock', 'listArchivedStock')).has('connection:../../lib/api#listArchivedStock'))
  const adapter = 'src/lib/supabase/stock.ts'
  assert.equal(changedConnections(adapter, 'const n = 1', '// description\nconst n = 1'), null)
  assert.deepEqual([...changedConnections(adapter, 'const n = 1', 'const n = 2')], [])
})

test('guard requires a related record change, including deleted sources', () => {
  const previous = [stock]
  const change = { file: 'src/new-stock.ts', resources: new Set(['rpc:receive_box']) }
  assert.deepEqual(uncoveredChanges([change], previous, previous), [change])
  const unrelated = { ...stock, id: 'chat', resources: ['table:chat_rooms'] }
  assert.deepEqual(uncoveredChanges([change], previous, [stock, unrelated]), [change])
  const revised = { ...stock, propagation: '창고 목록과 파인더' }
  assert.deepEqual(uncoveredChanges([change], previous, [revised]), [])
  const removed = { file: stock.evidence[0], resources: new Set(), removed: true }
  assert.deepEqual(uncoveredChanges([removed], previous, []), [])
})

test('record validation requires reasons, evidence, and unique IDs', () => {
  assert.deepEqual(parseContracts(JSON.stringify([stock])), [stock])
  assert.throws(() => parseContracts(JSON.stringify([{ ...stock, reason: ' ' }])), /reason/)
  assert.throws(() => parseContracts(JSON.stringify([{ ...stock, evidence: [] }])), /evidence/)
  assert.throws(() => parseContracts(JSON.stringify([stock, stock])), /중복/)
})
