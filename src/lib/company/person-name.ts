/**
 * 본명 형식. DB `profiles_display_name_format_check`와 같은 규칙이다.
 * 텍스트만으로 법적 본명인지는 증명하지 않는다.
 */

const PERSON_NAME_PATTERN = /^[\p{L}][\p{L}\s'’·.-]*[\p{L}.]$/u

export function normalizePersonName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export function personNameError(value: string): string | null {
  const name = normalizePersonName(value)
  if (!name) return '본명을 입력하세요.'
  if ([...name].length < 2 || [...name].length > 50) {
    return '본명은 2~50자여야 합니다.'
  }
  if (!PERSON_NAME_PATTERN.test(name)) {
    return '본명은 문자와 공백, 하이픈, 아포스트로피, 가운데점, 마침표만 쓸 수 있습니다.'
  }
  return null
}

export function validatePersonName(value: string): string {
  const error = personNameError(value)
  if (error) throw new Error(error)
  return normalizePersonName(value)
}

/** 한글 세 글자 이름은 성을 뺀 두 글자, 영문은 단어 앞 글자 두 개. */
export function personInitials(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? ''
  if (!trimmed) return '?'
  if (/^[가-힣]{3}$/.test(trimmed)) return trimmed.slice(1)
  if (/^[가-힣]{1,2}$/.test(trimmed)) return trimmed
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length >= 2 && /^[A-Za-z]/.test(words[0] ?? '')) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
  }
  return trimmed.slice(0, 1).toUpperCase()
}
