import assert from 'node:assert/strict'
import { RELEASE_EXCEPTION_IDS } from '../../lib/company/release-access.ts'
import { DEVELOPER_OPERATOR_ID, clockInHiddenForOperator, developerCanSkipClockIn } from './clock-in-prompt.ts'

const [developer, seolbin, junyoung] = RELEASE_EXCEPTION_IDS
const employee = '790c4eb1-d8ca-4367-aacb-100cd64b9a3d'
assert.equal(developer, DEVELOPER_OPERATOR_ID)

assert.equal(clockInHiddenForOperator(employee, { operatorId: junyoung, targetId: employee }), true, '김준영이 직원 계정으로 들어가면 숨김')
assert.equal(developerCanSkipClockIn(employee, { operatorId: junyoung, targetId: employee }), false)
assert.equal(clockInHiddenForOperator(employee, { operatorId: developer, targetId: employee }), false, '개발자가 직원 계정으로 들어가면 출근 버튼을 보여 줌')
assert.equal(developerCanSkipClockIn(employee, { operatorId: developer, targetId: employee }), true, '개발자는 출근을 건너뛸 수 있음')
assert.equal(clockInHiddenForOperator(employee, { operatorId: seolbin, targetId: employee }), true, '윤설빈이 직원 계정으로 들어가면 숨김')
assert.equal(developerCanSkipClockIn(employee, { operatorId: seolbin, targetId: employee }), false)
assert.equal(clockInHiddenForOperator(employee, null), false, '본인 로그인은 출근 버튼을 보여 줌')
assert.equal(developerCanSkipClockIn(developer, null), false, '개발자 본인 계정에는 건너뛰기를 두지 않음')
assert.equal(clockInHiddenForOperator(junyoung, { operatorId: junyoung, targetId: junyoung }), false, '대표 본인 계정은 숨기지 않음')
assert.equal(clockInHiddenForOperator(employee, { operatorId: '11111111-1111-4111-8111-111111111111', targetId: employee }), false, '다른 운영자가 들어간 직원 계정은 출근 버튼을 보여 줌')
assert.equal(developerCanSkipClockIn(employee, { operatorId: '11111111-1111-4111-8111-111111111111', targetId: employee }), false)
assert.equal(clockInHiddenForOperator(junyoung, { operatorId: junyoung, targetId: employee }), false, '전환이 끝나 본인 세션이면 숨기지 않음')
assert.equal(developerCanSkipClockIn(developer, { operatorId: developer, targetId: employee }), false, '개발자 본인 세션이면 건너뛰기를 두지 않음')
