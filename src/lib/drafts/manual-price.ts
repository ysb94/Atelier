import { COST_CURRENCY_LABEL, type DraftManualPrice } from '@/lib/types'
import { CHINA_TEAM_DESTINATION, SAMPLE_DESTINATIONS } from './sample-receipt'

export const DRAFT_PRICE_DESTINATIONS = [...SAMPLE_DESTINATIONS, { value: 'other', label: '기타 제조처' }] as const

export function isSharedDraftPriceDestination(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
}

export function isDraftManualPriceDestination(value: string) {
  return value !== CHINA_TEAM_DESTINATION.value &&
    (isSharedDraftPriceDestination(value) || DRAFT_PRICE_DESTINATIONS.some(option => option.value === value))
}

export function parseDraftManualAmount(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const amount = Number(value)
  return amount <= 99999999.99 ? amount : null
}

export function normalizeDraftManualPrice(value: DraftManualPrice | undefined): DraftManualPrice | undefined {
  if (!value || !isDraftManualPriceDestination(value.destination) || typeof value.vendor !== 'string' ||
    (isSharedDraftPriceDestination(value.destination) &&
      (typeof value.destinationLabel !== 'string' || !value.destinationLabel.trim() || value.destinationLabel.length > 40)) ||
    !Object.hasOwn(COST_CURRENCY_LABEL, value.currency) || !Number.isFinite(Date.parse(value.savedAt)) ||
    !value.amounts || typeof value.amounts !== 'object' || Array.isArray(value.amounts)) return undefined
  const amounts = Object.fromEntries(Object.entries(value.amounts).filter(([, amount]) =>
    typeof amount === 'number' && parseDraftManualAmount(String(amount)) !== null))
  return Object.keys(amounts).length ? { ...value, amounts } : undefined
}
