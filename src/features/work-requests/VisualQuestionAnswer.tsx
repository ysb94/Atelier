import { useId, useRef, type ComponentType, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import {
  isTypedVisualQuestion,
  readVisualQuestionAnswer,
  writeVisualQuestionAnswer,
  type VisualAnswerMedia,
} from './visual-question-content'
import type { VisualField } from './visual-request-config'
import type { ContentBlock } from './work-request-types'

export type VisualAnswerEditorOptions = {
  label: string
  descriptionId?: string
  required: boolean
  singleLine: boolean
  control?: ReactNode
}

type AnswerBodyProps = {
  blocks: ContentBlock[]
  placeholder: string
  onChange: (blocks: ContentBlock[]) => void
  appendFilesRef: { current: (files: File[]) => void }
  visualAnswer: VisualAnswerEditorOptions
}

export function VisualQuestionAnswer({ field, categoryId, value, media, BodyEditor, onChange }: {
  field: VisualField
  categoryId: string
  value: string
  media?: VisualAnswerMedia[]
  BodyEditor: ComponentType<AnswerBodyProps>
  onChange: (answer: ReturnType<typeof writeVisualQuestionAnswer>) => void
}) {
  const description = useId()
  const descriptionId = field.placeholder.trim() ? description : undefined
  const appendFilesRef = useRef<(files: File[]) => void>(() => {
    console.warn('[work-request] 답변 첨부 입력기가 연결되지 않았습니다.')
  })
  const typed = isTypedVisualQuestion(field.type)
  const blocks = readVisualQuestionAnswer(`${categoryId}:${field.id}`, typed ? '' : value, media)

  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="wrap-anywhere text-sm font-semibold">
        {field.label}{field.required && <span aria-hidden="true" className="ml-1 text-danger">*</span>}
      </h3>
      {descriptionId && <p id={descriptionId} className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">{field.placeholder}</p>}
      <BodyEditor
        blocks={blocks}
        placeholder="여기에 답변을 작성하세요."
        appendFilesRef={appendFilesRef}
        onChange={next => onChange(writeVisualQuestionAnswer(field.id, next, typed ? value : undefined))}
        visualAnswer={{
          label: field.label, descriptionId, required: field.required, singleLine: field.type === 'text',
          control: typed ? <Input type={field.type} value={value} required={field.required}
            step={field.type === 'number' ? 'any' : undefined} aria-label={field.label} aria-describedby={descriptionId}
            className="h-8 w-fit max-w-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-1"
            onChange={event => onChange(writeVisualQuestionAnswer(field.id, blocks, event.target.value))}
            onPaste={event => {
              const files = Array.from(event.clipboardData.files)
              if (!files.length) return
              event.preventDefault()
              appendFilesRef.current(files)
            }} /> : undefined,
        }}
      />
    </section>
  )
}
