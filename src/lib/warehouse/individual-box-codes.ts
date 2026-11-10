export const MAX_INDIVIDUAL_BOX_CODES = 200

/** Korea date plus ten random digits, preserving any leading zero. */
export function generateIndividualBoxCodes(count: number, excluded: Iterable<string> = [], now = new Date()) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INDIVIDUAL_BOX_CODES) throw new Error('생성 개수는 1~200 사이의 정수로 입력해 주세요.')
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const date = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('')
  const used = new Set(excluded)
  const result: string[] = []
  for (let attempt = 0; result.length < count && attempt < count * 100; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(10))
    // Reject the uneven remainder so every digit has equal probability.
    if (bytes.some(byte => byte >= 250)) continue
    const suffix = Array.from(bytes, byte => String(byte % 10)).join('')
    const code = `ENJ-${date}-${suffix}`
    if (used.has(code)) continue
    used.add(code)
    result.push(code)
  }
  if (result.length !== count) throw new Error('서로 다른 번호를 생성하지 못했습니다. 다시 시도해 주세요.')
  return result
}
