import { VISUAL_REQUEST_CATEGORIES } from './visual-request-sections'

export type VisualField = {
  id: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'date'
  required: boolean
  placeholder: string
}
export type VisualCategory = {
  id: string
  label: string
  enabled: boolean
  assigneeId: string
  fields: VisualField[]
}
export type VisualRequestValues = {
  categories: { id: string; label: string; fields: Record<string, string>; fieldLabels?: Record<string, string> }[]
}
export const DEFAULT_VISUAL_CATEGORIES: VisualCategory[] = VISUAL_REQUEST_CATEGORIES.map(category => ({
  id: category.id, label: category.label, enabled: true, assigneeId: '',
  fields: category.guide.map((label, index) => ({ id: `field-${index + 1}`, label, type: 'text', required: false, placeholder: '' })),
}))

export function validateVisualSettings(categories: VisualCategory[]): string | null {
  if (categories.length > 40) return '분류는 최대 40개까지 설정할 수 있습니다.'
  if (new Set(categories.map(item => item.label.trim())).size !== categories.length) return '분류 이름이 중복됩니다.'
  for (const category of categories) {
    if (!category.label.trim() || category.label.length > 80) return '분류 이름은 1~80자로 입력하세요.'
    if (category.fields.length > 30) return '분류별 입력 항목은 최대 30개입니다.'
    if (new Set(category.fields.map(field => field.label.trim())).size !== category.fields.length) return `${category.label}: 입력 항목 이름이 중복됩니다.`
    if (category.fields.some(field => !field.label.trim() || field.label.length > 100 || field.placeholder.length > 300)) return '입력 항목 이름과 안내 문구를 확인하세요.'
  }
  return null
}
