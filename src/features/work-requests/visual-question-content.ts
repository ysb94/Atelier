import type { ContentBlock, ImageContentBlock } from './work-request-types'
import type { VisualField } from './visual-request-config'

type VisualAnswerPlacement = { fieldId: string; textEnd?: number; lineBreak?: boolean; typed?: true }
export type VisualAnswerMedia = Exclude<ContentBlock, { type: 'text' }> & { visualAnswer: VisualAnswerPlacement }

export function isTypedVisualQuestion(type?: VisualField['type']): type is 'number' | 'date' {
  return type === 'number' || type === 'date'
}

function answerMedia(block: ContentBlock): VisualAnswerMedia | undefined {
  if (block.type === 'text') return undefined
  const tagged = block as Partial<VisualAnswerMedia>
  return typeof tagged.visualAnswer?.fieldId === 'string' ? block as VisualAnswerMedia : undefined
}

export function splitVisualQuestionContent(blocks: readonly ContentBlock[], fieldIds: readonly string[]) {
  const known = new Set(fieldIds)
  const answers = new Map<string, VisualAnswerMedia[]>()
  const body: ContentBlock[] = []
  for (const block of blocks) {
    const media = answerMedia(block)
    if (!media || !known.has(media.visualAnswer.fieldId)) {
      body.push(block)
      continue
    }
    const fieldId = media.visualAnswer.fieldId
    const list = answers.get(fieldId)
    if (list) list.push(media)
    else answers.set(fieldId, [media])
  }
  return { body, answers }
}

export function replaceVisualQuestionMedia(blocks: readonly ContentBlock[], fieldId: string, media: readonly ContentBlock[]) {
  return [...blocks.filter(block => answerMedia(block)?.visualAnswer.fieldId !== fieldId), ...media]
}

// Answer text keeps its existing field value. Files carry the split positions, and images
// keep their layout within each text flow. Older views can still find every attached file.
export function writeVisualQuestionAnswer(fieldId: string, blocks: readonly ContentBlock[], typedValue?: string) {
  let value = typedValue ?? ''
  let boundary: VisualAnswerPlacement | undefined
  const media: VisualAnswerMedia[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      if (typedValue !== undefined || !block.text) continue
      if (boundary && value && !value.endsWith('\n') && !block.text.startsWith('\n')) {
        value += '\n'
        boundary.lineBreak = true
      }
      value += block.text
      boundary = undefined
    } else {
      const visualAnswer: VisualAnswerPlacement = typedValue === undefined ? { fieldId } : { fieldId, typed: true }
      if (block.type === 'file' && typedValue === undefined) {
        visualAnswer.textEnd = value.length
        boundary = visualAnswer
      }
      media.push({ ...block, visualAnswer })
    }
  }
  return { value, media }
}

export function readVisualQuestionAnswer(key: string, value: string, media: readonly VisualAnswerMedia[] = []): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let start = 0
  let flowId = 'start'
  let images: ImageContentBlock[] = []
  const appendFlow = (end: number) => {
    blocks.push({ id: `visual-answer:${key}:${flowId}`, type: 'text', text: value.slice(start, end) }, ...images)
    images = []
  }
  for (const block of media) {
    if (block.type === 'image') {
      images.push(block)
      continue
    }
    const { textEnd, lineBreak } = block.visualAnswer
    const end = typeof textEnd === 'number' && Number.isSafeInteger(textEnd)
      ? Math.min(value.length, Math.max(start, textEnd)) : value.length
    appendFlow(end)
    blocks.push(block)
    flowId = block.id
    start = end + (lineBreak === true && value[end] === '\n' ? 1 : 0)
  }
  appendFlow(value.length)
  return blocks
}
