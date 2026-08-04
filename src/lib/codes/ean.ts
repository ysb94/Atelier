/**
 * EAN-13(국내 KAN) 바코드 계산.
 * 88로 시작하는 국내 표준 바코드는 GS1 Korea 국가코드 880을 쓴다.
 */

const GS1_KR_PREFIX = '880'
const SERIAL_MAX = 99999

export function ean13CheckDigit(first12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(first12[i])
    sum += i % 2 === 0 ? digit : digit * 3
  }
  return (10 - (sum % 10)) % 10
}

export function withCheckDigit(first12: string): string {
  return `${first12}${ean13CheckDigit(first12)}`
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/** 입력값 검증 메시지. 통과하면 null */
export function describeEan13Problem(code: string): string | null {
  const trimmed = code.trim()
  if (!trimmed) return '바코드를 입력하세요.'
  if (!/^\d+$/.test(trimmed)) return '바코드는 숫자 13자리입니다.'
  if (trimmed.length !== 13) {
    return `바코드는 13자리여야 합니다. (현재 ${trimmed.length}자리)`
  }
  if (!isValidEan13(trimmed)) {
    const expected = ean13CheckDigit(trimmed.slice(0, 12))
    return `체크디지트가 맞지 않습니다. 마지막 자리는 ${expected}이어야 합니다.`
  }
  return null
}

/**
 * 브랜드별 업체코드 4자리.
 * GS1에서 실제 업체코드를 발급받으면 이 파생값을 브랜드 설정값으로 대체한다.
 */
export function brandCompanyCode(brandId: string): string {
  let hash = 0
  for (let i = 0; i < brandId.length; i += 1) {
    hash = (hash * 31 + brandId.charCodeAt(i)) % 10000
  }
  return String(hash).padStart(4, '0')
}

export function barcodePrefix(brandId: string): string {
  return `${GS1_KR_PREFIX}${brandCompanyCode(brandId)}`
}

/** 같은 프리픽스에서 아직 쓰지 않은 다음 일련번호로 바코드를 만든다 */
export function nextOwnBarcode(
  brandId: string,
  existingCodes: string[],
): string | null {
  const prefix = barcodePrefix(brandId)
  const serialLength = 12 - prefix.length

  let maxSerial = 0
  for (const code of existingCodes) {
    if (code.length !== 13 || !code.startsWith(prefix)) continue
    const serial = Number(code.slice(prefix.length, 12))
    if (Number.isFinite(serial)) maxSerial = Math.max(maxSerial, serial)
  }

  const nextSerial = maxSerial + 1
  if (nextSerial > SERIAL_MAX) return null

  return withCheckDigit(
    `${prefix}${String(nextSerial).padStart(serialLength, '0')}`,
  )
}
