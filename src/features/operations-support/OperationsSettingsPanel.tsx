import { useSearchParams } from 'react-router-dom'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { useRenderWatch } from '@/lib/diagnostics'
import { AttendanceExemptionsPanel } from './AttendanceExemptionsPanel'
import { AttendanceStartSettingsPanel } from './AttendanceStartSettingsPanel'
import { CompanyHoursPanel } from './CompanyHoursPanel'
import { CompanyNoticesPanel } from './CompanyNoticesPanel'
import { useAttendanceDirectory } from './use-attendance-directory'
import { useAttendanceStartSettings } from './use-attendance-start-settings'

type SettingsView = 'notices' | 'hours' | 'exemptions'
const SETTINGS_VIEWS: readonly SettingsView[] = ['notices', 'hours', 'exemptions']

/** 회사 설정: 공지, 운영시간·출근 기준, 출퇴근 제외자. 각 패널의 권한 판정은 그대로 쓴다. */
export function OperationsSettingsPanel() {
  useRenderWatch('OperationsSettingsPanel')
  const [params, setParams] = useSearchParams()
  const view = SETTINGS_VIEWS.find(item => item === params.get('settingsView')) ?? 'notices'
  function setView(next: SettingsView) {
    setParams(previous => {
      const nextParams = new URLSearchParams(previous)
      nextParams.set('settingsView', next)
      nextParams.delete('startEmployee')
      nextParams.delete('startMonth')
      return nextParams
    }, { replace: true })
  }
  return <div className="space-y-5">
    <FilterTabs<SettingsView> ariaLabel="회사 설정 항목" value={view} onChange={setView} variant="underline" size="large" tabs={[{ value: 'notices', label: '공지' }, { value: 'hours', label: '운영시간 · 출근 기준' }, { value: 'exemptions', label: '출퇴근 제외자' }]} />
    {view === 'notices' && <CompanyNoticesPanel />}
    {view === 'hours' && <SettingsHoursView employeeId={params.get('startEmployee') ?? undefined} month={params.get('startMonth') ?? undefined} />}
    {view === 'exemptions' && <SettingsExemptionsView />}
  </div>
}

function SettingsHoursView({ employeeId, month }: { employeeId?: string; month?: string }) {
  const { directory } = useAttendanceDirectory()
  const saved = useAttendanceStartSettings()
  return <div className="space-y-8">
    <CompanyHoursPanel />
    <AttendanceStartSettingsPanel readOnly key={`${employeeId}:${month}`} directory={directory} schedules={saved} initialEmployeeId={employeeId} initialMonth={month} />
  </div>
}

function SettingsExemptionsView() {
  const { source } = useAttendanceDirectory()
  return <AttendanceExemptionsPanel directory={source} />
}
