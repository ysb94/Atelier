import { COST_CURRENCY_LABEL, type DraftManualPrice } from '@/lib/types'
import type { SharedDraftPriceDestination } from '@/lib/supabase/draft-price-requests'
import { CHINA_TEAM_DESTINATION, SAMPLE_DESTINATIONS } from './sample-receipt'

export const DRAFT_PRICE_DESTINATIONS = [...SAMPLE_DESTINATIONS, { value: 'other', label: '기타 제조처' }] as const

export type DraftPriceDestinationChoice = { value: string; label?: string }
export type DraftPriceDestinationOption = { value: string; label: string; revision: string | null }

export function draftPriceDestinationLabel(choice: DraftPriceDestinationChoice, rows?: readonly SharedDraftPriceDestination[]) {
  return rows?.find(row => !row.removed && (row.preset_key ?? row.id) === choice.value)?.name ??
    choice.label ?? DRAFT_PRICE_DESTINATIONS.find(option => option.value === choice.value)?.label
}

export function currentDraftManualPrice(manualPrice?: DraftManualPrice, requestedAt?: string) {
  return manualPrice && (!requestedAt || Date.parse(manualPrice.savedAt) >= Date.parse(requestedAt)) ? manualPrice : undefined
}

export function resolveDraftPriceDestinationOptions(rows: readonly SharedDraftPriceDestination[]) {
  const presets = DRAFT_PRICE_DESTINATIONS.flatMap(option => {
    const saved = rows.find(row => row.preset_key === option.value)
    return saved?.removed ? [] : [{ ...option, label: saved?.name ?? option.label, revision: saved?.revision ?? null }]
  })
  return [...presets, ...rows.filter(row => !row.preset_key && !row.removed)
    .map(row => ({ value: row.id, label: row.name, revision: row.revision }))]
}

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
    !Object.hasOwn(COST_CURRENCY_LABEL, value.currency) || !Number.isFinite(Date.parse(value.savedAt)) ||
    !value.amounts || typeof value.amounts !== 'object' || Array.isArray(value.amounts)) return undefined
  const label = typeof value.destinationLabel === 'string' ? value.destinationLabel.trim() : ''
  const destinationLabel = label && label.length <= 40 ? label : undefined
  if (isSharedDraftPriceDestination(value.destination) && !destinationLabel) return undefined
  const amounts = Object.fromEntries(Object.entries(value.amounts).filter(([, amount]) =>
    typeof amount === 'number' && parseDraftManualAmount(String(amount)) !== null))
  return Object.keys(amounts).length ? { ...value, destinationLabel, amounts } : undefined
}
