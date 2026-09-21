/**
 * 스튜디오 요청 첨부 제한·보관함 삭제 검증.
 * 실행: npx tsx src/lib/design/studio-library.verify.ts
 */
import { addLibraryAssets, attachAssetsToRequest, removeLibraryAsset, REQUEST_ATTACH_LIMIT } from './studio-library.ts'
import { newStudio, type StudioAsset } from './styled-studio.ts'
import './studio-image-processing.verify.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const empty = newStudio()
const first = attachAssetsToRequest(empty, 'new', ['a', 'b'])
assert(first.leftover === 0, '여유 있으면 leftover 0')
assert(Object.keys(first.editInputs.new ?? {}).length === 2, '두 장을 현재 요청에 첨부')

const fullIds = Array.from({ length: REQUEST_ATTACH_LIMIT }, (_, index) => `full-${index}`)
const full = attachAssetsToRequest({ ...empty, editInputs: { new: Object.fromEntries(fullIds.map((id) => [id, '이번 요청에서 용도 해석'])) } }, 'new', ['extra-1', 'extra-2'])
assert(full.leftover === 2, '14장이 이미 있으면 초과분은 leftover')
assert(Object.keys(full.editInputs.new ?? {}).length === REQUEST_ATTACH_LIMIT, '첨부는 14장을 넘기지 않는다')

const again = attachAssetsToRequest({ ...empty, editInputs: first.editInputs }, 'new', ['a', 'c'])
assert(again.leftover === 0, '이미 첨부한 사진은 leftover가 아니다')
assert(Object.keys(again.editInputs.new ?? {}).length === 3, '새 사진만 추가한다')

function testAsset(id: string): StudioAsset {
  return { id, name: `${id}.png`, type: 'image/png', data: 'data:image/png;base64,aGVsbG8=' }
}

let library = addLibraryAssets(empty, [testAsset('p1'), testAsset('p2'), testAsset('p3')])
assert(library.assets.p1.photoNo === 1 && library.assets.p3.photoNo === 3 && library.nextPhotoNumber === 4, '사진 번호는 등록 순')
library = {
  ...library,
  product: { front: 'p2' },
  references: { composition: ['p2', 'p3'] },
  editInputs: { new: { p2: '이번 요청에서 용도 해석', p3: '이번 요청에서 용도 해석' } },
  conversationUi: { sampleIds: ['p2'], roles: { p2: '제품 기준' }, turns: [] },
}
const unused = removeLibraryAsset(library, 'p2')
assert(unused.removed, '이력에 없는 사진은 삭제한다')
assert(!unused.state.assets.p2, 'assets에서 제거')
assert(unused.state.assets.p1.photoNo === 1 && unused.state.assets.p3.photoNo === 3, '남은 사진 번호는 유지')
assert(unused.state.nextPhotoNumber === 4, '삭제 번호는 재사용하지 않는다')
assert(!unused.state.product.front, '현재 요청 product 참조를 정리')
assert(unused.state.references.composition?.join(',') === 'p3', 'references에서 해당 사진만 제거')
assert(!unused.state.editInputs?.new?.p2 && unused.state.editInputs?.new?.p3, '현재 요청 첨부에서만 제거')
assert(!unused.state.conversationUi?.sampleIds.includes('p2'), 'sampleIds에서 제거')
assert(!unused.state.conversationUi?.roles.p2, 'roles에서 제거')
assert(library.assets.p2, '원본 state는 바꾸지 않는다')

const blockedVersion = removeLibraryAsset({
  ...library,
  versions: [{ id: 'v1', title: '시안 1', created: '2026-09-21', request: '만들어줘', prompt: '', assetIds: ['p1'], resultId: 'p3', favorite: false }],
}, 'p1')
assert(!blockedVersion.removed && blockedVersion.message?.includes('시안 1'), '시안 입력 사진은 삭제 차단')
assert(blockedVersion.state.assets.p1, '차단 시 assets를 유지')

const blockedResult = removeLibraryAsset({
  ...library,
  versions: [{ id: 'v1', title: '시안 1', created: '2026-09-21', request: '만들어줘', prompt: '', assetIds: ['p1'], resultId: 'p3', favorite: false }],
}, 'p3')
assert(!blockedResult.removed && blockedResult.message?.includes('시안 1'), '결과 사진은 삭제 차단')

const blockedTurn = removeLibraryAsset({
  ...library,
  conversationUi: {
    sampleIds: [],
    roles: {},
    turns: [{ id: 't1', request: '이 제품으로 레퍼런스처럼 연출컷을 만들어줘', action: 'create', assetIds: ['p1'], versionIds: [], productName: '', material: '', dimensions: '', ratio: '4:5' }],
  },
}, 'p1')
assert(!blockedTurn.removed && blockedTurn.message?.includes('이 제품으로'), '대화 이력 사진은 삭제 차단')

console.log('studio-library.verify ok')
