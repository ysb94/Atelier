import { formatSeasonLabel, type Season } from '@/lib/types'

export type ReleaseCertainty = 'tentative' | 'confirmed'

export const RELEASE_CERTAINTY_LABEL: Record<ReleaseCertainty, string> = {
  tentative: '가안',
  confirmed: '확정',
}

export type PreviewReleaseGroup = {
  id: string
  brandId: string
  name: string
  releaseTiming: string
}

export type PreviewReleaseAssignment = {
  brandId: string | null
  groupId: string | null
  targetDate: string | null
  certainty: ReleaseCertainty
}

export type ResolvedReleaseSchedule = {
  group: PreviewReleaseGroup | null
  targetDate: string | null
  certainty: ReleaseCertainty | null
  brandId: string | null
  isPreview: boolean
}

export function seasonToPreviewGroup(season: Season): PreviewReleaseGroup {
  return {
    id: season.id,
    brandId: season.brandId,
    name: season.name,
    releaseTiming: season.releaseTiming,
  }
}

export function formatReleaseGroupLabel(group: {
  name: string
  releaseTiming?: string | null
}) {
  return formatSeasonLabel(group)
}

export function newTempGroupId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `temp-${crypto.randomUUID()}`
  }
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function resolveReleaseSchedule(
  draft: { id: string; brandId: string | null; seasonId: string | null },
  seasonMap: Map<string, Season>,
  tempGroups: PreviewReleaseGroup[],
  assignments: Record<string, PreviewReleaseAssignment>,
): ResolvedReleaseSchedule {
  const assignment = assignments[draft.id]
  if (assignment) {
    if (!assignment.groupId) {
      return {
        group: null,
        targetDate: null,
        certainty: null,
        brandId: assignment.brandId ?? draft.brandId,
        isPreview: true,
      }
    }
    const season = seasonMap.get(assignment.groupId)
    const group =
      tempGroups.find((item) => item.id === assignment.groupId) ??
      (season ? seasonToPreviewGroup(season) : null)
    return {
      group,
      targetDate: assignment.targetDate,
      certainty: assignment.certainty,
      brandId: assignment.brandId ?? group?.brandId ?? draft.brandId,
      isPreview: true,
    }
  }

  const season = draft.seasonId ? seasonMap.get(draft.seasonId) : undefined
  if (!season) {
    return {
      group: null,
      targetDate: null,
      certainty: null,
      brandId: draft.brandId,
      isPreview: false,
    }
  }
  return {
    group: seasonToPreviewGroup(season),
    targetDate: null,
    certainty: 'tentative',
    brandId: draft.brandId,
    isPreview: false,
  }
}

export function formatTargetDate(value: string | null) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}
