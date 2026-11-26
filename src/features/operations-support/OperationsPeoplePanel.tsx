import { useSearchParams } from 'react-router-dom'
import { FilterTabs, type FilterTab } from '@/components/ui/filter-tabs'
import { OrgChartPage } from '@/features/org/OrgChartPage'
import { canManageCompanyDepartments, CompanyDepartmentsPanel, MembersPage } from '@/features/settings/MembersPage'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { canViewPeopleMembers, canViewPeopleOrg, OVERTIME_ROSTER_EMPLOYEE_PARAM } from './operations-support-sections'

type PeopleView = 'org' | 'members' | 'departments'

/** 조직·멤버의 각 탭에는 기존 화면의 진입 권한을 적용한다. */
export function OperationsPeoplePanel() {
  useRenderWatch('OperationsPeoplePanel')
  const { profile, session } = useAuth()
  const [params, setParams] = useSearchParams()
  const tabs: FilterTab<PeopleView>[] = [
    ...(canViewPeopleOrg(profile) ? [{ value: 'org' as const, label: '조직도' }] : []),
    ...(canViewPeopleMembers(profile) ? [{ value: 'members' as const, label: '멤버' }] : []),
    ...(canManageCompanyDepartments(profile, session?.user.id) ? [{ value: 'departments' as const, label: '회사 부서' }] : []),
  ]
  const view = tabs.find(tab => tab.value === params.get('peopleView'))?.value ?? tabs[0]?.value
  function setView(next: PeopleView) {
    setParams(previous => {
      const nextParams = new URLSearchParams(previous)
      if (next === 'org') nextParams.delete('peopleView')
      else nextParams.set('peopleView', next)
      nextParams.delete('orgView')
      nextParams.delete(OVERTIME_ROSTER_EMPLOYEE_PARAM)
      return nextParams
    }, { replace: true })
  }
  return <div className="space-y-5">
    {tabs.length > 1 && <FilterTabs<PeopleView> ariaLabel="조직·멤버 항목" value={view ?? 'org'} onChange={setView} variant="underline" size="large" tabs={tabs} />}
    {view === 'org' && <OrgChartPage mode="manage" showHeading={false} />}
    {view === 'members' && <MembersPage embedded />}
    {view === 'departments' && <CompanyDepartmentsPanel uiOnly />}
  </div>
}
