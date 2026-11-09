export const MATERIAL_REQUESTS_PATH = '/planning/material-requests'

export type MaterialNudgeTarget = { scope: 'notice' | 'request'; id: string }

export function materialNudgeHref(target: MaterialNudgeTarget) {
  const parameter = target.scope === 'notice' ? 'nudge' : 'request'
  return MATERIAL_REQUESTS_PATH + '?' + new URLSearchParams({ [parameter]: target.id })
}

export function materialNudgeTarget(search: URLSearchParams): MaterialNudgeTarget | null {
  const notice = search.get('nudge')
  const id = notice ?? search.get('request')
  return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    ? { scope: notice !== null ? 'notice' : 'request', id }
    : null
}
