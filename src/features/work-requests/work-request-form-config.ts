import type { FieldOwner } from '@/lib/types'

export const WORK_REQUEST_OWNERS = [
  'planning',
  'design',
  'md',
  'logistics',
] as const satisfies readonly FieldOwner[]

export type WorkRequestOwner = (typeof WORK_REQUEST_OWNERS)[number]

export type WorkRequestFormConfig = {
  label: string
  teamName: string
  aliases: string[]
  description: string
  titlePlaceholder: string
  titleExample: string
  bodyPlaceholder: string
}

export const WORK_REQUEST_CONFIG: Record<
  WorkRequestOwner,
  WorkRequestFormConfig
> = {
  planning: {
    label: '기획',
    teamName: '기획',
    aliases: ['기획'],
    description: '기획안, 상품 스펙, 출시와 관련된 요청을 자유롭게 전달하세요.',
    titlePlaceholder: '[기획안 수정] 데일리백팩 안감 소재 변경',
    titleExample: '[출시 확정] 26SS 데일리백팩 출시 검토 요청',
    bodyPlaceholder:
      '현재 상황, 요청할 내용, 참고할 점을 자유롭게 작성하세요.',
  },
  design: {
    label: '디자인',
    teamName: 'VisualTeam',
    aliases: ['디자인', 'VisualTeam', '비주얼'],
    description: '이미지, 상세페이지, 목업, 운영 공지 요청을 자유롭게 전달하세요.',
    titlePlaceholder: '[네이버 상세] 데일리백팩 안감 컬러 안내 추가',
    titleExample: '[29CM] 브랜드 기획전 이미지 제작',
    bodyPlaceholder:
      '어디를 어떻게 바꿔야 하는지, 필요한 결과물과 참고 자료를 자유롭게 작성하세요.',
  },
  md: {
    label: 'MD',
    teamName: 'MD',
    aliases: ['MD', '엠디'],
    description: '가격, 발주, 채널, 프로모션 요청을 자유롭게 전달하세요.',
    titlePlaceholder: '[가격 변경] 데일리백팩 29CM 할인 판매가 적용',
    titleExample: '[프로모션] 29CM 가을 기획전 상품 등록',
    bodyPlaceholder:
      '변경할 값, 적용 채널, 기간과 주의사항을 자유롭게 작성하세요.',
  },
  logistics: {
    label: '물류',
    teamName: '물류',
    aliases: ['물류'],
    description: '출고, 송장, 사은품, 작업 지시 요청을 자유롭게 전달하세요.',
    titlePlaceholder: '[작업 지시] 데일리백팩 스트랩 동봉 요청',
    titleExample: '[송장 매핑] 29CM 데일리백팩 옵션 M번호 연결',
    bodyPlaceholder:
      '대상 상품, 적용 기간, 원문과 기대 결과를 자유롭게 작성하세요.',
  },
}

export const WORK_REQUEST_MANAGER_POSITIONS = ['팀장', '이사'] as const

export function isWorkRequestOwner(value: string): value is WorkRequestOwner {
  return (WORK_REQUEST_OWNERS as readonly string[]).includes(value)
}

export function normalizeDepartmentKey(value: string) {
  return value.replace(/\s|팀/g, '').toLowerCase()
}

function ownerAliases(owner: WorkRequestOwner): string[] {
  const config = WORK_REQUEST_CONFIG[owner]
  return [config.label, config.teamName, ...config.aliases]
}

export function isMemberOfOwnerDepartment(
  departmentName: string | null | undefined,
  owner: WorkRequestOwner,
) {
  if (!departmentName) return false
  const key = normalizeDepartmentKey(departmentName)
  return ownerAliases(owner).some((alias) => {
    const aliasKey = normalizeDepartmentKey(alias)
    return key.includes(aliasKey) || aliasKey.includes(key)
  })
}

export function ownerFromDepartment(
  departmentName: string | null | undefined,
): WorkRequestOwner | null {
  if (!departmentName) return null
  return (
    WORK_REQUEST_OWNERS.find((owner) =>
      isMemberOfOwnerDepartment(departmentName, owner),
    ) ?? null
  )
}

export function isSameDepartment(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  if (!left || !right) return false
  if (left === right) return true
  const leftOwner = ownerFromDepartment(left)
  const rightOwner = ownerFromDepartment(right)
  if (leftOwner && rightOwner) return leftOwner === rightOwner
  return normalizeDepartmentKey(left) === normalizeDepartmentKey(right)
}

export function departmentDisplayName(value: string) {
  const owner = ownerFromDepartment(value)
  return owner ? WORK_REQUEST_CONFIG[owner].teamName : value.trim()
}

export function isManagerPosition(position?: string | null) {
  return Boolean(
    position &&
      (WORK_REQUEST_MANAGER_POSITIONS as readonly string[]).includes(position),
  )
}

export type WorkRequestViewRole = 'manager' | 'employee' | 'requester'

export function resolveWorkRequestViewRole(
  owner: WorkRequestOwner,
  departmentName?: string | null,
  position?: string | null,
): WorkRequestViewRole {
  if (!isMemberOfOwnerDepartment(departmentName, owner)) return 'requester'
  return isManagerPosition(position) ? 'manager' : 'employee'
}
