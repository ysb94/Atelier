import { DRAFT_INFORMATION_LABELS, type DraftInformationField } from '@/lib/drafts/color-spec'

export const DRAFT_VISUAL_INFORMATION_TABS = [
  { field: 'image', label: 'Image' },
  { field: 'html', label: 'html' },
] as const

export type DraftVisualInformationField = typeof DRAFT_VISUAL_INFORMATION_TABS[number]['field']
export type DraftInformationPanelField = DraftInformationField | DraftVisualInformationField

export const DRAFT_INFORMATION_PANEL_TABS = [
  { field: 'size', label: DRAFT_INFORMATION_LABELS.size },
  { field: 'fabric', label: DRAFT_INFORMATION_LABELS.fabric },
  { field: 'specDoc', label: DRAFT_INFORMATION_LABELS.specDoc },
  ...DRAFT_VISUAL_INFORMATION_TABS,
] as const
