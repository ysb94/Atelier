import { PERMISSION_CATALOG, scopeLabel, type PermissionCode, type PermissionScope } from './permissions'
import { REQUEST_KINDS, approvalTypeOf } from '../../features/settings/personal-requests'

export type AssignmentItem = {
  id: string; group: string; label: string; scope: string; description: string
  approvalPart?: 'departments' | 'self'; permission?: PermissionCode
}

/** 기존 신청 종류와 권한 목록을 사용하며 새 승인 흐름을 만들지 않는다. */
export const ASSIGNMENT_CATALOG: readonly AssignmentItem[] = [
  ...REQUEST_KINDS.map(kind => ({
    id: `approval-${kind.id}`, group: '신청 승인', label: `${kind.label} 승인자`, scope: '부서별',
    description: approvalTypeOf(kind.id) === 'overtime' ? '기존 야근 승인자·대체 승인자를 사용합니다.' : '휴가·외근·재택·정정은 기존 근태 승인자·대체 승인자를 함께 사용합니다.',
    approvalPart: 'departments' as const,
  })),
  { id: 'approval-self', group: '신청 승인', label: '승인자 본인 신청 담당', scope: '회사', description: '기존 구성 시안입니다. 실제 승인 흐름에는 아직 연결되지 않았습니다.', approvalPart: 'self' },
  ...PERMISSION_CATALOG.map(([permission,label,group,scopes]) => ({
    id: permission, permission, label, group,
    scope: scopes.split(',').map(kind => scopeLabel(kind as PermissionScope)).join(' · '),
    description: '직책·직급과 별개로 기능과 적용 범위를 지정합니다.',
  })),
]
