import { useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Building2, ChevronLeft, ChevronRight, LayoutGrid, List, Search, Users, X } from 'lucide-react'
import type { OrgChartMember } from '@/lib/supabase/profiles'
import { personInitials } from '@/lib/company/person-name'
import { useRenderWatch } from '@/lib/diagnostics'
import { formatNumber } from '@/lib/utils'
import './org-directory.css'

type DirectoryTeam = { id: string; name: string; members: OrgChartMember[] }
const TEAM_PAGE_SIZE = 12
const PEOPLE_PAGE_SIZE = 30
const PREVIEW_SIZE = 3
const displayName = (member: OrgChartMember) => member.displayName?.trim() || '이름 없음'

export function OrgDirectory({ teams, loading, failed, titlesFailed, onRetry, onRetryTitles }: {
  teams: DirectoryTeam[]; loading: boolean; failed: boolean; titlesFailed: boolean
  onRetry: () => void; onRetryTitles: () => void
}) {
  useRenderWatch('OrgDirectory')
  const [search, setSearch] = useState('')
  const [departmentSearch, setDepartmentSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('all')
  const [view, setView] = useState<'teams' | 'people'>('teams')
  const [sort, setSort] = useState<'department' | 'name'>('department')
  const [page, setPage] = useState(1)
  const resultsRef = useRef<HTMLElement>(null)
  const needle = search.trim().toLocaleLowerCase('ko')
  const totals = useMemo(() => ({
    people: teams.reduce((sum, team) => sum + team.members.length, 0),
    departments: teams.filter(team => team.id !== 'unassigned').length,
    empty: teams.filter(team => team.id !== 'unassigned' && !team.members.length).length,
    unassigned: teams.find(team => team.id === 'unassigned')?.members.length ?? 0,
  }), [teams])
  const departmentNeedle = departmentSearch.trim().toLocaleLowerCase('ko')
  const navigationTeams = useMemo(() => teams.filter(team => team.name.toLocaleLowerCase('ko').includes(departmentNeedle)), [teams, departmentNeedle])
  const filteredTeams = useMemo(() => teams
    .filter(team => departmentId === 'all' || team.id === departmentId)
    .map(team => ({ ...team, members: team.members.filter(member =>
      [displayName(member), member.position, member.jobGrade, team.name].filter(Boolean).join(' ').toLocaleLowerCase('ko').includes(needle),
    ) }))
    .filter(team => team.members.length > 0 || (!needle || team.name.toLocaleLowerCase('ko').includes(needle))),
  [teams, departmentId, needle])
  const people = useMemo(() => {
    const rows = filteredTeams.flatMap(team => team.members.map(member => ({ member, team })))
    if (sort === 'name') rows.sort((a, b) => displayName(a.member).localeCompare(displayName(b.member), 'ko'))
    return rows
  }, [filteredTeams, sort])
  const pageSize = view === 'teams' ? TEAM_PAGE_SIZE : PEOPLE_PAGE_SIZE
  const itemCount = view === 'teams' ? filteredTeams.length : people.length
  const pageCount = Math.max(1, Math.ceil(itemCount / pageSize))
  const currentPage = Math.min(page, pageCount)
  const offset = (currentPage - 1) * pageSize
  const selectedTeam = teams.find(team => team.id === departmentId)
  const departmentCount = filteredTeams.filter(team => team.id !== 'unassigned').length
  const filtered = Boolean(needle) || departmentId !== 'all'
  const unavailable = loading || failed

  function selectDepartment(id: string) {
    setDepartmentId(id)
    setPage(1)
    if (id !== 'all') setView('people')
    resultsRef.current?.scrollIntoView({ block: 'start' })
  }
  function changePage(next: number) {
    setPage(next)
    resultsRef.current?.scrollIntoView({ block: 'start' })
  }
  function reset() { setSearch(''); setDepartmentSearch(''); setDepartmentId('all'); setPage(1) }
  function overview(next: 'teams' | 'people') { reset(); setView(next) }

  return <div className="org-directory">
    <header className="org-directory-heading">
      <div><span className="org-directory-eyebrow">E&J · ORGANIZATION</span><h1>조직도</h1><p>부서에서 팀을 찾고, 이름으로 동료를 찾아보세요.</p></div>
      <span className="org-directory-company"><Building2 size={16} />E&J<span>회사 공통 조직</span></span>
    </header>

    <div className="org-directory-summary" aria-label="등록된 조직 현황">
      <button type="button" onClick={() => overview('people')} disabled={unavailable}><span className="org-directory-summary-icon"><Users size={19} /></span><span>등록 직원<strong>{unavailable ? '—' : formatNumber(totals.people)}<small>명</small></strong></span></button>
      <button type="button" onClick={() => overview('teams')} disabled={unavailable}><span className="org-directory-summary-icon is-blue"><Building2 size={19} /></span><span>전체 부서<strong>{unavailable ? '—' : formatNumber(totals.departments)}<small>개</small></strong></span></button>
      <button type="button" onClick={() => { setSearch(''); selectDepartment('unassigned') }} disabled={unavailable}><span>소속 미지정<strong>{unavailable ? '—' : formatNumber(totals.unassigned)}<small>명</small></strong></span></button>
      <p>등록된 직원 기준입니다.{!unavailable && totals.empty > 0 && <span>직원 배치 전인 부서 {formatNumber(totals.empty)}개</span>}</p>
    </div>

    {failed && <div className="org-directory-notice" role="alert"><span>조직 정보를 불러오지 못했습니다.</span><button type="button" onClick={onRetry}>다시 불러오기</button></div>}
    {titlesFailed && <div className="org-directory-notice" role="alert"><span>직책·직급의 정렬 순서를 불러오지 못했습니다.</span><button type="button" onClick={onRetryTitles}>다시 불러오기</button></div>}

    <div className="org-directory-workspace">
      <aside className="org-departments" aria-label="부서 선택">
        <header><Building2 size={15} /><h2>부서</h2><span>{unavailable ? '—' : formatNumber(totals.departments)}</span></header>
        <div className="org-department-search"><Search size={14} aria-hidden="true" /><input aria-label="부서 찾기" placeholder="부서 찾기" value={departmentSearch} onChange={event => setDepartmentSearch(event.target.value)} disabled={unavailable} />{departmentSearch && <button type="button" aria-label="부서 찾기 지우기" onClick={() => setDepartmentSearch('')}><X size={13} /></button>}</div>
        <nav className="org-department-list" aria-label="부서 목록">
          <button type="button" aria-pressed={departmentId === 'all'} onClick={() => selectDepartment('all')} disabled={unavailable}><span>전체 부서</span><small>{unavailable ? '—' : formatNumber(totals.people)}</small></button>
          {!unavailable && navigationTeams.map(team => <button key={team.id} type="button" aria-pressed={departmentId === team.id} onClick={() => selectDepartment(team.id)}><span>{team.name}</span><small>{formatNumber(team.members.length)}</small></button>)}
          {!unavailable && !navigationTeams.length && <p className="org-directory-muted">{departmentNeedle ? '일치하는 부서가 없습니다.' : '등록된 부서가 없습니다.'}</p>}
        </nav>
        <footer>부서 옆 숫자는 등록 직원 수입니다.</footer>
      </aside>

      <section ref={resultsRef} className="org-directory-main" aria-label="부서와 직원 현황">
        <div className="org-directory-toolbar">
          <div className="org-directory-search"><Search size={17} aria-hidden="true" /><input aria-label="직원·부서·직책·직급 검색" placeholder="이름, 부서, 직책·직급 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} disabled={unavailable} />{search && <button type="button" aria-label="검색어 지우기" onClick={() => { setSearch(''); setPage(1) }}><X size={16} /></button>}</div>
          <div className="org-directory-view" role="group" aria-label="조직도 보기 방식"><button type="button" aria-pressed={view === 'teams'} onClick={() => { setView('teams'); setPage(1) }}><LayoutGrid size={14} />부서별 보기</button><button type="button" aria-pressed={view === 'people'} onClick={() => { setView('people'); setPage(1) }}><List size={15} />직원 목록</button></div>
        </div>
        <label className="org-department-mobile">부서 선택<select aria-label="부서 선택" value={departmentId} onChange={event => selectDepartment(event.target.value)} disabled={unavailable}><option value="all">전체 부서</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name} · {team.members.length}명</option>)}{departmentId === 'unassigned' && !totals.unassigned && <option value="unassigned">소속 미지정 · 0명</option>}</select></label>
        <div className="org-directory-results-heading">
          <div><h2>{departmentId === 'all' ? '전체 조직' : selectedTeam?.name ?? (departmentId === 'unassigned' ? '소속 미지정' : '선택한 부서')}</h2><span role="status">{loading ? '불러오는 중…' : failed ? '조직 정보를 확인해 주세요' : `${departmentId === 'all' ? `${formatNumber(departmentCount)}개 부서 · ` : ''}${formatNumber(people.length)}명${needle ? ' 검색됨' : ''}`}</span></div>
          <div>{filtered && <button type="button" className="org-directory-reset" onClick={reset}>선택 초기화<X size={12} /></button>}{view === 'people' && <select aria-label="직원 정렬" value={sort} onChange={event => { setSort(event.target.value as 'department' | 'name'); setPage(1) }}><option value="department">부서·직책순</option><option value="name">이름순</option></select>}</div>
        </div>

        {loading ? <div className="org-directory-empty" role="status"><Users size={30} /><h3>조직 정보를 불러오고 있습니다.</h3></div> : failed ? <div className="org-directory-empty"><Building2 size={30} /><p>다시 불러오면 부서와 직원이 표시됩니다.</p></div> : itemCount === 0 ? <div className="org-directory-empty"><Users size={30} /><h3>{needle ? '검색 결과가 없습니다.' : departmentId !== 'all' ? '배치된 직원이 없습니다.' : '아직 등록된 직원이 없습니다.'}</h3><p>{needle ? '다른 이름이나 부서명으로 검색해 보세요.' : '직원이 등록되면 이곳에 표시됩니다.'}</p>{filtered && <button type="button" onClick={reset}>전체 조직 보기</button>}</div> : view === 'teams' ? <div className="org-team-grid">
          {filteredTeams.slice(offset, offset + pageSize).map(team => <article key={team.id} className="org-team-card">
            <header><span className="org-team-symbol" aria-hidden="true">{team.id === 'unassigned' ? '—' : team.name.slice(0, 1)}</span><h3>{team.name}</h3><span>{formatNumber(team.members.length)}명</span></header>
            <ul>{team.members.slice(0, PREVIEW_SIZE).map(member => <li key={member.id}><span className="org-person-avatar" aria-hidden="true">{personInitials(member.displayName)}</span><span className="org-person-name">{displayName(member)}<small>{member.position?.trim() || member.jobGrade?.trim() || '직책·직급 미설정'}</small></span>{member.position?.trim() && member.jobGrade?.trim() && <span className="org-person-grade">{member.jobGrade}</span>}</li>)}</ul>
            {!team.members.length && <p className="org-team-vacant">아직 배치된 직원이 없습니다.</p>}
            <footer><span>{team.members.length > PREVIEW_SIZE ? `외 ${formatNumber(team.members.length - PREVIEW_SIZE)}명` : team.members.length ? '등록 직원 전체 표시' : '직원 배치 전'}</span><button type="button" onClick={() => selectDepartment(team.id)} aria-label={`${team.name} 직원 목록 보기`}>직원 목록<ArrowUpRight size={14} /></button></footer>
          </article>)}
        </div> : <div className="org-people-scroll" role="region" aria-label="직원 목록 표" tabIndex={0}><table className="org-people-table"><caption className="org-sr-only">부서별 등록 직원과 직책·직급</caption><thead><tr><th scope="col">직원</th><th scope="col">부서</th><th scope="col">직책</th><th scope="col">직급</th></tr></thead><tbody>{people.slice(offset, offset + pageSize).map(({ member, team }) => <tr key={member.id}><td><span className="org-person-cell"><span className="org-person-avatar" aria-hidden="true">{personInitials(member.displayName)}</span><strong>{displayName(member)}</strong></span></td><td>{team.name}</td><td>{member.position?.trim() || <span className="org-directory-muted">미설정</span>}</td><td>{member.jobGrade?.trim() || <span className="org-directory-muted">미설정</span>}</td></tr>)}</tbody></table></div>}

        {!unavailable && itemCount > 0 && <nav className="org-directory-pagination" aria-label="조직도 페이지 이동"><span>{formatNumber(offset + 1)}–{formatNumber(Math.min(offset + pageSize, itemCount))} / {formatNumber(itemCount)}{view === 'teams' ? '개 항목' : '명'}</span><div><button type="button" aria-label="이전 페이지" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage} / {pageCount}</span><button type="button" aria-label="다음 페이지" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}><ChevronRight size={16} /></button></div></nav>}
      </section>
    </div>
  </div>
}
