import type { WorkRequestOwner } from './work-request-form-config'

export const LOCAL_SELF_ID = 'local-self'
export const LOCAL_CURRENT_DEPARTMENT = 'local-current-department'

export type TextContentBlock = {
  id: string
  type: 'text'
  text: string
}

export type ImageWrap = 'none' | 'left' | 'right'

export type ImageContentBlock = {
  id: string
  type: 'image'
  file: File
  caption: string
  widthPercent: number
  heightPx?: number
  offsetY: number
  wrap: ImageWrap
}

export type FileContentBlock = {
  id: string
  type: 'file'
  file: File
}

export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | FileContentBlock

export type FormValues = {
  title: string
  requester: string
  requesterPosition: string
  deadlineType: 'preferred' | 'fixed' | ''
  dueDate: string
  scheduleReason: string
  referenceFiles: File[]
  blocks: ContentBlock[]
}

export type FormErrors = Partial<Record<keyof FormValues, string>>

export type RequestStatus =
  | 'requested'
  | 'reviewing'
  | 'accepted'
  | 'inProgress'
  | 'waiting'
  | 'completionReview'
  | 'completionConfirm'
  | 'completed'
  | 'cancelled'
  | 'rejected'

export type ManagerPriority = 'urgent' | 'high' | 'normal' | 'low'

export const REQUESTER_CHAT_ROOM = 'requester'

export type WorkRequestMessage = {
  id: string
  roomId: string
  authorId: string
  authorName: string
  authorPosition: string
  body: string
  createdAt: string
}

export type WorkRequestChatRoom = {
  id: string
  peerName: string
  peerPosition: string
  roleLabel: string
  departmentLabel: string
}

export type WorkRequestRecord = {
  id: string
  owner: WorkRequestOwner
  /** 빈 문자열이면 브랜드 미정 */
  brandId: string
  brandDecidedAt: string
  brandDecidedBy: string
  values: FormValues
  requesterDepartment: string
  status: RequestStatus
  managerPriority: ManagerPriority | ''
  assignee: string
  assignedBy: string
  assignedAt: string
  collaborators: string[]
  confirmedDueDate: string
  plannedStart: string
  plannedEnd: string
  messages: WorkRequestMessage[]
  createdAt: string
  updatedAt: string
  completedAt: string
  completionRequestedAt: string
  completionRejectCount: number
}

export type RequestScreen =
  | { kind: 'list' }
  | { kind: 'form'; requestId?: string }

export type WorkListSection = 'inbox' | 'team' | 'mine' | 'sent' | 'completed'

export type LocalTeamMember = {
  id: string
  name: string
  position: string
  isSelf?: boolean
}

export const STATUS_META: Record<
  RequestStatus,
  {
    label: string
    variant: 'default' | 'success' | 'warning' | 'danger' | 'outline' | 'muted'
  }
> = {
  requested: { label: '요청됨', variant: 'outline' },
  reviewing: { label: '검토 중', variant: 'warning' },
  accepted: { label: '수락됨', variant: 'default' },
  inProgress: { label: '진행 중', variant: 'default' },
  waiting: { label: '보류', variant: 'warning' },
  completionReview: { label: '완료 요청', variant: 'warning' },
  completionConfirm: { label: '요청자 확인', variant: 'warning' },
  completed: { label: '완료', variant: 'success' },
  cancelled: { label: '취소', variant: 'muted' },
  rejected: { label: '반려', variant: 'danger' },
}

export const PRIORITY_META: Record<
  ManagerPriority,
  { label: string; variant: 'default' | 'warning' | 'danger' | 'muted' }
> = {
  urgent: { label: '긴급', variant: 'danger' },
  high: { label: '높음', variant: 'warning' },
  normal: { label: '보통', variant: 'default' },
  low: { label: '낮음', variant: 'muted' },
}

export function personLabel(name?: string | null, position?: string | null) {
  const displayName = name?.trim() || '미입력'
  const displayPosition = position?.trim()
  return displayPosition ? `${displayName} · ${displayPosition}` : displayName
}

