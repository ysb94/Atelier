import type { StudioState, StudioVersion } from './styled-studio'
import { missingPhotoMentions, normalizeLibrary, photoLabel, photoNote, productDescription, selectedProducts } from './studio-library.ts'
import { validateImageRequest, type StyledDirectorModelId, type StyledImageModelId, type StyledImageRequest } from '../../../supabase/functions/_shared/styled-image-core.ts'

export function buildStudioGenerationRequest(input: {
  state: StudioState; modelId: StyledImageModelId; directorModelId?: StyledDirectorModelId; request: string
  products: string[]; references: string[]; roles: Record<string, string>; parent?: StudioVersion; additionalImages?: Record<string, string>
}): StyledImageRequest {
  const state = normalizeLibrary(input.state)
  const ids = generationAssetIds(input)
  if (!ids.length) throw new Error('이번 요청에 사용할 이미지를 체크해 주세요.')
  const missing = missingPhotoMentions(state, input.request, ids)
  if (missing.length) throw new Error(`요청에서 지칭한 ${missing.map(n => `사진 ${n}`).join(', ')}을 체크해 주세요. 등록되지 않은 번호라면 요청을 수정해 주세요.`)
  const images = ids.map(id => {
    const asset = state.assets[id]
    if (!asset) throw new Error('선택한 이미지가 없습니다. 다시 골라 주세요.')
    return { name: photoLabel(asset), data: asset.data, role: '이번 요청에서 용도 해석' }
  })
  const products = selectedProducts(state, ids)
  for (const p of products) for (const size of [p.width, p.height, p.depth]) {
    if (size.trim() && (!Number.isFinite(Number(size)) || Number(size) <= 0)) throw new Error(`${p.name}: 크기는 양수로 입력하거나 비워 주세요.`)
  }
  const prompt = [
    '사용자가 체크한 사진만 첨부되어 있습니다. 사진 번호는 고정 식별자이며 첨부 순서로 다시 번호를 붙이지 마세요. 체크하지 않은 이전 시안이나 원본을 보았다고 가정하지 마세요.',
    '사진의 용도는 이번 요청에서 판단하세요. 배경 참고, 편집 대상, 추가할 제품, 교체할 제품 등으로 쓰일 수 있으며 고정된 제품/레퍼런스 구분은 없습니다. 각 사진을 어디에 어떻게 사용할지 사진 번호로 설명하세요.',
    '사용자가 요청한 펼치기·모양·구도 변경·제품 교체·여러 제품 합성을 허용하세요. 요청하지 않은 부분의 색상·소재·로고·구조·배경은 유지하세요. 보이지 않는 내부 구조와 미입력 치수를 사실로 단정하지 마세요. 결과를 크게 바꾸는 모호함만 질문하세요.',
    '독립된 완성 이미지 한 장을 출력하세요. 분할 화면은 사용자가 요청한 경우만 허용합니다.',
    `첨부 순서와 고정 사진 이름:\n${images.map((image, i) => `첨부 ${i + 1} = ${image.name}`).join('\n')}`,
    `사진 설명:\n${ids.map(id => `${photoLabel(state.assets[id])}: ${photoNote(state.assets[id]) || '없음'}`).join('\n')}`,
    '사진 설명은 선택 정보입니다. 비어 있어도 생성을 막거나 설명을 요구하지 마세요. 설명이 있으면 해당 사진의 용도와 보이는 특징을 이해하는 보조 단서로만 쓰세요. 설명에 없는 치수·소재·구조를 사실로 단정하지 마세요.',
    `사진과 제품 연결:\n${ids.map(id => `${photoLabel(state.assets[id])}: ${(state.assets[id].productIds ?? []).filter(pid => products.some(p => p.id === pid)).map(pid => `제품ID ${pid}`).join(', ') || '제품 정보 미연결'}`).join('\n')}`,
    `연결된 제품 정보:\n${products.map(p => `제품ID ${p.id}: ${productDescription(p)}`).join('\n') || '없음 (선택 정보이므로 필수로 요구하지 마세요)'}`,
    '치수는 제품의 실제 상대 크기와 원근을 판단하는 기준입니다. 같은 제품의 여러 사진은 위 연결을 따르세요. 사진 속 픽셀 비율을 실측으로 간주하지 마세요. 출력에 실제로 포함할 제품ID만 outputProductIds로 반환하세요. 배경 참고로만 사용한 제품은 제외하세요.',
    `출력 비율: ${state.form.outputRatio}`,
    `이번 요청:\n${input.request.trim()}`,
  ].join('\n\n')
  return { modelId: input.modelId, directorModelId: input.directorModelId, prompt, ratio: state.form.outputRatio, images }
}
export function prepareStudioGeneration(input: Parameters<typeof buildStudioGenerationRequest>[0]): StyledImageRequest {
  return validateImageRequest(buildStudioGenerationRequest(input))
}
export function generationAssetIds(input: { state: StudioState; products: string[]; references: string[]; parent?: StudioVersion; additionalImages?: Record<string, string> }) {
  return Object.keys(input.additionalImages ?? {})
}
