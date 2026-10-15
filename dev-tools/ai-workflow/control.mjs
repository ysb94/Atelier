import { validateBranchName } from './git-task.mjs'
import { koreanTime } from './report.mjs'

const plain = items => (items ?? []).map(v => v.plain_text ?? v.text?.content ?? '').join('')

// Exact Notion names on the dedicated settings page (config.v2.controlPageId).
export const CONTROL_PROPERTIES = Object.freeze({
  gptModel: { name: 'GPT 모델', type: 'select' },
  gptEffort: { name: 'GPT 추론', type: 'select' },
  cursorModel: { name: 'Cursor 모델', type: 'select' },
  enabled: { name: '자동화 실행', type: 'checkbox' },
  baseBranch: { name: '기준 브랜치', type: 'rich_text' },
  integrationBranch: { name: '통합 브랜치', type: 'rich_text' },
  runStatus: { name: '실행 상태', type: 'rich_text' },
})

export const REFLECTION = Object.freeze({ waiting: '통합 대기', reviewing: '통합 검수 중', main: 'main 반영 완료' })

// Task board properties added by v2; config.properties maps keys to these names.
export const TASK_PROPERTIES = Object.freeze({
  branch: { name: 'GitHub 브랜치', type: 'rich_text' },
  pr: { name: 'GitHub PR', type: 'url' },
  reflection: { name: '반영 상태', type: 'select', options: Object.values(REFLECTION) },
  model: { name: '실행 모델', type: 'rich_text' },
  baseCommit: { name: '기준 커밋', type: 'rich_text' },
})

// Shared support list. `max` is included. `minimal` is absent until a model catalog confirms it.
export const GPT_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
export const GPT_MODEL_EFFORTS = Object.freeze({
  'gpt-6.1-sol': Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
})
export function effortsForModel(model) {
  return Object.prototype.hasOwnProperty.call(GPT_MODEL_EFFORTS, model) ? GPT_MODEL_EFFORTS[model] : GPT_EFFORTS
}
export const DEFAULT_CONTROLS = Object.freeze({ gptModel: 'gpt-6.1-sol', gptEffort: 'high', cursorModel: 'grok-4.7-xhigh-fast',
  baseBranch: 'save/automation-progress-20261013', integrationBranch: 'integration/automation-review' })

// Catalogs change often; accept any well-formed id and let the provider reject it visibly.
export const safeModelId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)

export function controlDefaults(config) {
  return { ...DEFAULT_CONTROLS, ...(config.v2?.defaults ?? {}) }
}

// Schema for the operator's one-time Notion setup; the manager never creates pages.
export function setupSchema(config) {
  const positions = Object.values(config.positions ?? {}).filter(Boolean)
  return { controlPage: CONTROL_PROPERTIES, taskProperties: TASK_PROPERTIES, locationOptions: positions, defaults: controlDefaults(config) }
}

export function validateControlValues(values) {
  const problems = []
  if (!safeModelId(values.gptModel)) problems.push(`GPT 모델 값이 올바르지 않습니다: ${values.gptModel}`)
  const efforts = effortsForModel(values.gptModel)
  if (!efforts.includes(values.gptEffort)) problems.push(`GPT 추론 값은 ${efforts.join('/')} 중 하나여야 합니다: ${values.gptEffort}`)
  if (!safeModelId(values.cursorModel)) problems.push(`Cursor 모델 값이 올바르지 않습니다: ${values.cursorModel}`)
  for (const [key, role] of [['baseBranch', 'base'], ['integrationBranch', 'integration']]) {
    try { validateBranchName(values[key], { role }) } catch (error) { problems.push(error.message) }
  }
  if (values.baseBranch === values.integrationBranch) problems.push('기준 브랜치와 통합 브랜치는 달라야 합니다.')
  return problems
}

export async function readControls(notion, config) {
  const id = config.v2?.controlPageId
  if (!id) return { ok: false, problems: ['설정 페이지가 지정되지 않았습니다. config.json의 v2.controlPageId를 입력한 뒤 관리자를 다시 시작하세요.'] }
  const page = await notion.api(`pages/${id}`)
  const defaults = controlDefaults(config), values = {}, problems = []
  for (const [key, { name, type }] of Object.entries(CONTROL_PROPERTIES)) {
    const property = page.properties?.[name]
    if (!property || property.type !== type) { problems.push(`설정 페이지 속성 누락 또는 형식 오류: ${name} (${type})`); continue }
    if (type === 'select') {
      const selected = property.select?.name?.trim() || ''
      if (key === 'gptModel' || key === 'gptEffort' || key === 'cursorModel') {
        if (!selected) { problems.push(`${name} 선택이 비어 있습니다. 기본 모델로 대체하지 않습니다.`); continue }
        values[key] = selected
      } else values[key] = selected || defaults[key]
    }
    else if (type === 'checkbox') values[key] = property.checkbox === true
    else values[key] = key === 'runStatus' ? plain(property.rich_text) : plain(property.rich_text).trim() || defaults[key]
  }
  if (!problems.length) problems.push(...validateControlValues(values))
  return { ok: !problems.length, problems, values, editedAt: page.last_edited_time }
}

// Only model choices identify a model block; branch edits do not unblock it.
export const modelKey = values => JSON.stringify([values?.gptModel, values?.gptEffort, values?.cursorModel])

export function snapshotSettings(values) {
  return { gpt: { model: values.gptModel, effort: values.gptEffort }, cursorModel: values.cursorModel,
    baseBranch: values.baseBranch, integrationBranch: values.integrationBranch, snapshotAt: new Date().toISOString() }
}

export async function writeRunStatus(notion, config, text) {
  const id = config.v2?.controlPageId
  if (!id) return
  const content = `${text}\n(${koreanTime(new Date())} 한국시간)`.slice(0, 1900)
  await notion.api(`pages/${id}`, 'PATCH', { properties: { [CONTROL_PROPERTIES.runStatus.name]: { rich_text: [{ type: 'text', text: { content } }] } } })
}
