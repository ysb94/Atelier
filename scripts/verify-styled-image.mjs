import assert from 'node:assert/strict'
import {
  STYLED_IMAGE_MODELS, IMAGE_SIZES, validateImageRequest, openAiImageBody,
  geminiImageBody, parseGeneratedImage, HIGH_IMAGE_SIZES, imageQualities,
  isDirectorModelId, parseDirectorModels, preferredDirectorModelId, directorModelLabel,
} from '../supabase/functions/_shared/styled-image-core.ts'
import { directorBody, parseDirectorPlan, applyDirectorPlan } from '../supabase/functions/_shared/styled-director.ts'
import { prepareStudioGeneration, generationAssetIds } from '../src/lib/design/studio-generation.ts'
import { normalizeLibrary, addLibraryAssets, selectedProducts, insertAtCaret } from '../src/lib/design/studio-library.ts'
import { createInitialForm } from '../src/lib/design/styled-cuts.ts'

const data = 'data:image/png;base64,aGVsbG8='
const request = { modelId: 'gpt-image-2', prompt: '제품 사진 보존', ratio: '4:5', images: [{ name: '제품.png', role: '제품 기준', data }] }
assert.equal(validateImageRequest(request), request)
for (const value of [null, { ...request, modelId: 'gpt-5' }, { ...request, ratio: 'toString' }, { ...request, prompt: ' ' }, { ...request, images: [] }, { ...request, images: Array(15).fill(request.images[0]) }, { ...request, images: [{ ...request.images[0], data: 'https://private-network/image' }] }, { ...request, images: [{ ...request.images[0], data: 'data:image/svg+xml;base64,aGVsbG8=' }] }]) {
  assert.throws(() => validateImageRequest(value))
}
for (const model of STYLED_IMAGE_MODELS.filter((item) => item.provider === 'openai')) {
  const body = openAiImageBody({ ...request, modelId: model.id })
  assert.equal(body.get('model'), model.id)
  assert.equal(body.get('size'), '1024x1280')
  assert.equal(body.get('n'), '1', 'one API request only generates one image')
  assert.equal(body.get('input_fidelity'), null, 'unsupported input_fidelity is omitted')
  assert.equal(await body.getAll('image[]')[0].text(), 'hello', 'original bytes reach multipart upload')
}
for (const [ratio, size] of Object.entries(IMAGE_SIZES)) {
  const [w, h] = size.split('x').map(Number)
  const [a, b] = ratio.split(':').map(Number)
  assert.equal(w / h, a / b)
  assert.equal(w % 16, 0)
  assert.equal(h % 16, 0)
  assert.ok(w * h >= 655360)
}
const gemini = geminiImageBody({ ...request, modelId: 'gemini-3-pro-image' })
assert.equal(gemini.model, 'gemini-3-pro-image')
assert.equal(gemini.store, false)
assert.equal(gemini.response_format.aspect_ratio, '4:5')
assert.equal(gemini.response_format.mime_type, 'image/jpeg', 'Nano Banana Pro rejects PNG output with HTTP 400')
assert.equal(gemini.input[2].data, 'aGVsbG8=')
assert.equal(parseGeneratedImage('openai', { data: [{ b64_json: 'aGVsbG8=' }] }), data)
assert.equal(parseGeneratedImage('gemini', { steps: [
  { type: 'thought', content: [{ type: 'image', mime_type: 'image/png', data: 'YmFk' }] },
  { type: 'model_output', content: [{ type: 'text', text: 'done' }, { type: 'image', mime_type: 'image/png', data: 'aGVsbG8=' }] },
] }), data, 'only a final model image is returned')
assert.throws(() => parseGeneratedImage('gemini', { steps: [{ type: 'thought' }] }))
assert.throws(() => parseGeneratedImage('openai', { data: [] }))
assert.equal(parseGeneratedImage('gemini', { steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: 'aGVsbG8=' }] }] }), 'data:image/jpeg;base64,aGVsbG8=', 'JPEG output MIME is preserved for display and download')

