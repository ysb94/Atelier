/** 쉼표·슬래시·줄바꿈·세미콜론으로 나눈 뒤 빈 칸을 버린다. 선행 0은 유지한다. */
export function parseStyleNoList(raw: string): string[] {
  return raw
    .split(/[\n\r,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}
