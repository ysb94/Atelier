import { PERMISSION_CATALOG, scopeLabel, type PermissionCode, type PermissionScope } from './permissions'

export type AssignmentItem = {
  id: string; group: string; label: string; scope: string; description: string
  approvalPart?: 'departments'; permission?: PermissionCode
}

/** 기존 신청 종류와 권한 목록을 사용하며 새 승인 흐름을 만들지 않는다. */
export const ASSIGNMENT_CATALOG: readonly AssignmentItem[] = [
  ...(['야근', '출퇴근 정정'] as const).map((label,index) => ({
    id: index === 0 ? 'approval-overtime' : 'approval-correction', group: '신청 승인', label: `${label} 승인자`, scope: '부서별',
    description: '같은 지정 승인자·대체 승인자가 처리하며 담당 부서의 본인 신청도 승인할 수 있습니다.', approvalPart: 'departments' as const,
  })),
  ...PERMISSION_CATALOG.map(([permission,label,group,scopes]) => ({
    id: permission, permission, label, group,
    scope: scopes.split(',').map(kind => scopeLabel(kind as PermissionScope)).join(' · '),
    description: '직책·직급과 별개로 기능과 적용 범위를 지정합니다.',
  })),
]
