import { RELEASE_EXCEPTION_IDS } from '../../lib/company/release-access.ts'

/** release-access의 첫 예외 계정. 다른 직원으로 볼 때 출근을 건너뛸 수 있다. */
export const DEVELOPER_OPERATOR_ID = RELEASE_EXCEPTION_IDS[0]
const HIDDEN_OPERATORS = new Set<string>(RELEASE_EXCEPTION_IDS.filter(id => id !== DEVELOPER_OPERATOR_ID))

function viewingEmployee(
  sessionUserId: string | null | undefined,
  stored: { operatorId: string; targetId: string } | null,
) {
  return Boolean(sessionUserId && stored && stored.operatorId !== sessionUserId && stored.targetId === sessionUserId)
}

/** 김준영·윤설빈이 직원 계정으로 들어간 동안에는 출근 버튼을 띄우지 않는다. */
export function clockInHiddenForOperator(
  sessionUserId: string | null | undefined,
  stored: { operatorId: string; targetId: string } | null,
) {
  if (!viewingEmployee(sessionUserId, stored) || !stored) return false
  return HIDDEN_OPERATORS.has(stored.operatorId)
}

/** 개발자가 다른 직원으로 보는 동안에는 출근 버튼 아래에 건너뛰기를 둔다. */
export function developerCanSkipClockIn(
  sessionUserId: string | null | undefined,
  stored: { operatorId: string; targetId: string } | null,
) {
  return viewingEmployee(sessionUserId, stored) && stored?.operatorId === DEVELOPER_OPERATOR_ID
}
