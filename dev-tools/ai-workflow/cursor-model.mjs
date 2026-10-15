import { ModelUnavailable } from './errors.mjs'

// Startup aliases that must not be accepted from the legacy variant list.
// Root verified: grok-4.7-xhigh-fast is base grok-4.7, reasoning_effort xhigh, fast true.
export const CURSOR_MODEL_ALIASES = Object.freeze({
  'grok-4.7-xhigh-fast': Object.freeze({ model: 'grok-4.7', reasoning_effort: 'xhigh', fast: true }),
})

const OPTION_IDS = Object.freeze({
  model: ['model', 'modelId'],
  reasoning_effort: ['reasoning_effort', 'reasoningEffort'],
  fast: ['fast', 'fastMode'],
})

const PARAMETER_TAIL = /-(?:minimal|low|medium|high|xhigh|max)(?:-fast)?$|-fast$/

export function configOptionsOf(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.configOptions)) return result.configOptions
  return []
}

export function findConfigOption(options, key) {
  const ids = OPTION_IDS[key] ?? [key]
  return options.find(option => ids.includes(option?.id) || ids.includes(option?.configId)) ?? null
}

export function choiceValues(option) {
  return (option?.options ?? option?.values ?? [])
    .map(item => (typeof item === 'string' ? item : item?.value))
    .filter(value => value != null)
}

export function currentValue(option) {
  if (!option) return null
  if (option.currentValue !== undefined) return option.currentValue
  if (option.selectedValue !== undefined) return option.selectedValue
  if (option.value !== undefined && typeof option.value !== 'object') return option.value
  return null
}

export function sameConfigValue(actual, expected) {
  const canon = value => {
    if (value === true || value === 'true') return 'true'
    if (value === false || value === 'false') return 'false'
    return String(value ?? '')
  }
  return canon(actual) === canon(expected)
}

export function coerceConfigValue(option, value) {
  if (option?.type === 'boolean' || typeof option?.currentValue === 'boolean') return value === true || value === 'true'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export function readEffectiveModel(options) {
  return {
    model: currentValue(findConfigOption(options, 'model')),
    reasoning_effort: currentValue(findConfigOption(options, 'reasoning_effort')),
    fast: currentValue(findConfigOption(options, 'fast')),
  }
}

// Known aliases win over a legacy variant id. Generic aliases split only when the provider lists every piece.
export function resolveCursorSelection(alias, options) {
  if (typeof alias !== 'string' || !alias) throw new ModelUnavailable('Cursor 모델이 비어 있습니다.', { provider: 'cursor', model: alias })
  const known = CURSOR_MODEL_ALIASES[alias]
  if (known) {
    if (!options.length) throw new ModelUnavailable(`Cursor 세션이 configOptions를 보고하지 않아 ${alias}의 모델·추론·fast를 확인하지 못했습니다. 기본 추론으로 낮춰 실행하지 않습니다.`, { provider: 'cursor', model: alias })
    return { ...known, parameterized: true }
  }
  const models = choiceValues(findConfigOption(options, 'model'))
  if (models.includes(alias)) return { model: alias, reasoning_effort: null, fast: null, parameterized: false }
  if (models.length) {
    const base = models.filter(id => alias.startsWith(`${id}-`)).sort((a, b) => b.length - a.length)[0]
    if (!base) throw new ModelUnavailable(`Cursor 모델 옵션에 ${alias}이(가) 없습니다.`, { provider: 'cursor', model: alias })
    let rest = alias.slice(base.length + 1)
    let fast = null
    if (rest === 'fast') { fast = true; rest = '' }
    else if (rest.endsWith('-fast')) { fast = true; rest = rest.slice(0, -5) }
    let reasoning = null
    if (rest) {
      const efforts = choiceValues(findConfigOption(options, 'reasoning_effort'))
      if (!efforts.includes(rest)) throw new ModelUnavailable(`모델 별칭 ${alias}의 '${rest}'를 제공자 옵션에서 확인하지 못했습니다. 추론 강도를 낮춰 실행하지 않습니다.`, { provider: 'cursor', model: alias })
      reasoning = rest
    }
    if (fast != null && !findConfigOption(options, 'fast')) throw new ModelUnavailable(`모델 별칭 ${alias}은 fast가 필요하지만 세션 옵션에 없습니다.`, { provider: 'cursor', model: alias })
    return { model: base, reasoning_effort: reasoning, fast, parameterized: reasoning != null || fast != null }
  }
  if (PARAMETER_TAIL.test(alias)) throw new ModelUnavailable(`Cursor 세션이 매개변수 모델 설정을 보고하지 않아 ${alias}을 확인하지 못했습니다. 기본값으로 실행하지 않습니다.`, { provider: 'cursor', model: alias })
  return { model: alias, reasoning_effort: null, fast: null, parameterized: false, legacy: true }
}

export async function applyCursorModel({ send, sessionId, options, selection, alias }) {
  let current = options
  const applied = []
  for (let pass = 0; pass < 3; pass++) {
    let changed = false
    for (const key of ['model', 'reasoning_effort', 'fast']) {
      if (selection[key] == null) continue
      const option = findConfigOption(current, key)
      if (!option?.id) throw new ModelUnavailable(`Cursor configOptions에 ${key}가 없습니다. ${alias}을 확인하지 못했습니다.`, { provider: 'cursor', model: alias })
      const choices = choiceValues(option)
      if (choices.length && !choices.some(value => sameConfigValue(value, selection[key]))) {
        throw new ModelUnavailable(`Cursor 제공 옵션에 ${key}=${selection[key]}가 없습니다. 다른 값으로 바꾸지 않습니다.`, { provider: 'cursor', model: alias })
      }
      if (!sameConfigValue(currentValue(option), selection[key])) {
        const result = await send('session/set_config_option', { sessionId, configId: option.id, value: coerceConfigValue(option, selection[key]) })
        const next = configOptionsOf(result)
        if (!next.length) throw new ModelUnavailable(`session/set_config_option이 ${key} 설정 뒤 configOptions를 반환하지 않았습니다.`, { provider: 'cursor', model: alias })
        current = next
        changed = true
        applied.push(key)
      }
    }
    if (!changed) break
  }
  const effective = readEffectiveModel(current)
  for (const key of ['model', 'reasoning_effort', 'fast']) {
    if (selection[key] == null) continue
    if (!sameConfigValue(effective[key], selection[key])) {
      throw new ModelUnavailable(`Cursor 유효 설정이 요청과 다릅니다 (${key}: 요청 ${selection[key]}, 실제 ${effective[key] ?? '없음'}). 낮춘 설정으로 진행하지 않습니다.`, { provider: 'cursor', model: alias })
    }
  }
  return { effective, applied }
}
