import type { MaterialRequest } from '@/features/planning/MaterialRequestDialog'

type MaterialRound = MaterialRequest['rounds'][number]

export function materialAwaitingAssignment(round: MaterialRound, assigneeIds: ReadonlySet<string>, activeIds: ReadonlySet<string> | null) {
  return !round.shippedAt && (!round.assigneeId || !assigneeIds.has(round.assigneeId)
    || (activeIds !== null && !activeIds.has(round.assigneeId)))
}

export function managerMaterialGroups(requests: readonly MaterialRequest[], selectedId: string | null, assigneeIds: ReadonlySet<string>, activeIds: ReadonlySet<string> | null, showHistory = false) {
  return requests.flatMap(request => {
    if ((request.status === '완료') !== showHistory) return []
    const rounds = [...request.rounds].sort((a, b) => a.number - b.number)
    if (showHistory) return rounds.length ? [{ request, rounds }] : []
    if (selectedId === null) {
      return rounds.some(round => materialAwaitingAssignment(round, assigneeIds, activeIds)) ? [{ request, rounds }] : []
    }
    const latestForAssignee = rounds.filter(round => round.assigneeId === selectedId).at(-1)
    if (!latestForAssignee) return []
    // Previous rounds are context for the manager, including rounds assigned to a predecessor.
    return [{ request, rounds: rounds.filter(round => round.number <= latestForAssignee.number) }]
  })
}

export function latestMaterialAssignee(request: MaterialRequest, beforeRound: number) {
  return request.rounds.reduce<MaterialRound | undefined>((latest, round) =>
    round.number < beforeRound && round.assigneeId && (!latest || round.number > latest.number) ? round : latest, undefined)
}

export function workerMaterialGroups(requests: readonly MaterialRequest[], accountId: string) {
  return requests.flatMap(request => {
    if (request.status === '완료') return []
    const rounds = request.rounds.filter(round => round.assigneeId === accountId)
    return rounds.length ? [{ request, rounds: rounds.sort((a, b) => a.number - b.number) }] : []
  })
}
