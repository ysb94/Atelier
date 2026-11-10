import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FilterBar } from '@/components/ui/filter-bar'
import { ScopeCards, type ScopeCard } from '@/components/ui/scope-cards'
import { shiftMonth } from './monthly-attendance'
import type { useOpsDirectory } from './ops-directory'

/** 야근·외근 조회 조건. 부서 카드(cards)를 넘기면 부서 선택 상자 대신 카드로 고른다. */
export function WorkManagementFilters({ label, month, setMonth, search, setSearch, department, setDepartment, directory, cards }: {
  label: string; month: string; setMonth: (value: string) => void; search: string; setSearch: (value: string) => void
  department: string; setDepartment: (value: string) => void; directory: ReturnType<typeof useOpsDirectory>
  cards?: ScopeCard<string>[]
}) {
  const choose = (value: string) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) setMonth(value) }
  return <>{cards && <ScopeCards ariaLabel={`${label} 부서`} value={department} onChange={setDepartment} cards={cards} className="mb-3" />}<FilterBar>
    <Button size="icon" variant="outline" aria-label="이전 월" onClick={() => choose(shiftMonth(month, -1))}><ChevronLeft size={15} /></Button>
    <Input type="month" className="w-40" aria-label={`${label} 월`} value={month} onChange={event => choose(event.target.value)} />
    <Button size="icon" variant="outline" aria-label="다음 월" onClick={() => choose(shiftMonth(month, 1))}><ChevronRight size={15} /></Button>
    {!cards && <Select className="w-44" aria-label={`${label} 부서`} value={department} onChange={event => setDepartment(event.target.value)}><option value="all">전체 부서</option>{directory.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="unassigned">소속 없음</option></Select>}
    <Input className="min-w-44 flex-1" aria-label={`${label} 검색`} placeholder="직원·부서 검색" value={search} onChange={event => setSearch(event.target.value)} />
  </FilterBar></>
}
