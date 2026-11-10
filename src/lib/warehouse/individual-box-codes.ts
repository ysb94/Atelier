export const MAX_INDIVIDUAL_BOX_CODES = 200
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Korea date, independent of the computer's timezone. Random suffix excludes I/O/0/1. */
export function generateIndividualBoxCodes(count: number, excluded: Iterable<string> = [], now = new Date()) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INDIVIDUAL_BOX_CODES) throw new Error('생성 개수는 1~200 사이의 정수로 입력해 주세요.')
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const date = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('')
  const used = new Set(excluded)
  const result: string[] = []
  for (let attempt = 0; result.length < count && attempt < count * 100; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const suffix = Array.from(bytes, byte => ALPHABET[byte & 31]).join('')
    if (!/[A-Z]/.test(suffix) || !/[2-9]/.test(suffix)) continue
    const code = `ENJ-${date}-${suffix}`
    if (used.has(code)) continue
    used.add(code)
    result.push(code)
  }
  if (result.length !== count) throw new Error('서로 다른 번호를 생성하지 못했습니다. 다시 시도해 주세요.')
  return result
}