const state = normalizeLibrary({ schema: 1, form: createInitialForm(), assets: Object.fromEntries(['product', 'reference', 'result', 'different'].map((id) => [id, { id, name: `${id}.png`, data, type: 'image/png' }])), product: {}, references: {}, versions: [], selectedId: null })
const input = { state, modelId: 'gpt-image-2', request: '이 제품으로 참고사진처럼 만들어줘', products: ['product'], references: ['reference'], roles: { product: '제품 기준' }, additionalImages: {product: '요청 참고', reference: '요청 참고'} }
const initial = prepareStudioGeneration(input)
assert.ok(initial.prompt.includes('펼치기·모양·구도 변경·제품 교체·여러 제품 합성을 허용'))
assert.ok(!initial.prompt.includes('Exclude people'))
assert.ok(initial.prompt.includes('첨부 2 = 사진 2'))
const parent = { id: 'version', title: '시안 1', created: '', request: '', prompt: initial.prompt, assetIds: ['product', 'reference'], inputRoles: { product: '제품 기준', reference: '연출 레퍼런스' }, resultId: 'result', favorite: false, productInfo: '원래 제품 · 가로 200 mm' }
const followup = { ...input, products: ['different'], request: '배경만 흰색으로', parent, additionalImages: { result: '편집 대상', product: '제품 기준' } }
const edited = prepareStudioGeneration(followup)
assert.deepEqual(generationAssetIds(followup), ['result', 'product'])
assert.deepEqual(edited.images.map((image) => image.name), ['사진 3', '사진 1'], 'editing retains original product even if uploads change')
assert.ok(!edited.prompt.includes('원래 제품 · 가로 200 mm'))
assert.ok(edited.prompt.includes('이번 요청:\n배경만 흰색으로'))
assert.equal(prepareStudioGeneration({...input, additionalImages:{product:'요청 참고'}, request:'사진 1의 가방을 펼쳐줘'}).images.length, 1)
console.log('styled-image: provider payloads, validation, final-image extraction, exact ratios, original-preserving edits passed')

for (const [ratio, size] of Object.entries(HIGH_IMAGE_SIZES)) {
  const [w, h] = size.split('x').map(Number)
  const [a, b] = ratio.split(':').map(Number)
  assert.equal(w / h, a / b)
  assert.ok(w % 16 === 0 && h % 16 === 0 && w * h <= 8294400 && Math.max(w, h) <= 3840)
  for (const model of STYLED_IMAGE_MODELS.filter((item) => item.provider === 'openai')) {
    for (const quality of imageQualities(model.id)) {
      const req = validateImageRequest({ ...request, ratio, modelId: model.id, settings: { resolution: '2K', quality } })
      assert.equal(openAiImageBody(req).get('size'), size)
      assert.equal(openAiImageBody(req).get('quality'), quality)
    }
  }
}
for (const resolution of ['1K', '2K', '4K']) {
  const req = validateImageRequest({ ...request, modelId: 'gemini-3-pro-image', settings: { resolution, quality: 'high' } })
  assert.equal(geminiImageBody(req).response_format.image_size, resolution)
  assert.equal(geminiImageBody(req).response_format.mime_type, 'image/jpeg')
}
for (const settings of [null, {}, { resolution: '4K', quality: 'high' }, { resolution: '2K', quality: 'max' }]) assert.throws(() => validateImageRequest({ ...request, settings }))
const plan = { summary: '원본 제품을 밝은 배경에 배치합니다.', prompt: '제품 원본의 형태·색상·끈 연결을 보존하고 참고사진의 조명을 따릅니다.', question: '' }
const payload = (content, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content } }] })
assert.deepEqual(parseDirectorPlan(payload(JSON.stringify(plan))), plan)
for (const bad of [payload('not json'), payload(JSON.stringify(plan), 'length'), payload('{}'), { choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }]) assert.throws(() => parseDirectorPlan(bad))
assert.throws(() => applyDirectorPlan(initial, { ...plan, question: '어떤 제품인가요?' }), 'clarification must stop generation')
assert.throws(() => applyDirectorPlan(initial, { ...plan, prompt: '' }))
const directed = applyDirectorPlan(initial, { ...plan, prompt: '사용자가 수정한 지시문' })
assert.ok(directed.prompt.startsWith(initial.prompt), 'immutable original instructions survive manual editing')
assert.ok(directed.prompt.endsWith('사용자가 수정한 지시문'))
assert.equal(directed.images, initial.images)
const director = directorBody(initial)
assert.equal(director.model, 'gpt-5.6-luna')
assert.equal(director.max_completion_tokens, 3500)
assert.equal(director.store, false)
assert.equal(director.messages[1].content[2].image_url.url, data, 'director receives original photos, not just filenames')
assert.ok(director.messages[1].content[3].text.includes('사진 2'))
assert.equal(directorBody({ ...initial, directorModelId: 'gpt-4.1' }).max_tokens, 3500)
assert.equal(directorBody({ ...initial, directorModelId: 'gpt-4.1' }).model, 'gpt-4.1')
assert.equal(validateImageRequest({ ...request, directorModelId: 'gpt-5.6-terra' }).directorModelId, 'gpt-5.6-terra')
assert.throws(() => validateImageRequest({ ...request, directorModelId: 'gpt-image-2' }))
assert.equal(directorModelLabel('gpt-5.6-terra'), 'GPT-5.6 Terra')
assert.equal(preferredDirectorModelId(['gpt-6-astra', 'gpt-5.6-luna', 'gpt-4.1-mini']), 'gpt-5.6-luna')
assert.ok(isDirectorModelId('gpt-6-astra') && isDirectorModelId('gpt-5.4-mini') && !isDirectorModelId('gpt-5-mini-2025-08-07') && !isDirectorModelId('gpt-4o-audio-preview'))
const listed = parseDirectorModels({ data: [
  { id: 'gpt-5.6-terra' }, { id: 'gpt-image-2' }, { id: 'gpt-5.6-terra' }, { id: 'gpt-4.1-mini-2025-04-14' }, { id: 'gpt-6-astra' },
] })
assert.deepEqual(listed.map((item) => item.modelId), ['gpt-6-astra', 'gpt-5.6-terra'])
console.log('styled-image: high resolution, model-specific quality, director contracts and preservation passed')
const attachedInput = { ...followup, additionalImages: { reference: '요청 참고', different: '원단 디테일' } }
const attached = prepareStudioGeneration(attachedInput)
assert.deepEqual(generationAssetIds(attachedInput), ['reference', 'different'], 'only checked photos are sent; no implicit parent or product')
assert.deepEqual(attached.images.map(i => i.role), ['이번 요청에서 용도 해석', '이번 요청에서 용도 해석'])
assert.deepEqual(attached.images.map(i => i.data), [state.assets.reference.data, state.assets.different.data])
assert.ok(attached.prompt.includes('고정된 제품/레퍼런스 구분은 없습니다'))
assert.ok(!attached.prompt.includes('첫 번째 사진은 편집 대상'))
assert.ok(attached.prompt.includes('첨부 1 = 사진 2'))
assert.throws(() => prepareStudioGeneration({ ...followup, additionalImages: {} }), /체크/)
assert.throws(() => prepareStudioGeneration({ ...followup, additionalImages: undefined }), /체크/)
assert.throws(() => prepareStudioGeneration({ ...followup, additionalImages: { missing: '요청 참고' } }))
const reordered = prepareStudioGeneration({ ...followup, additionalImages: { reference: '요청 참고', result: '편집 대상' } })
assert.ok(reordered.prompt.includes('첨부 2 = 사진 3'))
assert.deepEqual(reordered.images.map(i => i.name), ['사진 2', '사진 3'])
assert.equal(directorBody(attached).messages[1].content.filter(i => i.type === 'image_url').length, 2)
assert.equal(applyDirectorPlan(attached, plan).images, attached.images, 'director and generator use the same selected images')
console.log('styled-image: explicit selection only, reference roles, photo numbering, empty selection and shared payload passed')

