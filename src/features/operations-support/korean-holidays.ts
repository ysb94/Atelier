import { y2018, y2019, y2020, y2021, y2022, y2023, y2024, y2025, y2026, y2027 } from '@hyunbinseo/holidays-kr/all'

// 관보·월력요항 기준. 설·추석, 대체공휴일, 임기만료 선거일, 국무회의 임시공휴일이 들어 있다.
const YEAR_HOLIDAYS = [y2018, y2019, y2020, y2021, y2022, y2023, y2024, y2025, y2026, y2027]
const HOLIDAYS: Record<string, readonly string[]> = Object.assign({}, ...YEAR_HOLIDAYS)
const COVERED_YEARS = new Set(YEAR_HOLIDAYS.flatMap((year) => Object.keys(year).map((date) => date.slice(0, 4))))
const warnedYears = new Set<string>()

export function koreanHolidayNames(dateKey: string): readonly string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return []
  const year = dateKey.slice(0, 4)
  if (!COVERED_YEARS.has(year)) {
    if (!warnedYears.has(year)) {
      warnedYears.add(year)
      console.warn('[attendance-work] 이 연도의 국가 공휴일 자료가 없습니다.', { year })
    }
    return []
  }
  return HOLIDAYS[dateKey] ?? []
}

export function koreanHolidayLabel(names: readonly string[]): string {
  return names.map(compactHolidayName).join('·')
}

function compactHolidayName(name: string): string {
  const substitute = /^대체공휴일\((.+)\)$/.exec(name)
  if (substitute) return `${substitute[1]} 대체`
  const temporary = /^임시공휴일\((.+)\)$/.exec(name)
  if (temporary) return temporary[1]
  return name
}
