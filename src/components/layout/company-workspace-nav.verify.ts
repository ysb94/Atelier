import assert from 'node:assert/strict'
import { companyNavGroups, departmentSidebarLabel, insertMissingDepartmentGroups, missingDepartmentNavGroups } from './company-workspace-nav.ts'

assert.equal(departmentSidebarLabel('OFF LINE TEAM'), 'OFF LINE')
assert.equal(departmentSidebarLabel('Contents Team'), 'Contents')
assert.equal(departmentSidebarLabel('B2B 사업팀'), 'B2B 사업')
assert.equal(departmentSidebarLabel('중국팀'), '중국')

const departments = [
  '운영진', 'Contents Team', 'Global Online', '기획팀', 'Visual Team', 'MD Team', '물류팀',
  'B2B 사업팀', 'OFF LINE TEAM', 'CHINA', '운영지원팀', '중국팀', '마케팅팀',
].map(name => ({ name }))
const missing = missingDepartmentNavGroups(departments, companyNavGroups)
assert.deepEqual(missing.map(group => group.title), ['Contents', 'Global Online', 'B2B 사업', 'OFF LINE', 'CHINA', '마케팅'])
assert.equal(missing.some(group => group.title === 'Visual'), false, 'Visual Team은 디자인 메뉴를 이름만 바꾼 것이다')
assert.equal(companyNavGroups.some(group => group.title === 'Visual'), true)
assert.equal(companyNavGroups.some(group => group.title === '디자인'), false)
assert.ok(missing.every(group => group.items.length === 0))

const inserted = insertMissingDepartmentGroups(companyNavGroups, departments)
const titles = inserted.map(group => group.title)
assert.equal(titles.includes('운영진'), false)
assert.ok(titles.indexOf('Contents') < titles.indexOf('데이터'))
assert.equal(titles.filter(title => title === 'Visual').length, 1)
assert.equal(titles.includes('중국'), false)
