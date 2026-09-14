import assert from 'node:assert/strict'
import {
  buildStyledCutsPrompt,
  createInitialForm,
  createStyledPhoto,
  missingRequiredPhotos,
  PRODUCT_PHOTO_SLOTS,
  REFERENCE_ROLE_SLOTS,
  activeReferencePhotos,
  revokeReferencePhotos,
  revokeProductPhotos,
  revokeExplorationPhotos,
} from '../src/lib/design/styled-cuts.ts'

const original = new File(['original-image-bytes'], 'IMG_0123.JPG', {
  type: 'image/jpeg',
  lastModified: 123,
})
const photos = {}
const reference = createStyledPhoto(original, 'reference')
try {
  assert.equal(PRODUCT_PHOTO_SLOTS.length, 10)
  for (const slot of PRODUCT_PHOTO_SLOTS) {
    assert.ok(slot.guide.length >= 35, `${slot.label}에 초보자용 촬영 안내가 있다`)
  }
  assert.ok(PRODUCT_PHOTO_SLOTS.find((slot) => slot.key === 'scale').guide.includes('착용컷'))
  assert.ok(PRODUCT_PHOTO_SLOTS.find((slot) => slot.key === 'material').guide.includes('짜임·결·무늬·광택'))
  for (const slot of PRODUCT_PHOTO_SLOTS) {
    photos[slot.key] = createStyledPhoto(original, slot.key)
  }
  assert.equal(photos.front.file.name, 'IMG_0123.JPG')
  assert.equal(photos.logo.file.name, 'IMG_0123.JPG')
  assert.equal(reference.file.name, 'IMG_0123.JPG')
  assert.equal(original.name, 'IMG_0123.JPG', '원본 이름은 변경하지 않는다')
  assert.equal(await photos.front.file.text(), await original.text(), '사진 내용은 보존한다')
  assert.equal(photos.front.file.lastModified, original.lastModified)

  const form = createInitialForm()
  form.productName = '미니백'
  form.productType = '크로스백'
  form.sizeWidth = '200'
  form.sizeHeight = '150'
  form.outputRatio = '4:5'
  form.usagePurpose = '기타'
  form.usageOther = '매장 포스터'
  form.highlightDetails = '앞면 로고와 가죽 질감이 잘 보이게'
  form.referenceChanges = '꽃은 빼주세요\n배경을 더 밝게'
  const prompt = buildStyledCutsPrompt(form, photos, reference)
  assert.ok(prompt.includes('[제품 사진 · 정면] IMG_0123.JPG'), '원본 파일명에 정면 역할을 연결한다')
  assert.ok(prompt.includes('[제품 사진 · 소재 디테일] IMG_0123.JPG'), '원본 파일명에 소재 역할을 연결한다')
  assert.ok(prompt.includes('[참고 사진 · 연출용] IMG_0123.JPG'), '원본 파일명에 참고 사진 역할을 연결한다')
  for (const value of ['미니백', '크로스백', '200 mm', '150 mm', '4:5', '매장 포스터', '앞면 로고와 가죽 질감이 잘 보이게', '꽃은 빼주세요\n배경을 더 밝게']) {
    assert.ok(prompt.includes(value), `입력값 포함: ${value}`)
  }
  assert.ok(!prompt.includes('실제 폭:'), '빈 치수는 추측하지 않는다')
  const defaultPrompt = buildStyledCutsPrompt(createInitialForm(), photos, reference)
  assert.ok(defaultPrompt.length > 0, '강조 사항을 비워도 프롬프트가 생성된다')
  assert.ok(!defaultPrompt.includes('특히 보여주고 싶은 부분'), '빈 선택 항목의 제목은 넣지 않는다')
  assert.ok(defaultPrompt.includes('별도의 연출 변경 요청은 없습니다.'), '빈칸이면 참고 사진의 기본 연출을 따른다')
  assert.ok(!defaultPrompt.includes('참고 사진에서 바꾸고 싶은 점'), '변경 요청이 없으면 해당 제목을 넣지 않는다')
  assert.ok(prompt.includes('요청한 연출 요소만 변경하고 나머지는 참고 사진을 따르세요'), '입력한 변경 범위만 연출에 반영한다')
  assert.ok(prompt.includes('never override product preservation'), '연출 변경보다 제품 보존을 우선한다')
  for (const rule of ['original product color', 'surface texture, pattern', 'logo and label text', 'visible seams, stitching', 'hardware shape, count', 'natural contact shadows', 'Do not copy watermarks', 'Do not invent unseen interiors', 'choose a balanced view']) {
    assert.ok(defaultPrompt.includes(rule), `입력 없이도 기본 규칙 포함: ${rule}`)
    assert.ok(prompt.includes(rule), `강조를 입력해도 기본 규칙 유지: ${rule}`)
  }
  assert.ok(prompt.includes('they never authorize changing or enlarging that feature'), '강조 요청이 제품 변형을 허용하지 않는다')
  form.highlightDetails = '   '
  const clearedPrompt = buildStyledCutsPrompt(form, photos, reference)
  assert.ok(!clearedPrompt.includes('앞면 로고와 가죽 질감이 잘 보이게'), '지운 강조 내용은 제거된다')
  assert.ok(!clearedPrompt.includes('특히 보여주고 싶은 부분'), '공백만 입력해도 선택 항목을 생략한다')
  form.referenceExclude['워터마크/문구'] = false
  assert.ok(!buildStyledCutsPrompt(form, photos, reference).includes('- 워터마크/문구'))
  for (const blank of ['', '   ']) {
    form.referenceChanges = blank
    const resetReferencePrompt = buildStyledCutsPrompt(form, photos, reference)
    assert.ok(!resetReferencePrompt.includes('꽃은 빼주세요'), '지운 변경 요청은 제거된다')
    assert.ok(resetReferencePrompt.includes('별도의 연출 변경 요청은 없습니다.'), '공백 또는 삭제 후 기본 연출로 돌아간다')
  }

  const { front: omittedFront, back: omittedBack, ...incomplete } = photos
  assert.ok(omittedFront && omittedBack)
  assert.equal(Object.keys(incomplete).length, 8)
  assert.deepEqual(missingRequiredPhotos(incomplete).map((slot) => slot.key), ['front', 'back'])
  assert.ok(!buildStyledCutsPrompt(form, incomplete, reference).includes('[제품 사진 · 정면]'), '누락된 사진 역할을 첨부 목록에 만들지 않는다')
  assert.equal(buildStyledCutsPrompt(form, photos, null), '')
  assert.equal(buildStyledCutsPrompt(form, {}, reference), '')
  const split = {}
  try {
    for (const slot of REFERENCE_ROLE_SLOTS) split[slot.key] = createStyledPhoto(new File(['role-photo'], `${slot.key}-photo.png`, { type: 'image/png' }), slot.key)
    form.referenceMode = 'split'
    assert.equal(buildStyledCutsPrompt(form, photos, reference, {}), '', '다른 모드의 사진은 준비 완료로 세지 않는다')
    assert.equal(activeReferencePhotos('split', reference, split).length, 4)
    const allRoles = buildStyledCutsPrompt(form, photos, reference, split)
    for (const slot of REFERENCE_ROLE_SLOTS) {
      assert.ok(allRoles.includes(`[참고 사진 · ${slot.label} 전용] ${slot.key}-photo.png`))
      assert.ok(allRoles.includes(slot.scope), `${slot.label}의 참고 범위를 명시한다`)
    }
    assert.ok(!allRoles.includes('[참고 사진 · 연출용]'), '숨긴 단일 사진 역할은 제외한다')
    assert.ok(!allRoles.includes('single reference image'), '단일 사진 지시와 충돌하지 않는다')
    const backgroundOnly = buildStyledCutsPrompt(form, photos, null, { background: split.background })
    assert.ok(backgroundOnly.includes('background-photo.png'), '역할 한 개만 등록해도 작성된다')
    assert.ok(!backgroundOnly.includes('composition-photo.png'), '미등록 참고 파일을 만들지 않는다')
    assert.ok(backgroundOnly.includes('전용 참고 사진이 없는 항목'), '빈 역할의 보완 기준을 안내한다')
    assert.ok(backgroundOnly.includes('제품과 소품의 실제 크기 관계'))
    assert.ok(backgroundOnly.includes('원단·소재 표현'))
    form.referenceMode = 'single'
    const singleAgain = buildStyledCutsPrompt(form, photos, reference, split)
    assert.ok(singleAgain.includes('[참고 사진 · 연출용]'))
    assert.ok(!singleAgain.includes('background-photo.png'), '단일 모드에서는 보관 중인 역할 사진을 제외한다')
  } finally { revokeReferencePhotos(split) }
  const exploration = { background: [createStyledPhoto(new File(['x'], 'room-A.png', { type: 'image/png' }), 'background'), createStyledPhoto(new File(['x'], 'room-B.png', { type: 'image/png' }), 'background')], pose: [createStyledPhoto(new File(['x'], 'resting.png', { type: 'image/png' }), 'pose')] }
  try {
    form.referenceMode = 'explore'
    form.modelHeightCm = '172'
    assert.equal(buildStyledCutsPrompt(form, photos, reference, {}), '')
    for (const count of ['2', '3', '4']) {
      form.variationCount = count
      const result = buildStyledCutsPrompt(form, photos, reference, {}, exploration)
      assert.ok(result.includes(`시안 ${count}장`))
      assert.ok(result.includes('배경 후보 2] room-B.png'))
      assert.ok(result.includes('제품을 놓는 모습 후보 1] resting.png'))
      assert.ok(result.includes('착용자 키는 172 cm'))
      assert.ok(result.includes('크기 비교만을 위한 자료'))
      assert.ok(result.includes('Exclude people'))
      assert.ok(result.includes('No invisible hands or supports'))
      assert.ok(result.includes('콜라주·분할 화면'))
      assert.ok(!result.includes('[참고 사진 · 연출용]'))
      assert.ok(!result.includes('나머지는 참고 사진을 따르세요'))
    }
    const withoutScale = { ...photos }; delete withoutScale.scale
    assert.ok(!buildStyledCutsPrompt(form, withoutScale, reference, {}, exploration).includes('착용자 키는 172'))
    form.modelHeightCm = ''
    assert.ok(!buildStyledCutsPrompt(form, photos, reference, {}, exploration).includes('착용자 키는'))
    form.referenceMode = 'single'
    assert.ok(!buildStyledCutsPrompt(form, photos, reference, {}, exploration).includes('room-A.png'))
  } finally { revokeExplorationPhotos(exploration) }
  assert.throws(() => createStyledPhoto(new File(['x'], 'x.txt', { type: 'text/plain' }), 'front'))
} finally {
  revokeProductPhotos(photos)
  URL.revokeObjectURL(reference.url)
}

for (const [type, extension] of [['image/png', 'png'], ['image/webp', 'webp']]) {
  const photo = createStyledPhoto(new File(['x'], 'same-name.jpg', { type }), 'front')
  try {
    assert.equal(photo.file.name, 'same-name.jpg', `원본 파일명을 유지한다: ${extension}`)
  } finally {
    URL.revokeObjectURL(photo.url)
  }
}
console.log('styled-cuts.verify ok — 사진 이름·내용 보존, 필수 사진, 입력값 반영 검증 완료')
