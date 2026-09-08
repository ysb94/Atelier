/**
 * 디자인 파일 브랜드 루트 격리 검증.
 * 실행: npx tsx src/lib/design/file-manager-brand.verify.ts
 */
import {
  ATELIER_STORAGE_ROOT,
  assertKeyAllowedForBrand,
  brandFileCapability,
  buildBrandUploadPath,
  filterItemsForBrand,
  isKeyAllowedForBrand,
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
assert(
  !isKeyAllowedForBrand('bbb/image/a.jpg', 'atelier'),
  'ATELIER가 다른 브랜드 키를 보지 않는다',
)
assert(!isKeyAllowedForBrand('embed/foo.html', 'bbb'), '다른 브랜드는 작업 불가')

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
  assertKeyAllowedForBrand('bbb/image/a.jpg', 'atelier')
} catch {
  threw = true
}
assert(threw, '교차 브랜드 키는 거부')

const filtered = filterItemsForBrand(
  [
    { key: 'embed/a.html', name: 'a.html' },
    { key: 'bbb/embed/b.html', name: 'b.html' },
  ],
  'embed',
  'atelier',
)
assert(filtered.length === 1 && filtered[0]?.name === 'a.html', '목록 필터')

console.log('file-manager-brand.verify ok')
