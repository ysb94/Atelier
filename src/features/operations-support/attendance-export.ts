import { downloadExcelWorkbook } from '@/lib/export/product-workbook'
import type { OrgChartMember } from '@/lib/supabase/profiles'
import { ATTENDANCE_STATUSES, EMPTY_ATTENDANCE, formatTime, monthDates, recordTiming, type AttendanceRecords, type AttendanceSchedule, type MonthlyAttendance } from './monthly-attendance'

export type AttendanceRow = { member: OrgChartMember; team: string; schedule: AttendanceSchedule; summary: MonthlyAttendance; complete: boolean }

export async function exportAttendance(month: string, rows: AttendanceRow[], records: AttendanceRecords) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const summarySheet = workbook.addWorksheet('월별 요약')
  summarySheet.addRow(['화면 시안 입력값입니다. 출퇴근 원본·연차 시스템과 연결되지 않았습니다.'])
  summarySheet.addRow(['월', '이름', '부서', '출근 기준', '초과 기준(분)', '출근 기록일', '정시 이후', '기준 초과', '연차', '반차(회)', '예비군·공가', '결근', '미기록', '확인 필요', '평균 출근', '가장 이른 출근', '가장 늦은 출근', '월 검토'])
  for (const row of rows) {
    const s = row.summary
    summarySheet.addRow([month, row.member.displayName || '이름 없음', row.team, row.schedule.start || '미설정', row.schedule.grace, s.records, row.schedule.start ? s.after : null, row.schedule.start ? s.exceeded : null, s.annual, s.half, s.official, s.absent, s.missingDates.length, s.pending, formatTime(s.average), formatTime(s.earliest), formatTime(s.latest), row.complete ? '검토 완료' : '검토 전'])
  }
  summarySheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  summarySheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF386B9F' } }
  summarySheet.columns.forEach(column => { column.width = 16 })
  summarySheet.views = [{ state: 'frozen', ySplit: 2, xSplit: 3 }]
  const detailSheet = workbook.addWorksheet('날짜별 기록')
  detailSheet.addRow(['날짜', '이름', '부서', '상태', '출근', '퇴근', '해당 날짜 출근 기준', '정시 이후', '기준 초과', '확인', '메모'])
  for (const row of rows) for (const date of monthDates(month)) {
    const record = records[date]?.[row.member.id] ?? EMPTY_ATTENDANCE
    if (record.status === 'unset' && !record.note) continue
    const timing = recordTiming(record, row.schedule)
    detailSheet.addRow([date, row.member.displayName || '이름 없음', row.team, ATTENDANCE_STATUSES.find(item => item.id === record.status)?.label, record.start, record.end, record.expectedStart || (record.status === 'half-am' ? '' : row.schedule.start), timing.baseline == null ? '집계 제외' : timing.after ? '해당' : '', timing.baseline == null ? '집계 제외' : timing.exceeded ? '해당' : '', record.reviewed ? '확인 완료' : '', record.note])
  }
  detailSheet.columns.forEach(column => { column.width = 18 })
  detailSheet.views = [{ state: 'frozen', ySplit: 1 }]
  await downloadExcelWorkbook(workbook, `${month}_월별근태_시안.xlsx`)
}
