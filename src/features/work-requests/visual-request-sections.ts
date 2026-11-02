import type { ContentBlock } from './work-request-types'

export const VISUAL_REQUEST_CATEGORIES = [
  { id: 'image', label: '이미지 작업', guide: [] },
  { id: 'video', label: '영상', guide: [] },
  { id: 'banner', label: '배너', guide: ['배너 용도', '적용 채널', '메인 타이틀', '서브 문구 및 혜택', '적용 기간', '이미지 사이즈 / 비율', '제품 및 참고 자료'] },
  { id: 'revision', label: '수정 요청', guide: [] },
  { id: 'promotion', label: '프로모션', guide: [] },
  { id: 'print', label: '인쇄', guide: [] },
  { id: 'advertising', label: '광고 소재', guide: ['광고 채널', '광고 유형 / 노출 위치', '광고 목적 / 대상 제품', '메인 타이틀', '서브 문구 및 혜택', '진행 기간', '이미지 사이즈 / 비율', '제품 및 참고 자료'] },
  { id: 'sns', label: 'SNS', guide: [] },
  { id: 'detail1', label: '상세(1)', guide: [] },
  { id: 'detail2', label: '상세(2)', guide: [] },
  { id: 'detail3', label: '상세(3)', guide: [] },
] as const

export type VisualCategoryId = string
export type VisualSectionId = 'main' | VisualCategoryId
const SECTION_PREFIX = 'visual-request-section:'

export function visualSectionTitle(category: { label: string }): string {
  if (category.label.endsWith('요청')) return category.label
  if (category.label.endsWith('작업')) return `${category.label} 요청`
  return `${category.label} 작업 요청`
}

// 분류 제목도 기존 본문 텍스트 블록으로 보관한다. 기존 상세·첨부 저장 경로를 그대로 쓴다.
export function visualSectionId(block: ContentBlock): VisualCategoryId | null {
  if (block.type !== 'text' || !block.id.startsWith(SECTION_PREFIX)) return null
  const id = block.id.slice(SECTION_PREFIX.length)
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) && id !== 'main' ? id : null
}

export function splitVisualSections(blocks: ContentBlock[]): Map<VisualSectionId, ContentBlock[]> {
  const sections = new Map<VisualSectionId, ContentBlock[]>([['main', []]])
  let section: VisualSectionId = 'main'
  for (const block of blocks) {
    const next = visualSectionId(block)
    if (next) {
      section = next
      if (!sections.has(section)) sections.set(section, [])
    } else {
      sections.get(section)!.push(block)
    }
  }
  return sections
}

export function setVisualSection(
  blocks: ContentBlock[],
  section: VisualSectionId,
  content: ContentBlock[] | null,
  categories: readonly { id: string; label: string }[] = VISUAL_REQUEST_CATEGORIES,
): ContentBlock[] {
  const sections = splitVisualSections(blocks)
  if (content === null) sections.delete(section)
  else sections.set(section, content)
  const result = [...(sections.get('main') ?? [])]
  for (const [id, items] of sections) {
    if (id === 'main') continue
    const category = categories.find(item => item.id === id)
    const previous = blocks.find(block => visualSectionId(block) === id)
    const title = category ? visualSectionTitle(category) : previous?.type === 'text' ? previous.text : '작업 요청'
    result.push({ id: `${SECTION_PREFIX}${id}`, type: 'text', text: title }, ...items)
  }
  return result
}
