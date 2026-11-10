import { FilterTabs } from '@/components/ui/filter-tabs'
import { AttendanceDeferredClockOutPanel } from './AttendanceDeferredClockOutPanel'
import { AttendanceLatePanel } from './AttendanceLatePanel'
import { type useOpsDirectory } from './ops-directory'
import { type useAttendanceStartSettings } from './use-attendance-start-settings'

export type CheckView = 'late' | 'missed'

/** 근태 > 확인 필요: 운영지원이 확인할 예외(지각·결근, 퇴근 미처리)를 한 탭에서 전환한다. */
export function AttendanceCheckPanel({ view, onViewChange, directory, schedules, awaitingHr }: {
  view: CheckView
  onViewChange: (view: CheckView) => void
  directory: ReturnType<typeof useOpsDirectory>
  schedules: ReturnType<typeof useAttendanceStartSettings>
  awaitingHr?: number
}) {
  return <div className="space-y-4">
    <FilterTabs<CheckView>
      ariaLabel="확인 필요 항목"
      value={view}
      onChange={onViewChange}
      tabs={[
        { value: 'late', label: '지각·결근', ...(awaitingHr ? { count: awaitingHr } : {}) },
        { value: 'missed', label: '퇴근 미처리' },
      ]}
    />
    {view === 'late' ? <AttendanceLatePanel directory={directory} schedules={schedules} /> : <AttendanceDeferredClockOutPanel directory={directory} />}
  </div>
}
