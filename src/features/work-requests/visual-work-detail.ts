import { splitVisualSections, visualSectionId, visualSectionTitle } from './visual-request-sections'
import { hasRequestBody, type WorkRequestRecord } from './work-request-types'

export function visualWorkDetail(request: WorkRequestRecord, categories: readonly { id: string; label: string }[]) {
  const grouped = splitVisualSections(request.values.blocks)
  const saved = request.values.visualRequest?.categories ?? []
  const assignments = request.categoryAssignments ?? []
  const ids = new Set([...grouped.keys(), ...saved.map(item => item.id), ...assignments.map(item => item.categoryId)])
  ids.delete('main')
  const blocksFor = (id: string) => {
    const blocks = grouped.get(id) ?? []
    return hasRequestBody(blocks) ? blocks : []
  }
  return {
    main: blocksFor('main'),
    sections: [...ids].filter(id => /^[a-zA-Z0-9_-]{1,64}$/.test(id)).map(id => {
      const assignment = assignments.find(item => item.categoryId === id)
      const metadata = saved.find(item => item.id === id)
      const heading = request.values.blocks.find(block => visualSectionId(block) === id)
      const label = metadata?.label || assignment?.label || categories.find(item => item.id === id)?.label
        || (heading?.type === 'text' ? heading.text.replace(/ (?:작업 )?요청$/, '') : '') || '이전 분류'
      const fieldLabels = new Map(assignment?.formFields?.map(field => [field.id, field.label]))
      for (const [key, value] of Object.entries(metadata?.fieldLabels ?? {})) fieldLabels.set(key, value)
      for (const key of Object.keys(metadata?.fields ?? {})) {
        if (!fieldLabels.has(key)) fieldLabels.set(key, key)
      }
      return {
        id, label, title: visualSectionTitle({ label }), assignment,
        blocks: blocksFor(id),
        fields: Array.from(fieldLabels, ([key, label]) => ({ id: key, label, value: metadata?.fields?.[key] ?? '' })),
      }
    }),
  }
}

export type VisualWorkDetail = ReturnType<typeof visualWorkDetail>

export function visualWorkDate(value: string) {
  if (!value) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dateOnly ? `${value}T00:00:00` : value)
  if (!Number.isFinite(date.getTime())) return null

  const twoDigits = (part: number) => String(part).padStart(2, '0')
  const month = twoDigits(date.getMonth() + 1)
  const day = twoDigits(date.getDate())
  return {
    shortDate: `${month}/${day}`,
    fullDate: `${date.getFullYear()}.${month}.${day}`,
    time: dateOnly ? '' : `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`,
  }
}

export function downloadVisualWorkFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
