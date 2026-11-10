import { AttendanceLatePanel } from './AttendanceLatePanel'
import { type useOpsDirectory } from './ops-directory'
import { type useAttendanceStartSettings } from './use-attendance-start-settings'

export type CheckView = 'late' | 'missed'

/** 근태 > 확인 필요: 지각·결근·퇴근 미처리를 한 표로 본다. 주소의 checkView=missed는 퇴근 미처리 칩으로 연다. */
export function AttendanceCheckPanel({ view, onViewChange, directory, schedules }: {
  view: CheckView
  onViewChange: (view: CheckView) => void
  directory: ReturnType<typeof useOpsDirectory>
  schedules: ReturnType<typeof useAttendanceStartSettings>
}) {
  return <AttendanceLatePanel
    directory={directory}
    schedules={schedules}
    initialKind={view === 'missed' ? 'missed' : 'all'}
    onKindChange={kind => { const next: CheckView = kind === 'missed' ? 'missed' : 'late'; if (next !== view) onViewChange(next) }}
  />
}
