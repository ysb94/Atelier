export function elapsedMaterialRequestDays(from: number, to: number) {
  const day = 86_400_000
  const koreaOffset = 9 * 3_600_000
  return Math.max(0, Math.floor((to + koreaOffset) / day) - Math.floor((from + koreaOffset) / day))
}