export function localTeamMembers(
  _department: string,
  selfName?: string | null,
  selfPosition?: string | null,
): LocalTeamMember[] {
  return [
    {
      id: LOCAL_SELF_ID,
      name: selfName?.trim() || '나',
      position: selfPosition || '사원',
      isSelf: true,
    },
    { id: 'member-min', name: '김민지', position: '대리' },
    { id: 'member-jun', name: '이준호', position: '사원' },
    { id: 'member-seo', name: '박서연', position: '사원' },
  ]
}

export function makeMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function isBrandUndecided(
  request: Pick<WorkRequestRecord, 'brandId'>,
) {
  return !request.brandId.trim()
}

export function brandLabelForRequest(
  request: Pick<WorkRequestRecord, 'brandId'>,
  brands: { id: string; name: string }[],
) {
  if (isBrandUndecided(request)) return '브랜드 미정'
  return brands.find((brand) => brand.id === request.brandId)?.name ?? '브랜드'
}

export function isClosedStatus(status: RequestStatus) {
  return (
    status === 'completed' || status === 'cancelled' || status === 'rejected'
  )
}

export function isCompletionPending(status: RequestStatus) {
  return status === 'completionReview' || status === 'completionConfirm'
}

export function needsLeadCompletionReview(request: WorkRequestRecord) {
  if (!request.assignee) return false
  return request.assignedBy !== request.assignee
}

export function nextCompletionStatus(
  request: WorkRequestRecord,
): Extract<RequestStatus, 'completionReview' | 'completionConfirm'> {
  return needsLeadCompletionReview(request)
    ? 'completionReview'
    : 'completionConfirm'
}

export function assignedChatMemberIds(request: WorkRequestRecord): string[] {
  return [...new Set([request.assignee, ...request.collaborators].filter(Boolean))]
}

export function visibleChatRooms(
  request: WorkRequestRecord,
  {
    canManage,
    isRequester,
    selfId,
    teamMembers,
    teamName,
    requesterDepartmentLabel,
  }: {
    canManage: boolean
    isRequester: boolean
    selfId: string
    teamMembers: LocalTeamMember[]
    teamName: string
    requesterDepartmentLabel: string
  },
): WorkRequestChatRoom[] {
  const counterpartFromRoom = (roomId: string) => {
    const other = [...request.messages]
      .reverse()
      .find(
        (message) =>
          message.roomId === roomId && message.authorId !== selfId,
      )
    if (other) {
      return { peerName: other.authorName, peerPosition: other.authorPosition }
    }
    return { peerName: teamName, peerPosition: '담당자' }
  }

  const requesterRoom: WorkRequestChatRoom = canManage
    ? {
        id: REQUESTER_CHAT_ROOM,
        peerName: request.values.requester,
        peerPosition: request.values.requesterPosition,
        roleLabel: '요청자',
        departmentLabel: requesterDepartmentLabel,
      }
    : {
        id: REQUESTER_CHAT_ROOM,
        ...counterpartFromRoom(REQUESTER_CHAT_ROOM),
        roleLabel: '작업자',
        departmentLabel: teamName,
      }

  const memberRooms = assignedChatMemberIds(request)
    .filter((id) => id && id !== selfId)
    .map((id) => {
      const member = teamMembers.find((item) => item.id === id)
      return {
        id,
        peerName: member?.name ?? id,
        peerPosition: member?.position ?? '',
        roleLabel: '작업자',
        departmentLabel: teamName,
      }
    })

  if (canManage) return [requesterRoom, ...memberRooms]
  if (isRequester) return [requesterRoom]
  if (assignedChatMemberIds(request).includes(selfId)) {
    return [
      {
        id: selfId,
        ...counterpartFromRoom(selfId),
        roleLabel: '담당자',
        departmentLabel: teamName,
      },
    ]
  }
  return []
}