assert.throws(() => prepareStudioGeneration({...input, request:'사진 3을 수정해줘'}), /사진 3/)
const numbered = addLibraryAssets(state, [{id:'next',name:'x',type:'image/png',data}])
assert.equal(numbered.assets.next.photoNo, 5)
const afterDelete = {...numbered, assets:{...numbered.assets}}; delete afterDelete.assets.reference
assert.equal(addLibraryAssets(afterDelete,[{id:'last',name:'y',type:'image/png',data}]).assets.last.photoNo,6)
const product = {id:'bag',name:'가방 A',width:'30',height:'20',depth:'10',unit:'cm',material:'니트',basis:'손잡이 제외',state:'펼친 상태'}
const linked = {...state,products:{bag:product},assets:{...state.assets,product:{...state.assets.product,productIds:['bag']},result:{...state.assets.result,productIds:['bag']}}}
assert.equal(selectedProducts(linked,['result'])[0].width,'30')
assert.equal(selectedProducts(linked,['reference']).length,0)
const noted = {...state, assets:{...state.assets, product:{...state.assets.product, note:'가로 30cm 니트 가방'}}}
assert.ok(prepareStudioGeneration({...input,state:noted}).prompt.includes('가로 30cm 니트 가방'))
assert.ok(prepareStudioGeneration({...input,state:noted}).prompt.includes('선택 정보'))
assert.ok(!prepareStudioGeneration({...input,state:noted,additionalImages:{reference:'요청 참고'}}).prompt.includes('가로 30cm 니트 가방'))
assert.ok(prepareStudioGeneration(input).prompt.includes('사진 1: 없음'))
assert.ok(prepareStudioGeneration({...input,state:linked}).prompt.includes('가로 30'))
assert.ok(!prepareStudioGeneration({...input,state:linked,additionalImages:{reference:'요청 참고'}}).prompt.includes('가로 30'))
assert.deepEqual(insertAtCaret('배경을처럼', '사진 1', 3), { text: '배경을 사진 1 처럼', caret: 9 })
assert.deepEqual(insertAtCaret('', '사진 2', 0), { text: '사진 2', caret: 4 })
assert.deepEqual(parseDirectorPlan(payload(JSON.stringify({...plan,outputProductIds:['bag']}))).outputProductIds,['bag'])
console.log('studio-library: stable labels, single-image edits, missing selections, photo notes and caret insert passed')
