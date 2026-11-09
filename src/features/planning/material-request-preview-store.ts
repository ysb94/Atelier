import { useSyncExternalStore } from 'react'
import type { MaterialRequest } from './MaterialRequestDialog'

const empty: MaterialRequest[] = []
const requestsByCompany = new Map<string, MaterialRequest[]>()
const listeners = new Set<() => void>()

export function elapsedMaterialRequestDays(from: number, to: number) {
  const day = 86_400_000
  const koreaOffset = 9 * 3_600_000
  return Math.max(0, Math.floor((to + koreaOffset) / day) - Math.floor((from + koreaOffset) / day))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useMaterialRequestPreview(companyId: string) {
  const requests = useSyncExternalStore(subscribe, () => requestsByCompany.get(companyId) ?? empty)
  function update(change: (current: MaterialRequest[]) => MaterialRequest[]) {
    requestsByCompany.set(companyId, change(requestsByCompany.get(companyId) ?? empty))
    listeners.forEach(listener => listener())
  }
  return [requests, update] as const
}
