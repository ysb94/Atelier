import { splitVisualSections, visualSectionId, visualSectionTitle } from './visual-request-sections'
import type { WorkRequestRecord } from './work-request-types'

export function visualWorkDetail(request: WorkRequestRecord, categories: readonly { id: string; label: string }[]) {
  const grouped = splitVisualSections(request.values.blocks)
  const saved = request.values.visualRequest?.categories ?? []
  const assignments = request.categoryAssignments ?? []
  const ids = new Set([...grouped.keys(), ...saved.map(item => item.id), ...assignments.map(item => item.categoryId)])
  ids.delete('main')
  return {
    main: grouped.get('main') ?? [],
    sections: [...ids].filter(id => /^[a-zA-Z0-9_-]{1,64}$/.test(id)).map(id => {
      const assignment = assignments.find(item => item.categoryId === id)
      const metadata = saved.find(item => item.id === id)
      const heading = request.values.blocks.find(block => visualSectionId(block) === id)
      const label = metadata?.label || assignment?.label || categories.find(item => item.id === id)?.label
        || (heading?.type === 'text' ? heading.text.replace(/ (?:작업 )?요청$/, '') : '') || '이전 분류'
      const fieldLabels = { ...Object.fromEntries((assignment?.formFields ?? []).map(field => [field.id, field.label])), ...metadata?.fieldLabels }
      return {
        id, label, title: visualSectionTitle({ label }), assignment,
        blocks: grouped.get(id) ?? [],
        fields: Object.entries(metadata?.fields ?? {}).filter(([, value]) => value.trim())
          .map(([key, value]) => ({ id: key, label: fieldLabels[key] ?? key, value })),
      }
    }),
  }
}

export type VisualWorkDetail = ReturnType<typeof visualWorkDetail>
