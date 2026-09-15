import { FIXED_PROMPT } from './styled-cuts.ts'
import type { StudioState, StudioVersion } from './styled-studio'
import { validateImageRequest, type StyledDirectorModelId, type StyledImageModelId, type StyledImageRequest } from '../../../supabase/functions/_shared/styled-image-core.ts'

export function prepareStudioGeneration(input: {
  state: StudioState; modelId: StyledImageModelId; directorModelId?: StyledDirectorModelId; request: string
  products: string[]; references: string[]; roles: Record<string, string>; parent?: StudioVersion; additionalImages?: Record<string, string>
}): StyledImageRequest {
  const { state, parent } = input
  if (parent && !parent.resultId) throw new Error('생성된 결과를 선택한 뒤 수정해 주세요.')
  if (!parent && !input.products.length) throw new Error('제품 사진을 먼저 등록해 주세요.')
  const ids = generationAssetIds(input)
  if (!ids.length) throw new Error('이어가기에 사용할 이미지를 체크해 주세요.')
  const images = ids.map((id) => {
    const asset = state.assets[id]
    if (!asset) throw new Error('선택한 이미지가 없습니다. 참고 이미지를 다시 골라 주세요.')
    return {
      name: asset.name, data: asset.data,
      role: parent ? input.additionalImages?.[id] ?? '요청 참고' : input.references.includes(id) ? '연출 레퍼런스' : input.roles[id] ?? '제품 사진',
    }
  })
  const editTargetIndex = images.findIndex((image) => image.role === '편집 대상')
  const prompt = [
    FIXED_PROMPT,
    '독립된 완성 이미지 한 장만 출력하세요. 콜라주·분할 화면은 사용하지 마세요.',
    parent
      ? [
        '이번 요청에는 사용자가 체크한 사진만 첨부되어 있습니다. 체크하지 않은 이전 시안·제품 원본·참고사진은 전달되지 않았습니다. 보이지 않는 이전 사진을 보았다고 말하거나 사용하지 마세요.',
        editTargetIndex >= 0 ? `사진 ${editTargetIndex + 1}번이 편집 대상입니다. 이번 요청에 해당하는 부분을 수정하고 그 외 부분은 유지하세요.` : '편집 대상으로 지정된 사진은 없습니다. 첨부된 사진과 이번 요청을 기준으로 장면을 구성하세요. 이전 시안을 보존한다는 가정은 하지 마세요.',
        '모든 첨부 사진을 확인하세요. [요청 참고] 사진은 배경으로 한정하지 말고 사용자 요청에 따라 제품·색상·소재·디테일·구도 중 무엇을 반영할지 해석하세요. 명확하지 않으면 확인 질문을 하세요. [연출 레퍼런스]는 배경·구도·조명만 참고합니다. 사진 번호로 각 자료의 쓰임을 구체적으로 정리하세요.',
      ].join('\n')
      : '연출 레퍼런스는 배경·구도·조명만 참고하고 제품 정체성을 복사하지 마세요.',
    `사진 순서와 역할:\n${images.map((image, index) => `${index + 1}. [${image.role}] ${image.name}`).join('\n')}`,
    `제품: ${parent?.productInfo ?? [state.form.productName || '미입력', state.form.fabricMaterial || '소재 미입력', `가로 ${state.form.sizeWidth || '미입력'} × 세로 ${state.form.sizeHeight || '미입력'} × 폭 ${state.form.sizeDepth || '미입력'} mm`].join(' · ')}`,
    `출력 비율: ${state.form.outputRatio}`,
    `이번 요청:\n${input.request.trim()}`,
  ].join('\n\n')
  return validateImageRequest({ modelId: input.modelId, directorModelId: input.directorModelId, prompt, ratio: state.form.outputRatio, images })
}

export function generationAssetIds(input: { state: StudioState; products: string[]; references: string[]; parent?: StudioVersion; additionalImages?: Record<string, string> }) {
  if (input.parent) return Object.keys(input.additionalImages ?? {})
  return [...new Set([...input.products, ...input.references])]
}
