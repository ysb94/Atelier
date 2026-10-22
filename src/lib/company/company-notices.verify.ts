import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  COMPANY_NOTICE_SLOTS,
  companyNoticePhase,
  visibleCompanyNotices,
  type CompanyNotice,
} from './company-notices.ts'

const today = '2026-10-20'
const notice = (patch: Partial<CompanyNotice>): CompanyNotice => ({
  id: 'n',
  slot: 'my-attendance',
  departmentId: null,
  title: '안내',
  body: '내용',
  startsOn: null,
  endsOn: null,
  published: true,
  updatedAt: '2026-10-20T00:00:00.000Z',
  ...patch,
})

assert.equal(companyNoticePhase(notice({}), today), 'live')
assert.equal(companyNoticePhase(notice({ published: false }), today), 'hidden')
assert.equal(companyNoticePhase(notice({ startsOn: '2026-10-21' }), today), 'scheduled')
assert.equal(companyNoticePhase(notice({ endsOn: '2026-10-19' }), today), 'ended')
assert.equal(companyNoticePhase(notice({ startsOn: today, endsOn: today }), today), 'live')

const shown = visibleCompanyNotices(
  [
    notice({ id: 'dept-old', departmentId: 'design', updatedAt: '2026-10-01T00:00:00.000Z' }),
    notice({ id: 'company-new', updatedAt: '2026-10-19T00:00:00.000Z' }),
    notice({ id: 'other-dept', departmentId: 'logistics' }),
    notice({ id: 'draft', published: false }),
    notice({ id: 'company-old', updatedAt: '2026-10-01T00:00:00.000Z' }),
  ],
  today,
  'design',
)
assert.deepEqual(shown.map((item) => item.id), ['company-new', 'company-old', 'dept-old'])

const migration = [
  new URL('../../../supabase/migrations/20261020021000_company_notices.sql', import.meta.url),
  new URL('../../../supabase/migrations/20261020110000_company_notice_boards.sql', import.meta.url),
].map((url) => fs.readFileSync(url, 'utf8')).join('\n')
for (const slot of COMPANY_NOTICE_SLOTS) {
  assert.ok(migration.includes(`'${slot.id}'`), `${slot.label} 위치가 저장 검사에 없습니다.`)
}

console.log('company-notices.verify ok')
