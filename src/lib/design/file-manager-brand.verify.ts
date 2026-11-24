/**
 * 마스마룰즈 파일 관리의 최상위 폴더와 브랜드 접근 범위 검증.
 * 실행: npx tsx src/lib/design/file-manager-brand.verify.ts
 */
import {
  ATELIER_STORAGE_ROOT,
  assertKeyAllowedForBrand,
  brandFileCapability,
  buildBrandUploadPath,
  filterItemsForBrand,
  isKeyAllowedForBrand,
  topLevelFolderNameError,
} from './file-manager-brand'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const atelier = brandFileCapability('atelier')
assert(atelier.canOperate, 'ATELIER는 파일 작업을 연다')
assert(atelier.root === ATELIER_STORAGE_ROOT, 'ATELIER 루트는 masmarulez')

const other = brandFileCapability('bbb')
assert(!other.canOperate, 'prefix 미지원이면 다른 브랜드는 열지 않는다')

assert(isKeyAllowedForBrand('embed/foo.html', 'atelier'), 'ATELIER 기존 type/ 키')
assert(
  isKeyAllowedForBrand('masmarulez/image/a.jpg', 'atelier'),
  'ATELIER masmarulez 별칭 키',
)
assert(!isKeyAllowedForBrand('embed/foo.html', 'bbb'), '다른 브랜드는 작업 불가')

for (const [type, name] of [
  ['Prod_Images', 'Clean/M0001.jpg'],
  ['all', 'ACC/ballcap/00_ballcap.jpg'],
  ['common', 'bottom/a-bottom.jpg'],
  ['product', 'Acc/keyring/AlohaBB/01_AlohaBB_keyring.jpg'],
  ['renew', '1.jpg'],
  ['z_neeoru', '신상품/상세.사진.jpg'],
  ['z_voyatton', '제품-1.png'],
  ['새브랜드-2026', '샘플/가방.jpg'],
]) {
  const key = `${type}/${name}`
  assert(topLevelFolderNameError(type) === null, `${type} 최상위 이름 허용`)
  for (const slug of ['atelier', 'masmarulez']) {
    assertKeyAllowedForBrand(`${type}/`, slug)
    assertKeyAllowedForBrand(key, slug)
    assert(buildBrandUploadPath(slug, type) === type, `${slug} ${type} 경로 유지`)
  }
  assert(!isKeyAllowedForBrand(key, 'bbb'), `${type} 다른 브랜드 작업 차단`)
  const items = filterItemsForBrand(
    [
      { key, name },
      { name: 'fallback.jpg' },
      { key: `bbb/${key}`, name: 'other.jpg' },
      { key: 'unknown/file.jpg', name: 'unknown.jpg' },
    ],
    type,
    'atelier',
  )
  assert(
    items.length === 2 && items[0]?.key === key && items[1]?.name === 'fallback.jpg',
    `${type} 조회 결과에는 요청한 폴더의 파일만 표시`,
  )
  assert(filterItemsForBrand([{ key, name }], type, 'bbb').length === 0, '미연결 브랜드 목록 비공개')
}

for (const name of ['z.neeoru', 'z voyatton', 'a/b', 'logs', 'static', 'masmarulez']) {
  assert(Boolean(topLevelFolderNameError(name)), `최상위 폴더 이름 오류 안내: ${name}`)
}
for (const key of [
  'z.neeoru/', 'z voyatton/', '../', 'z_neeoru/../image/a.jpg', 'z_neeoru/./a.jpg',
  'z_neeoru//a.jpg', 'z_neeoru/ab\\c.jpg', 'logs/history.json', 'static/app.js',
]) {
  assert(!isKeyAllowedForBrand(key, 'atelier'), `잘못된 경로 차단: ${key}`)
}

assert(
  buildBrandUploadPath('atelier', 'image', 'bags') === 'image/bags',
  'ATELIER 업로드는 기존 type/folder',
)

let threw = false
try {
  buildBrandUploadPath('bbb', 'image', 'bags')
} catch {
  threw = true
}
assert(threw, '다른 브랜드 업로드 경로는 만들지 않는다')

threw = false
try {
  assertKeyAllowedForBrand('z_neeoru/image/a.jpg', 'bbb')
} catch {
  threw = true
}
assert(threw, '교차 브랜드 키는 거부')

const filtered = filterItemsForBrand(
  [
    { key: 'embed/a.html', name: 'a.html' },
    { key: 'bbb/embed/b.html', name: 'b.html' },
    { key: 'masmarulez/embed/c.html', name: 'c.html' },
    { key: 'masmarulez/image/d.jpg', name: 'd.jpg' },
  ],
  'embed',
  'atelier',
)
assert(filtered.map((item) => item.name).join(',') === 'a.html,c.html', '요청한 폴더와 그 기존 별칭 경로만 표시')

console.log('file-manager-brand.verify ok')
