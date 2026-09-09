import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardPlus,
  Clock3,
  Eye,
  Inbox,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { ATELIER_BRAND_ID } from '@/lib/company/capabilities'
import { useAuth } from '@/lib/supabase/auth'
import { listBrandDirectory } from '@/lib/supabase/profiles'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, emptyList } from '@/lib/utils'
import {
  departmentDisplayName,
  isSameDepartment,
  isWorkRequestOwner,
  resolveWorkRequestViewRole,
  WORK_REQUEST_CONFIG,
  WORK_REQUEST_OWNERS,
  type WorkRequestOwner,
} from './work-request-form-config'
import { WorkRequestAcceptDialog } from './WorkRequestAcceptDialog'
import { WorkRequestCompletedPanel } from './WorkRequestCompletedPanel'
import { WorkRequestChat } from './WorkRequestChat'
import { WorkRequestScratchTodos } from './WorkRequestScratchTodos'
import { WorkRequestTeamBoard } from './WorkRequestTeamBoard'
import {
  compareRequestsByDeadline,
  dateFromToday,
  dateTimeFromToday,
  deadlineLabel,
  currentWorkElapsedMs,
  flushWorkTime,
  formatCompactDate,
  formatDate,
  formatDateTime,
  formatSlashDate,
  formatWorkDuration,
  requestPlannedRange,
  startWorkTime,
  workTimeKey,
  type WorkTimeLog,
} from './work-request-schedule'
import {
  LOCAL_CURRENT_DEPARTMENT,
  LOCAL_SELF_ID,
  PRIORITY_META,
  REQUESTER_CHAT_ROOM,
  STATUS_META,
  isClosedStatus,
  isCompletionPending,
  localTeamMembers,
  makeMessageId,
  nextCompletionStatus,
  needsLeadCompletionReview,
  brandLabelForRequest,
  isBrandUndecided,
  personLabel,
  visibleChatRooms,
  type ContentBlock,
  type FileContentBlock,
  type FormErrors,
  type FormValues,
  type ImageContentBlock,
  type ImageWrap,
  type RequestScreen,
  type RequestStatus,
  type TextContentBlock,
  type WorkListSection,
  type WorkRequestMessage,
  type WorkRequestRecord,
} from './work-request-types'

function makeBlockId(): string {
  return `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function emptyTextBlock(text = ''): TextContentBlock {
  return { id: makeBlockId(), type: 'text', text }
}

function createEmptyValues(): FormValues {
  return {
    title: '',
    requester: '',
    requesterPosition: '',
    deadlineType: 'preferred',
    dueDate: '',
    scheduleReason: '',
    referenceFiles: [],
    blocks: [emptyTextBlock()],
  }
}

function demoValues({
  title,
  requester,
  requesterPosition = '사원',
  dueIn,
  body,
  fixed = false,
}: {
  title: string
  requester: string
  requesterPosition?: string
  dueIn: number
  body: string
  fixed?: boolean
}): FormValues {
  return {
    title,
    requester,
    requesterPosition,
    deadlineType: fixed ? 'fixed' : 'preferred',
    dueDate: dateFromToday(dueIn),
    scheduleReason: fixed
      ? '외부 채널 오픈 일정이 확정되어 마감일 변경이 어렵습니다.'
      : '',
    referenceFiles: [],
    blocks: [emptyTextBlock(body)],
  }
}

function incomingSourceDepartments(owner: WorkRequestOwner): string[] {
  return WORK_REQUEST_OWNERS.filter((item) => item !== owner).map(
    (item) => WORK_REQUEST_CONFIG[item].teamName,
  )
}

function isCurrentUserRequest(
  requesterDepartment: string,
  userDepartment?: string | null,
) {
  if (requesterDepartment === LOCAL_CURRENT_DEPARTMENT) return true
  return isSameDepartment(requesterDepartment, userDepartment)
}

function createDemoRequests(owner: WorkRequestOwner): WorkRequestRecord[] {
  const destination = WORK_REQUEST_CONFIG[owner].teamName
  const prefix = owner.slice(0, 2).toUpperCase()
  const sourceDepartments = incomingSourceDepartments(owner)
  const sourceA = sourceDepartments[0] ?? '기획'
  const sourceB = sourceDepartments[1] ?? 'MD'
  const sourceC = sourceDepartments[2] ?? '물류'

  const requests: Omit<
    WorkRequestRecord,
    | 'messages'
    | 'assignedBy'
    | 'assignedAt'
    | 'completedAt'
    | 'completionRequestedAt'
    | 'completionRejectCount'
    | 'brandId'
    | 'brandDecidedAt'
    | 'brandDecidedBy'
  >[] = [
    {
      id: `WR-${prefix}-001`,
      owner,
      requesterDepartment: sourceA,
      values: demoValues({
        title: `[긴급 확인] ${destination} 결과물 일정 검토 요청`,
        requester: '한유진',
        requesterPosition: '과장',
        dueIn: 2,
        body: `${sourceA}에서 ${destination}으로 보낸 요청입니다. 채널 오픈 전에 필요한 결과물이니 처리 일정과 추가 자료를 알려 주세요.`,
        fixed: true,
      }),
      status: 'requested',
      managerPriority: '',
      assignee: '',
      collaborators: [],
      confirmedDueDate: '',
      plannedStart: '',
      plannedEnd: '',
      createdAt: dateTimeFromToday(-1, 10),
      updatedAt: dateTimeFromToday(-1, 10),
    },
    {
      id: `WR-${prefix}-002`,
      owner,
      requesterDepartment: sourceB,
      values: demoValues({
        title: `[검토 요청] 26FW 프로모션 ${destination} 업무`,
        requester: '최도윤',
        requesterPosition: '대리',
        dueIn: 5,
        body: `${sourceB}에서 ${destination}으로 보낸 요청입니다. 26FW 프로모션 오픈에 맞춰 세부 범위를 조율해 주세요.`,
      }),
      status: 'reviewing',
      managerPriority: 'high',
      assignee: '',
      collaborators: [],
      confirmedDueDate: '',
      plannedStart: '',
      plannedEnd: '',
      createdAt: dateTimeFromToday(-2, 14),
      updatedAt: dateTimeFromToday(-1, 15),
    },
    {
      id: `WR-${prefix}-003`,
      owner,
      requesterDepartment: sourceC,
      values: demoValues({
        title: `[업무 요청] 신상품 출시 ${destination} 반영`,
        requester: '정하린',
        requesterPosition: '사원',
        dueIn: 8,
        body: `${sourceC}에서 ${destination}으로 보낸 요청입니다. 접수 후 주 담당자와 협업자를 배정해 주세요.`,
      }),
      status: 'accepted',
      managerPriority: 'normal',
      assignee: '',
      collaborators: [],
      confirmedDueDate: dateFromToday(7),
      plannedStart: '',
      plannedEnd: '',
      createdAt: dateTimeFromToday(-3, 9),
      updatedAt: dateTimeFromToday(-1, 11),
    },
    {
      id: `WR-${prefix}-004`,
      owner,
      requesterDepartment: sourceA,
      values: demoValues({
        title: `[진행 중] 주간 운영 ${destination} 수정`,
        requester: '윤서아',
        requesterPosition: '팀장',
        dueIn: 3,
        body: `${sourceA}에서 요청한 운영 수정입니다. 주 담당자와 협업자가 함께 진행 중입니다.`,
      }),
      status: 'inProgress',
      managerPriority: 'high',
      assignee: LOCAL_SELF_ID,
      collaborators: ['member-min'],
      confirmedDueDate: dateFromToday(3),
      plannedStart: dateFromToday(-1),
      plannedEnd: dateFromToday(2),
      createdAt: dateTimeFromToday(-5, 11),
      updatedAt: dateTimeFromToday(-1, 17),
    },
    {
      id: `WR-${prefix}-005`,
      owner,
      requesterDepartment: sourceB,
      values: demoValues({
        title: `[진행 중] 시즌 캠페인 ${destination} 준비`,
        requester: '김태오',
        requesterPosition: '대리',
        dueIn: 1,
        body: `${sourceB}에서 요청한 시즌 캠페인 준비입니다. 다른 사원에게 배정된 업무입니다.`,
      }),
      status: 'inProgress',
      managerPriority: 'urgent',
      assignee: 'member-min',
      collaborators: [],
      confirmedDueDate: dateFromToday(1),
      plannedStart: dateFromToday(0),
      plannedEnd: dateFromToday(1),
      createdAt: dateTimeFromToday(-6, 13),
      updatedAt: dateTimeFromToday(0, 9),
    },
    {
      id: `WR-${prefix}-006`,
      owner,
      requesterDepartment: sourceC,
      values: demoValues({
        title: `[보류] 협력사 확인 후 ${destination} 반영`,
        requester: '박시은',
        requesterPosition: '사원',
        dueIn: 9,
        body: `${sourceC}에서 요청한 업무입니다. 협력사 원본 자료가 도착하면 재개합니다.`,
      }),
      status: 'waiting',
      managerPriority: 'low',
      assignee: 'member-jun',
      collaborators: [LOCAL_SELF_ID],
      confirmedDueDate: dateFromToday(9),
      plannedStart: dateFromToday(2),
      plannedEnd: dateFromToday(6),
      createdAt: dateTimeFromToday(-7, 15),
      updatedAt: dateTimeFromToday(-2, 10),
    },
    {
      id: `WR-${prefix}-007`,
      owner,
      requesterDepartment: sourceA,
      values: demoValues({
        title: `[완료] 지난주 ${destination} 운영 요청`,
        requester: '이주원',
        requesterPosition: '과장',
        dueIn: -1,
        body: `${sourceA}에서 보낸 지난주 요청으로, 다른 사원이 완료했습니다.`,
      }),
      status: 'completed',
      managerPriority: 'normal',
      assignee: 'member-seo',
      collaborators: [],
      confirmedDueDate: dateFromToday(-1),
      plannedStart: dateFromToday(-8),
      plannedEnd: dateFromToday(-2),
      createdAt: dateTimeFromToday(-10, 9),
      updatedAt: dateTimeFromToday(-1, 16),
    },
    {
      id: `WR-${prefix}-008`,
      owner,
      requesterDepartment: LOCAL_CURRENT_DEPARTMENT,
      values: demoValues({
        title: `[요청] ${destination} 협업 일정 확인`,
        requester: '나',
        requesterPosition: '이사',
        dueIn: 6,
        body: `현재 소속 부서에서 ${destination}으로 보낸 요청입니다. 요청자 화면에서만 목록에 함께 보입니다.`,
      }),
      status: 'reviewing',
      managerPriority: '',
      assignee: '',
      collaborators: [],
      confirmedDueDate: '',
      plannedStart: '',
      plannedEnd: '',
      createdAt: dateTimeFromToday(-1, 16),
      updatedAt: dateTimeFromToday(-1, 16),
    },
    {
      id: `WR-${prefix}-009`,
      owner,
      requesterDepartment: LOCAL_CURRENT_DEPARTMENT,
      values: demoValues({
        title: `[접수] ${destination} 작업 범위 확정`,
        requester: '나',
        requesterPosition: '이사',
        dueIn: 10,
        body: `현재 소속 부서에서 ${destination}으로 보낸 요청입니다. 접수됐지만 아직 담당자는 없습니다.`,
      }),
      status: 'accepted',
      managerPriority: 'normal',
      assignee: '',
      collaborators: [],
      confirmedDueDate: dateFromToday(9),
      plannedStart: '',
      plannedEnd: '',
      createdAt: dateTimeFromToday(-4, 10),
      updatedAt: dateTimeFromToday(-2, 14),
    },
    {
      id: `WR-${prefix}-010`,
      owner,
      requesterDepartment: sourceB,
      values: demoValues({
        title: `[완료] 내가 맡은 ${destination} 지난 요청`,
        requester: '오하은',
        requesterPosition: '대리',
        dueIn: -2,
        body: `${sourceB}에서 요청한 업무로, 현재 접속자에게 배정되어 완료된 임시 데이터입니다.`,
      }),
      status: 'completed',
      managerPriority: 'normal',
      assignee: LOCAL_SELF_ID,
      collaborators: [],
      confirmedDueDate: dateFromToday(-2),
      plannedStart: dateFromToday(-9),
      plannedEnd: dateFromToday(-3),
      createdAt: dateTimeFromToday(-12, 11),
      updatedAt: dateTimeFromToday(-2, 16),
    },
  ]

  return requests.map((request) => {
    const undecided =
      request.id.endsWith('-002') || request.id.endsWith('-008')
    return attachDemoMessages(
      {
        ...request,
        brandId: undecided ? '' : ATELIER_BRAND_ID,
        brandDecidedAt: undecided ? '' : request.createdAt,
        brandDecidedBy: undecided ? '' : 'demo-lead',
        assignedBy: request.assignee ? LOCAL_SELF_ID : '',
        assignedAt: request.assignee
          ? request.plannedStart || request.createdAt
          : '',
        completedAt:
          request.status === 'completed' ? request.updatedAt : '',
        completionRequestedAt:
          request.status === 'completed' ? request.updatedAt : '',
        completionRejectCount: request.id.endsWith('-010') ? 1 : 0,
      },
      destination,
    )
  })
}

function attachDemoMessages(
  request: Omit<WorkRequestRecord, 'messages'>,
  destination: string,
): WorkRequestRecord {
  if (request.id.endsWith('-002')) {
    return {
      ...request,
      messages: [
        {
          id: `${request.id}-m1`,
          roomId: 'requester',
          authorId: 'member-min',
          authorName: '김민지',
          authorPosition: '대리',
          body: `범위 확인 중입니다. ${destination}에서 우선 반영할 항목을 알려 주세요.`,
          createdAt: dateTimeFromToday(-1, 16),
        },
        {
          id: `${request.id}-m2`,
          roomId: 'requester',
          authorId: 'demo-requester',
          authorName: request.values.requester,
          authorPosition: request.values.requesterPosition,
          body: '1차는 프로모션 메인 이미지와 일정 확정만 부탁드립니다.',
          createdAt: dateTimeFromToday(-1, 17),
        },
      ],
    }
  }

  if (request.id.endsWith('-004')) {
    return {
      ...request,
      messages: [
        {
          id: `${request.id}-m1`,
          roomId: 'member-min',
          authorId: LOCAL_SELF_ID,
          authorName: '나',
          authorPosition: '이사',
          body: '오늘 오후까지 1차 수정안을 올리겠습니다.',
          createdAt: dateTimeFromToday(-1, 11),
        },
        {
          id: `${request.id}-m2`,
          roomId: 'member-min',
          authorId: 'member-min',
          authorName: '김민지',
          authorPosition: '대리',
          body: '확인했습니다. 컬러 가이드만 맞춰 주세요.',
          createdAt: dateTimeFromToday(-1, 13),
        },
      ],
    }
  }

  return { ...request, messages: [] }
}

function demoCurrentWork(owner: WorkRequestOwner): Record<string, string> {
  const prefix = owner.slice(0, 2).toUpperCase()
  return {
    [LOCAL_SELF_ID]: `WR-${prefix}-004`,
    'member-min': `WR-${prefix}-005`,
  }
}

function demoWorkTime(owner: WorkRequestOwner): Record<string, WorkTimeLog> {
  const prefix = owner.slice(0, 2).toUpperCase()
  const now = Date.now()
  return {
    [workTimeKey(LOCAL_SELF_ID, `WR-${prefix}-004`)]: {
      accumulatedMs: 18 * 60 * 1000,
      mountedAt: now - 6 * 60 * 1000,
    },
    [workTimeKey('member-min', `WR-${prefix}-005`)]: {
      accumulatedMs: 3 * 60 * 60 * 1000 + 20 * 60 * 1000,
      mountedAt: now - 45 * 60 * 1000,
    },
    [workTimeKey('member-jun', `WR-${prefix}-006`)]: {
      accumulatedMs: 52 * 60 * 1000,
      mountedAt: null,
    },
  }
}

function hasRequestBody(blocks: ContentBlock[]): boolean {
  return blocks.some((block) =>
    block.type === 'text' ? block.text.trim().length > 0 : true,
  )
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function fileFormatLabel(file: File): string {
  const ext = file.name.includes('.')
    ? file.name.split('.').pop()?.toUpperCase()
    : ''
  if (ext && ext !== file.name.toUpperCase()) return ext
  if (file.type.includes('pdf')) return 'PDF'
  if (file.type.startsWith('video/')) return 'VIDEO'
  if (file.type.startsWith('audio/')) return 'AUDIO'
  if (file.type.includes('zip') || file.type.includes('compressed')) return 'ZIP'
  return 'FILE'
}

function makeRequestId(): string {
  return `WR-${Date.now().toString(36).toUpperCase()}`
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name)
}

function ImagePreview({
  file,
  className,
  style,
}: {
  file: File
  className?: string
  style?: CSSProperties
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  if (!url) {
    return (
      <div className="flex h-40 items-center justify-center bg-muted text-xs text-muted-foreground">
        이미지를 불러오는 중...
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={file.name}
      draggable={false}
      className={className}
      style={style}
      onDragStart={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    />
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type WrapLayout = 'around' | 'stack'

function wrapLayoutOf(wrap: ImageWrap): WrapLayout {
  return wrap === 'none' ? 'stack' : 'around'
}

function ImageWrapIcon({
  variant,
  active,
}: {
  variant: WrapLayout
  active?: boolean
}) {
  const line = active ? '#6b7280' : '#9ca3af'
  const image = '#3b82f6'
  return (
    <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="5"
        fill={active ? '#eef0f3' : '#ffffff'}
        stroke={active ? '#c5c9d0' : '#d4d7de'}
      />
      {variant === 'around' ? (
        <>
          <rect x="4" y="4.5" width="24" height="1.6" rx="0.6" fill={line} />
          <rect x="4" y="7.6" width="24" height="1.6" rx="0.6" fill={line} />
          <rect x="4" y="12" width="6.5" height="1.6" rx="0.6" fill={line} />
          <rect x="4" y="15.2" width="6.5" height="1.6" rx="0.6" fill={line} />
          <rect x="4" y="18.4" width="6.5" height="1.6" rx="0.6" fill={line} />
          <rect x="21.5" y="12" width="6.5" height="1.6" rx="0.6" fill={line} />
          <rect x="21.5" y="15.2" width="6.5" height="1.6" rx="0.6" fill={line} />
          <rect x="21.5" y="18.4" width="6.5" height="1.6" rx="0.6" fill={line} />
          <rect x="4" y="22.8" width="24" height="1.6" rx="0.6" fill={line} />
          <rect x="4" y="25.9" width="24" height="1.6" rx="0.6" fill={line} />
          <rect x="12" y="11.2" width="8" height="8.4" rx="1.4" fill={image} />
        </>
      ) : (
        <>
          <rect x="4" y="4.5" width="24" height="1.6" rx="0.6" fill={line} />
          <rect x="4" y="7.6" width="24" height="1.6" rx="0.6" fill={line} />
          <rect x="12" y="11.2" width="8" height="8.4" rx="1.4" fill={image} />
          <rect x="4" y="22.8" width="24" height="1.6" rx="0.6" fill={line} />
          <rect x="4" y="25.9" width="24" height="1.6" rx="0.6" fill={line} />
        </>
      )}
    </svg>
  )
}

function normalizeEditableText(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/^\n$/, '')
}

function caretFromPoint(clientX: number, clientY: number) {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY)
    if (!range) return null
    return { node: range.startContainer, offset: range.startOffset }
  }
  const position = doc.caretPositionFromPoint?.(clientX, clientY)
  if (!position) return null
  return { node: position.offsetNode, offset: position.offset }
}

function textOffsetInElement(element: HTMLElement, node: Node, offset: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let index = 0
  let current = walker.nextNode()
  while (current) {
    const length = current.textContent?.length ?? 0
    if (current === node) return index + offset
    index += length
    current = walker.nextNode()
  }
  if (node === element) return Math.min(offset, index)
  return index
}

function isCaretAtStart(element: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false
  if (!element.contains(selection.anchorNode)) return false
  const range = selection.getRangeAt(0)
  const before = range.cloneRange()
  before.selectNodeContents(element)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().length === 0
}

function getEditableSelectionOffsets(element: HTMLElement) {
  const selection = window.getSelection()
  const length = normalizeEditableText(element.innerText).length
  if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
    return { start: length, end: length }
  }
  const range = selection.getRangeAt(0)
  const start = textOffsetInElement(element, range.startContainer, range.startOffset)
  const end = textOffsetInElement(element, range.endContainer, range.endOffset)
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

type FlowPart = {
  type: 'flow'
  text: TextContentBlock
  images: ImageContentBlock[]
}

type FilePart = {
  type: 'file'
  file: FileContentBlock
}

type BodyPart = FlowPart | FilePart

function joinPlainText(left: string, right: string) {
  if (!left) return right
  if (!right) return left
  return `${left}\n${right}`
}

function splitBodyParts(blocks: ContentBlock[]): BodyPart[] {
  const parts: BodyPart[] = []
  let pendingText: TextContentBlock | undefined
  let pendingImages: ImageContentBlock[] = []

  const flushFlow = () => {
    if (!pendingText && pendingImages.length === 0) return
    parts.push({
      type: 'flow',
      text: pendingText ?? emptyTextBlock(),
      images: pendingImages.map((image) => ({
        ...image,
        offsetY: image.offsetY ?? 0,
      })),
    })
    pendingText = undefined
    pendingImages = []
  }

  for (const block of blocks) {
    if (block.type === 'file') {
      flushFlow()
      parts.push({ type: 'file', file: block })
      continue
    }
    if (block.type === 'text') {
      pendingText = pendingText
        ? {
            id: pendingText.id,
            type: 'text',
            text: joinPlainText(pendingText.text, block.text),
          }
        : {
            id: block.id,
            type: 'text',
            text: block.text,
          }
      continue
    }
    pendingImages.push(block)
  }
  flushFlow()
  if (parts.length === 0) {
    parts.push({ type: 'flow', text: emptyTextBlock(), images: [] })
  }
  return parts
}

function partsToBlocks(parts: BodyPart[]): ContentBlock[] {
  const next: ContentBlock[] = []
  for (const part of parts) {
    if (part.type === 'file') {
      next.push(part.file)
      continue
    }
    next.push(part.text)
    next.push(...part.images)
  }
  if (next.length === 0 || next[next.length - 1]?.type !== 'text') {
    next.push(emptyTextBlock())
  }
  return next
}

function imageDisplayHeight(image: ImageContentBlock, measured?: number) {
  if (measured && measured > 0) return measured
  if (image.heightPx != null) return image.heightPx
  return 160
}

function imageColumn(image: ImageContentBlock): 'left' | 'right' | 'full' {
  if ((image.wrap ?? 'none') === 'none') return 'full'
  return image.wrap === 'right' ? 'right' : 'left'
}

function flowImageSpacers(
  images: ImageContentBlock[],
  heights: Record<string, number>,
) {
  const columnEnd = { left: 0, right: 0, full: 0 }
  return [...images]
    .sort((left, right) => (left.offsetY ?? 0) - (right.offsetY ?? 0))
    .map((image) => {
      const column = imageColumn(image)
      const blocked =
        column === 'full'
          ? Math.max(columnEnd.left, columnEnd.right, columnEnd.full)
          : Math.max(columnEnd[column], columnEnd.full)
      const offsetY = Math.max(0, image.offsetY ?? 0)
      const spacer = Math.max(0, offsetY - blocked)
      const startY = blocked + spacer
      const height = imageDisplayHeight(image, heights[image.id])
      if (column === 'full') {
        columnEnd.left = startY + height
        columnEnd.right = startY + height
        columnEnd.full = startY + height
      } else {
        columnEnd[column] = startY + height
      }
      return { image, column, spacer }
    })
}

function createImageBlocks(files: File[], offsetY: number): ImageContentBlock[] {
  return files.filter(isImageFile).map((file) => ({
    id: makeBlockId(),
    type: 'image' as const,
    file,
    caption: '',
    widthPercent: 100,
    offsetY,
    wrap: 'none' as const,
  }))
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

const IMAGE_RESIZE_HANDLES: {
  id: ResizeHandle
  label: string
  position: string
  cursor: string
  kind: 'corner' | 'ns' | 'ew'
}[] = [
  {
    id: 'nw',
    label: '왼쪽 위, 비율 유지',
    position: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2',
    cursor: 'cursor-nwse-resize',
    kind: 'corner',
  },
  {
    id: 'ne',
    label: '오른쪽 위, 비율 유지',
    position: 'right-0 top-0 translate-x-1/2 -translate-y-1/2',
    cursor: 'cursor-nesw-resize',
    kind: 'corner',
  },
  {
    id: 'sw',
    label: '왼쪽 아래, 비율 유지',
    position: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2',
    cursor: 'cursor-nesw-resize',
    kind: 'corner',
  },
  {
    id: 'se',
    label: '오른쪽 아래, 비율 유지',
    position: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2',
    cursor: 'cursor-nwse-resize',
    kind: 'corner',
  },
  {
    id: 'n',
    label: '높이만 조절',
    position: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2',
    cursor: 'cursor-ns-resize',
    kind: 'ns',
  },
  {
    id: 's',
    label: '높이만 조절',
    position: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
    cursor: 'cursor-ns-resize',
    kind: 'ns',
  },
  {
    id: 'e',
    label: '너비만 조절',
    position: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2',
    cursor: 'cursor-ew-resize',
    kind: 'ew',
  },
  {
    id: 'w',
    label: '너비만 조절',
    position: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
    cursor: 'cursor-ew-resize',
    kind: 'ew',
  },
]

const MIN_IMAGE_WIDTH = 15
const MIN_IMAGE_HEIGHT = 40
const MAX_IMAGE_HEIGHT = 2400

function ResizableImage({
  file,
  widthPercent,
  heightPx,
  wrap = 'none',
  fillParent,
  onSizeChange,
  onWrapChange,
  onMoveStart,
  onHeightChange,
  isMoving,
  onRemove,
}: {
  file: File
  widthPercent: number
  heightPx?: number
  wrap?: ImageWrap
  fillParent?: boolean
  onSizeChange?: (size: { widthPercent: number; heightPx?: number }) => void
  onWrapChange?: (wrap: ImageWrap) => void
  onMoveStart?: (event: PointerEvent<HTMLDivElement>) => void
  onHeightChange?: (height: number) => void
  isMoving?: boolean
  onRemove?: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    handle: ResizeHandle
    startX: number
    startY: number
    startWidth: number
    startHeight: number
    frameWidth: number
    lockHeight: boolean
  } | null>(null)
  const wrapped = wrap !== 'none'
  const width = clamp(widthPercent || (wrapped ? 40 : 100), MIN_IMAGE_WIDTH, 100)
  const lockedHeight = heightPx != null ? clamp(heightPx, MIN_IMAGE_HEIGHT, MAX_IMAGE_HEIGHT) : undefined

  useEffect(() => {
    const box = boxRef.current
    if (!box || !onHeightChange) return
    const notify = () => onHeightChange(Math.round(box.getBoundingClientRect().height))
    notify()
    const observer = new ResizeObserver(notify)
    observer.observe(box)
    return () => observer.disconnect()
  }, [onHeightChange, lockedHeight, width])

  function applyResize(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || !onSizeChange) return

    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    const signX = current.handle.includes('e') ? 1 : current.handle.includes('w') ? -1 : 0
    const signY = current.handle.includes('s') ? 1 : current.handle.includes('n') ? -1 : 0
    const isCorner = current.handle === 'nw' || current.handle === 'ne' || current.handle === 'sw' || current.handle === 'se'

    if (isCorner) {
      const scaleX = (current.startWidth + (signX * dx * 100) / current.frameWidth) / current.startWidth
      const scaleY = (current.startHeight + signY * dy) / current.startHeight
      const scale = Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY
      const nextWidth = clamp(current.startWidth * scale, MIN_IMAGE_WIDTH, 100)
      if (current.lockHeight) {
        onSizeChange({
          widthPercent: Math.round(nextWidth),
          heightPx: Math.round(clamp(current.startHeight * scale, MIN_IMAGE_HEIGHT, MAX_IMAGE_HEIGHT)),
        })
        return
      }
      onSizeChange({ widthPercent: Math.round(nextWidth) })
      return
    }

    if (current.handle === 'e' || current.handle === 'w') {
      onSizeChange({
        widthPercent: Math.round(
          clamp(current.startWidth + (signX * dx * 100) / current.frameWidth, MIN_IMAGE_WIDTH, 100),
        ),
        heightPx: Math.round(current.startHeight),
      })
      return
    }

    onSizeChange({
      widthPercent: current.startWidth,
      heightPx: Math.round(clamp(current.startHeight + signY * dy, MIN_IMAGE_HEIGHT, MAX_IMAGE_HEIGHT)),
    })
  }

  function startResize(handle: ResizeHandle, event: PointerEvent<HTMLButtonElement>) {
    const box = boxRef.current
    if (!box || !onSizeChange) return
    event.preventDefault()
    event.stopPropagation()
    const boxRect = box.getBoundingClientRect()
    const frame = box.closest('[data-flow-frame]')
    drag.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: width,
      startHeight: lockedHeight ?? boxRect.height,
      frameWidth: Math.max(frame?.getBoundingClientRect().width ?? boxRect.width, 1),
      lockHeight: lockedHeight != null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const layout = wrapLayoutOf(wrap)

  return (
    <div
      ref={boxRef}
      className={cn(
        'group relative',
        onMoveStart && 'cursor-grab',
        isMoving && 'cursor-grabbing opacity-40',
      )}
      style={{ width: fillParent ? '100%' : `${width}%` }}
      onPointerDown={(event) => {
        if (!onMoveStart) return
        if ((event.target as HTMLElement).closest('button')) return
        event.preventDefault()
        onMoveStart(event)
      }}
    >
        <ImagePreview
          file={file}
          className={cn(
            'block w-full rounded-md bg-muted/30',
            lockedHeight ? 'object-fill' : 'h-auto object-contain',
          )}
          style={lockedHeight ? { height: `${lockedHeight}px` } : undefined}
        />
        {onSizeChange || onWrapChange ? (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-border/70 ring-inset" />
            <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100">
              {width}%
              {lockedHeight ? ` · ${lockedHeight}px` : ''}
            </span>
            {onWrapChange ? (
              <div className="absolute left-2 top-8 flex gap-1 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  title="글이 이미지 옆을 감싸게"
                  aria-label="글이 이미지 옆을 감싸게"
                  className="rounded-md shadow-sm"
                  onClick={() => onWrapChange(wrap === 'right' ? 'right' : 'left')}
                >
                  <ImageWrapIcon variant="around" active={layout === 'around'} />
                </button>
                <button
                  type="button"
                  title="이미지를 위아래로만 배치"
                  aria-label="이미지를 위아래로만 배치"
                  className="rounded-md shadow-sm"
                  onClick={() => onWrapChange('none')}
                >
                  <ImageWrapIcon variant="stack" active={layout === 'stack'} />
                </button>
              </div>
            ) : null}
            {onSizeChange
              ? IMAGE_RESIZE_HANDLES.map((handle) => (
                  <button
                    key={handle.id}
                    type="button"
                    aria-label={handle.label}
                    className={cn(
                      'absolute z-10 flex items-center justify-center p-1',
                      handle.position,
                      handle.cursor,
                    )}
                    onPointerDown={(event) => startResize(handle.id, event)}
                    onPointerMove={applyResize}
                    onPointerUp={() => {
                      drag.current = null
                    }}
                    onPointerCancel={() => {
                      drag.current = null
                    }}
                  >
                    <span
                      className={cn(
                        'border border-white bg-primary shadow-sm',
                        handle.kind === 'corner' && 'size-1.5 rounded-[1px]',
                        handle.kind === 'ns' && 'h-0.5 w-3.5 rounded-full',
                        handle.kind === 'ew' && 'h-3.5 w-0.5 rounded-full',
                      )}
                    />
                  </button>
                ))
              : null}
          </>
        ) : null}
        {onRemove ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-2 top-2 opacity-0 shadow-sm group-hover:opacity-100"
            aria-label="이미지 삭제"
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
    </div>
  )
}

function FileAttachmentCard({
  file,
  onRemove,
}: {
  file: File
  onRemove?: () => void
}) {
  const format = fileFormatLabel(file)

  return (
    <div className="my-3 flex max-w-md items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-background text-[10px] font-semibold tracking-wide text-muted-foreground">
        {format}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {format} · {formatFileSize(file.size)}
        </p>
      </div>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${file.name} 제거`}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}

function ReferenceFilesField({
  files,
  onChange,
}: {
  files: File[]
  onChange: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function addFiles(list: FileList | File[] | null) {
    if (!list) return
    const incoming = Array.from(list)
    if (incoming.length === 0) return
    const next = [...files]
    for (const file of incoming) {
      const exists = next.some(
        (item) =>
          item.name === file.name &&
          item.size === file.size &&
          item.lastModified === file.lastModified,
      )
      if (!exists) next.push(file)
    }
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium">참고 파일 추가</span>
      <div
        className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center"
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          addFiles(event.dataTransfer.files)
        }}
      >
        <Paperclip className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          파일을 끌어다 놓거나 버튼을 눌러 첨부하세요.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => inputRef.current?.click()}
        >
          파일 선택
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
      {files.length > 0 ? (
        <div className="space-y-2">
          {files.map((file, index) => (
            <FileAttachmentCard
              key={`${file.name}-${file.size}-${file.lastModified}`}
              file={file}
              onRemove={() =>
                onChange(files.filter((_, fileIndex) => fileIndex !== index))
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AutoGrowEditable({
  textId,
  value,
  placeholder,
  className,
  onChange,
  onPasteFiles,
  onBackspaceEmpty,
}: {
  textId: string
  value: string
  placeholder?: string
  className?: string
  onChange: (text: string) => void
  onPasteFiles?: (event: ClipboardEvent<HTMLDivElement>) => void
  onBackspaceEmpty?: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || document.activeElement === el) return
    if (normalizeEditableText(el.innerText) !== value) {
      el.textContent = value
    }
  }, [value])

  return (
    <div
      ref={ref}
      data-text-id={textId}
      role="textbox"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className={cn(
        'min-h-7 w-full text-sm leading-7 outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
        className,
      )}
      onInput={(event) => {
        onChange(normalizeEditableText(event.currentTarget.innerText))
      }}
      onPaste={(event) => {
        if (event.clipboardData.files.length > 0) {
          onPasteFiles?.(event)
          return
        }
        event.preventDefault()
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          document.execCommand('insertText', false, '\n')
          return
        }
        if (
          event.key === 'Backspace' &&
          !value &&
          isCaretAtStart(event.currentTarget)
        ) {
          onBackspaceEmpty?.(event)
        }
      }}
    />
  )
}

type ImageDropTarget = {
  flowIndex: number
  offsetY: number
  textOffset: number
  xRatio: number
  lineTop: number
  lineLeft: number
  lineWidth: number
}

function applyImageWrapSize(image: ImageContentBlock, wrap: ImageWrap): ImageContentBlock {
  const nextWidth = wrap !== 'none' && image.widthPercent > 70 ? 40 : image.widthPercent
  const nextHeight =
    image.heightPx != null && nextWidth !== image.widthPercent
      ? Math.round(image.heightPx * (nextWidth / image.widthPercent))
      : image.heightPx
  return {
    ...image,
    wrap,
    widthPercent: nextWidth,
    heightPx: nextHeight,
  }
}

function BodyFlow({
  flowIndex,
  text,
  images,
  placeholder,
  readOnly,
  movingId,
  heights,
  onTextChange,
  onImageSize,
  onImageWrap,
  onImageHeight,
  onImageRemove,
  onMoveStart,
  onPasteFiles,
  onBackspaceEmpty,
}: {
  flowIndex: number
  text: TextContentBlock
  images: ImageContentBlock[]
  placeholder?: string
  readOnly?: boolean
  movingId?: string
  heights: Record<string, number>
  onTextChange?: (text: string) => void
  onImageSize?: (id: string, size: { widthPercent: number; heightPx?: number }) => void
  onImageWrap?: (id: string, wrap: ImageWrap) => void
  onImageHeight?: (id: string, height: number) => void
  onImageRemove?: (id: string) => void
  onMoveStart?: (id: string, event: PointerEvent<HTMLDivElement>) => void
  onPasteFiles?: (event: ClipboardEvent<HTMLDivElement>) => void
  onBackspaceEmpty?: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const placed = flowImageSpacers(images, { ...measuredHeights, ...heights })

  return (
    <div data-flow-frame data-flow-index={flowIndex} className="flow-root min-h-7">
      {placed.map(({ image, column, spacer }) => {
        const around = column !== 'full'
        const width = clamp(
          image.widthPercent || (around ? 40 : 100),
          MIN_IMAGE_WIDTH,
          100,
        )
        return (
          <Fragment key={image.id}>
            <div
              aria-hidden
              className={cn('w-0', column === 'right' ? 'float-right' : 'float-left')}
              style={{ height: spacer }}
            />
            <div
              className={cn(
                'mb-2',
                column === 'right' ? 'float-right clear-right' : 'float-left clear-left',
                column === 'left' && 'mr-4',
                column === 'right' && 'ml-4',
                column === 'full' && 'w-full',
              )}
              style={around ? { width: `${width}%` } : undefined}
            >
              <ResizableImage
                file={image.file}
                widthPercent={width}
                heightPx={image.heightPx}
                wrap={image.wrap ?? 'none'}
                fillParent={around}
                isMoving={movingId === image.id}
                onSizeChange={
                  onImageSize ? (size) => onImageSize(image.id, size) : undefined
                }
                onWrapChange={
                  onImageWrap ? (wrap) => onImageWrap(image.id, wrap) : undefined
                }
                onHeightChange={(height) => {
                  setMeasuredHeights((current) =>
                    current[image.id] === height
                      ? current
                      : { ...current, [image.id]: height },
                  )
                  onImageHeight?.(image.id, height)
                }}
                onMoveStart={
                  onMoveStart ? (event) => onMoveStart(image.id, event) : undefined
                }
                onRemove={onImageRemove ? () => onImageRemove(image.id) : undefined}
              />
            </div>
          </Fragment>
        )
      })}
      {readOnly ? (
        text.text.trim() ? (
          <p className="whitespace-pre-wrap text-sm leading-7">{text.text}</p>
        ) : null
      ) : (
        <AutoGrowEditable
          textId={text.id}
          value={text.text}
          placeholder={placeholder}
          onChange={(value) => onTextChange?.(value)}
          onPasteFiles={onPasteFiles}
          onBackspaceEmpty={onBackspaceEmpty}
        />
      )}
    </div>
  )
}

function RequestBodyEditor({
  blocks,
  error,
  placeholder,
  onChange,
}: {
  blocks: ContentBlock[]
  error?: string
  placeholder: string
  onChange: (blocks: ContentBlock[]) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const blocksRef = useRef(blocks)
  const onChangeRef = useRef(onChange)
  const dropTargetRef = useRef<ImageDropTarget | null>(null)
  const movingRef = useRef<{
    id: string
    startX: number
    startY: number
    x: number
    y: number
    active: boolean
  } | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [imageHeights, setImageHeights] = useState<Record<string, number>>({})
  const [moving, setMoving] = useState<{
    id: string
    startX: number
    startY: number
    x: number
    y: number
    active: boolean
  } | null>(null)
  const [dropTarget, setDropTarget] = useState<ImageDropTarget | null>(null)

  blocksRef.current = blocks
  onChangeRef.current = onChange
  dropTargetRef.current = dropTarget
  movingRef.current = moving

  const parts = splitBodyParts(blocks)
  const onlyEmptyText =
    parts.length === 1 &&
    parts[0]?.type === 'flow' &&
    parts[0].images.length === 0 &&
    !parts[0].text.text

  function commit(nextParts: BodyPart[]) {
    onChange(partsToBlocks(nextParts))
  }

  function currentParts() {
    return splitBodyParts(blocksRef.current)
  }

  function updateFlowText(flowIndex: number, text: string) {
    const next = currentParts()
    const part = next[flowIndex]
    if (!part || part.type !== 'flow') return
    next[flowIndex] = { ...part, text: { ...part.text, text } }
    commit(next)
  }

  function updateFlowImages(
    flowIndex: number,
    mutate: (images: ImageContentBlock[]) => ImageContentBlock[],
  ) {
    const next = currentParts()
    const part = next[flowIndex]
    if (!part || part.type !== 'flow') return
    next[flowIndex] = { ...part, images: mutate(part.images) }
    commit(next)
  }

  function insertFilesAtFlow(
    flowIndex: number,
    files: File[],
    offsetY: number,
    textStart: number,
    textEnd: number,
  ) {
    if (files.length === 0) return
    const next = currentParts()
    const part = next[flowIndex]
    if (!part || part.type !== 'flow') return

    const images = createImageBlocks(files, offsetY)
    const attachments = files
      .filter((file) => !isImageFile(file))
      .map((file) => ({
        id: makeBlockId(),
        type: 'file' as const,
        file,
      }))

    if (attachments.length === 0) {
      next[flowIndex] = { ...part, images: [...part.images, ...images] }
      commit(next)
      return
    }

    const before = part.text.text.slice(0, textStart)
    const after = part.text.text.slice(textEnd)
    const beforeImages = [...part.images, ...images].filter(
      (image) => (image.offsetY ?? 0) < offsetY,
    )
    const afterImages = [...part.images, ...images]
      .filter((image) => (image.offsetY ?? 0) >= offsetY)
      .map((image) => ({
        ...image,
        offsetY: Math.max(0, (image.offsetY ?? 0) - offsetY),
      }))

    next.splice(
      flowIndex,
      1,
      { type: 'flow', text: { ...part.text, text: before }, images: beforeImages },
      ...attachments.map((file) => ({ type: 'file' as const, file })),
      { type: 'flow', text: emptyTextBlock(after), images: afterImages },
    )
    commit(next)
  }

  function removeImage(id: string) {
    const next = currentParts().map((part) =>
      part.type === 'flow'
        ? { ...part, images: part.images.filter((image) => image.id !== id) }
        : part,
    )
    commit(next)
  }

  function removeFile(id: string) {
    commit(currentParts().filter((part) => part.type !== 'file' || part.file.id !== id))
  }

  function moveImageToTarget(imageId: string, target: ImageDropTarget) {
    const next = currentParts()
    let movingImage: ImageContentBlock | undefined
    for (const part of next) {
      if (part.type !== 'flow') continue
      const found = part.images.find((image) => image.id === imageId)
      if (!found) continue
      movingImage = found
      part.images = part.images.filter((image) => image.id !== imageId)
      break
    }
    const targetPart = next[target.flowIndex]
    if (!movingImage || !targetPart || targetPart.type !== 'flow') return

    const wrap =
      (movingImage.wrap ?? 'none') === 'none'
        ? 'none'
        : target.xRatio > 0.6
          ? 'right'
          : 'left'
    targetPart.images = [
      ...targetPart.images,
      applyImageWrapSize({ ...movingImage, offsetY: target.offsetY, wrap }, wrap),
    ]
    commit(next)
  }

  function offsetYFromPoint(flow: HTMLElement, clientX: number, clientY: number) {
    const rect = flow.getBoundingClientRect()
    const caret = caretFromPoint(clientX, clientY)
    if (caret && flow.contains(caret.node)) {
      const range = document.createRange()
      try {
        if (caret.node.nodeType === Node.TEXT_NODE) {
          range.setStart(
            caret.node,
            Math.min(caret.offset, caret.node.textContent?.length ?? 0),
          )
          range.collapse(true)
        } else {
          range.selectNodeContents(caret.node)
          range.collapse(true)
        }
        const caretRect = range.getBoundingClientRect()
        if (caretRect.top) return Math.max(0, Math.round(caretRect.top - rect.top))
      } catch {
        // fall through
      }
    }
    return Math.max(0, Math.round(clientY - rect.top))
  }

  function findDropTarget(clientX: number, clientY: number): ImageDropTarget | null {
    const editor = editorRef.current
    if (!editor) return null
    const flows = Array.from(editor.querySelectorAll<HTMLElement>('[data-flow-index]'))
    if (flows.length === 0) return null

    function toTarget(flow: HTMLElement, y: number): ImageDropTarget {
      const rect = flow.getBoundingClientRect()
      const editable = flow.querySelector<HTMLElement>('[data-text-id]')
      const caret = editable ? caretFromPoint(clientX, clientY) : null
      let textOffset = editable ? normalizeEditableText(editable.innerText).length : 0
      let lineTop = clamp(y, rect.top, rect.bottom)
      if (editable && caret && editable.contains(caret.node)) {
        textOffset = textOffsetInElement(editable, caret.node, caret.offset)
        const range = document.createRange()
        try {
          if (caret.node.nodeType === Node.TEXT_NODE) {
            range.setStart(
              caret.node,
              Math.min(caret.offset, caret.node.textContent?.length ?? 0),
            )
            range.collapse(true)
            const caretRect = range.getBoundingClientRect()
            if (caretRect.top) lineTop = caretRect.top
          }
        } catch {
          // keep lineTop
        }
      }
      return {
        flowIndex: Number(flow.dataset.flowIndex),
        offsetY: offsetYFromPoint(flow, clientX, y),
        textOffset,
        xRatio: (clientX - rect.left) / Math.max(rect.width, 1),
        lineTop,
        lineLeft: rect.left,
        lineWidth: rect.width,
      }
    }

    for (const flow of flows) {
      const rect = flow.getBoundingClientRect()
      if (
        clientY >= rect.top - 12 &&
        clientY <= rect.bottom + 12 &&
        clientX >= rect.left - 16 &&
        clientX <= rect.right + 16
      ) {
        return toTarget(flow, clientY)
      }
    }

    let best: ImageDropTarget | null = null
    let bestDist = Infinity
    for (const flow of flows) {
      const rect = flow.getBoundingClientRect()
      const dist = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom))
      if (dist < bestDist) {
        bestDist = dist
        best = toTarget(flow, clientY < rect.top ? rect.top : rect.bottom)
      }
    }
    return best
  }

  function handleFlowPaste(flowIndex: number, event: ClipboardEvent<HTMLDivElement>) {
    const pasted = Array.from(event.clipboardData.files)
    if (pasted.length === 0) return
    event.preventDefault()
    const { start, end } = getEditableSelectionOffsets(event.currentTarget)
    const flow = event.currentTarget.closest<HTMLElement>('[data-flow-frame]')
    const selectionRect = window.getSelection()?.rangeCount
      ? window.getSelection()?.getRangeAt(0).getBoundingClientRect()
      : null
    const offsetY =
      flow && selectionRect?.top
        ? Math.max(0, Math.round(selectionRect.top - flow.getBoundingClientRect().top))
        : 0
    insertFilesAtFlow(flowIndex, pasted, offsetY, start, end)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDraggingFiles(false)
    if (movingRef.current?.active) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    const target =
      findDropTarget(event.clientX, event.clientY) ??
      ({
        flowIndex: Math.max(
          0,
          parts.map((part, index) => (part.type === 'flow' ? index : -1)).filter((index) => index >= 0).at(-1) ?? 0,
        ),
        offsetY: 0,
        textOffset: 0,
        xRatio: 0,
        lineTop: 0,
        lineLeft: 0,
        lineWidth: 0,
      } satisfies ImageDropTarget)
    const part = parts[target.flowIndex]
    const textOffset =
      part?.type === 'flow' ? part.text.text.length : target.textOffset
    insertFilesAtFlow(target.flowIndex, files, target.offsetY, textOffset, textOffset)
  }

  useEffect(() => {
    if (!moving) return

    function onPointerMove(event: globalThis.PointerEvent) {
      const current = movingRef.current
      if (!current) return
      const next = {
        ...current,
        x: event.clientX,
        y: event.clientY,
        active:
          current.active ||
          Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 6,
      }
      movingRef.current = next
      setMoving(next)
      if (next.active) {
        const target = findDropTarget(event.clientX, event.clientY)
        dropTargetRef.current = target
        setDropTarget(target)
      }
    }

    function onPointerUp() {
      const current = movingRef.current
      const target = dropTargetRef.current
      if (current?.active && target) {
        moveImageToTarget(current.id, target)
      }
      movingRef.current = null
      dropTargetRef.current = null
      setMoving(null)
      setDropTarget(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [moving?.id])

  const movingFile = moving
    ? blocks.find(
        (block): block is ImageContentBlock =>
          block.id === moving.id && block.type === 'image',
      )
    : undefined

  return (
    <div className="space-y-2">
      <span className="flex items-center gap-1 text-sm font-medium">
        요청 내용 <span className="text-danger">*</span>
      </span>

      <div
        ref={editorRef}
        className={cn(
          'relative min-h-72 rounded-md border border-border bg-card px-4 py-4',
          isDraggingFiles && 'border-primary bg-primary/5',
          moving?.active && 'select-none',
          error && 'border-danger',
        )}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!movingRef.current?.active && event.dataTransfer.types.includes('Files')) {
            setIsDraggingFiles(true)
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = movingRef.current?.active ? 'none' : 'copy'
        }}
        onDragLeave={() => setIsDraggingFiles(false)}
        onDrop={handleDrop}
      >
        {parts.map((part, index) => {
          if (part.type === 'file') {
            return (
              <FileAttachmentCard
                key={part.file.id}
                file={part.file.file}
                onRemove={() => removeFile(part.file.id)}
              />
            )
          }

          const previous = parts[index - 1]
          return (
            <BodyFlow
              key={part.text.id}
              flowIndex={index}
              text={part.text}
              images={part.images}
              placeholder={
                onlyEmptyText ? placeholder : '이어서 설명을 작성하세요.'
              }
              movingId={moving?.active ? moving.id : undefined}
              heights={imageHeights}
              onTextChange={(text) => updateFlowText(index, text)}
              onImageSize={(id, size) =>
                updateFlowImages(index, (images) =>
                  images.map((image) =>
                    image.id === id
                      ? { ...image, widthPercent: size.widthPercent, heightPx: size.heightPx }
                      : image,
                  ),
                )
              }
              onImageWrap={(id, wrap) =>
                updateFlowImages(index, (images) =>
                  images.map((image) =>
                    image.id === id ? applyImageWrapSize(image, wrap) : image,
                  ),
                )
              }
              onImageHeight={(id, height) => {
                setImageHeights((current) =>
                  current[id] === height ? current : { ...current, [id]: height },
                )
              }}
              onImageRemove={removeImage}
              onMoveStart={(id, event) => {
                event.preventDefault()
                const next = {
                  id,
                  startX: event.clientX,
                  startY: event.clientY,
                  x: event.clientX,
                  y: event.clientY,
                  active: false,
                }
                movingRef.current = next
                setMoving(next)
              }}
              onPasteFiles={(event) => handleFlowPaste(index, event)}
              onBackspaceEmpty={(event) => {
                if (previous?.type === 'file') {
                  event.preventDefault()
                  removeFile(previous.file.id)
                }
              }}
            />
          )
        })}
        {moving?.active && dropTarget ? (
          <div
            className="pointer-events-none fixed z-50 h-0.5 rounded-full bg-primary"
            style={{
              top: dropTarget.lineTop,
              left: dropTarget.lineLeft,
              width: dropTarget.lineWidth,
            }}
          />
        ) : null}
        {moving?.active && movingFile ? (
          <div
            className="pointer-events-none fixed z-50 w-36 overflow-hidden rounded-md border border-border bg-card opacity-80 shadow-lg"
            style={{ left: moving.x + 12, top: moving.y + 12 }}
          >
            <ImagePreview
              file={movingFile.file}
              className="block h-20 w-full object-cover"
            />
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        이미지를 끌어 줄 사이에 놓으면 그 높이에 고정됩니다. 위쪽 글이 늘어나도 이미지는
        밀리지 않고, 배치 아이콘에 따라 옆이나 아래로 글이 이어집니다.
      </p>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  )
}

function WorkRequestForm({ owner }: { owner: WorkRequestOwner }) {
  useRenderWatch(`WorkRequestForm:${owner}`)
  const config = WORK_REQUEST_CONFIG[owner]
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const brandsQuery = useQuery({
    queryKey: ['brand-directory'],
    queryFn: listBrandDirectory,
  })
  const brands = brandsQuery.data ?? emptyList()
  const pageTopRef = useRef<HTMLDivElement>(null)
  const [screen, setScreen] = useState<RequestScreen>({ kind: 'list' })
  const [requests, setRequests] = useState<WorkRequestRecord[]>(() =>
    createDemoRequests(owner),
  )
  const [brandFilter, setBrandFilter] = useState<'all' | 'undecided' | string>(
    () => (searchParams.get('brand') === 'undecided' ? 'undecided' : 'all'),
  )
  const [formBrandId, setFormBrandId] = useState('')
  const [listSection, setListSection] = useState<WorkListSection>('sent')
  const [completedFrom, setCompletedFrom] = useState(() => dateFromToday(-30))
  const [completedTo, setCompletedTo] = useState(() => dateFromToday(0))
  const [values, setValues] = useState<FormValues>(createEmptyValues)
  const [errors, setErrors] = useState<FormErrors>({})
  const [hasEdited, setHasEdited] = useState(false)
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const [detailRequestId, setDetailRequestId] = useState<string | null>(null)
  const [acceptRequestId, setAcceptRequestId] = useState<string | null>(null)
  const [reviewConfirmId, setReviewConfirmId] = useState<string | null>(null)
  const [currentWorkByMember, setCurrentWorkByMember] = useState<
    Record<string, string>
  >(() => demoCurrentWork(owner))
  const [workTimeByKey, setWorkTimeByKey] = useState<Record<string, WorkTimeLog>>(
    () => demoWorkTime(owner),
  )
  const [workClock, setWorkClock] = useState(() => Date.now())

  const currentDepartment = profile?.departmentName
    ? departmentDisplayName(profile.departmentName)
    : '현재 부서'
  const viewRole = resolveWorkRequestViewRole(
    owner,
    profile?.departmentName,
    profile?.position,
    profile?.capabilities,
  )
  const isDestinationMember = viewRole !== 'requester'
  const canManage = viewRole === 'manager'
  const teamMembers = localTeamMembers(
    config.teamName,
    profile?.displayName,
    profile?.position,
  )

  useEffect(() => {
    setListSection(canManage ? 'inbox' : isDestinationMember ? 'mine' : 'sent')
    setCurrentWorkByMember(demoCurrentWork(owner))
    setWorkTimeByKey(demoWorkTime(owner))
  }, [canManage, isDestinationMember, owner])

  useEffect(() => {
    const hasMounted = Object.values(workTimeByKey).some((log) => log.mountedAt)
    if (!hasMounted) return
    const timer = window.setInterval(() => setWorkClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [workTimeByKey])

  useEffect(() => {
    if (screen.kind === 'form' && isDestinationMember && !screen.requestId) {
      setScreen({ kind: 'list' })
    }
  }, [isDestinationMember, screen])

  useEffect(() => {
    if (!detailRequestId && !acceptRequestId && !reviewConfirmId) return
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (reviewConfirmId) {
        setReviewConfirmId(null)
        return
      }
      setFlashMessage(null)
      setAcceptRequestId(null)
      setDetailRequestId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [acceptRequestId, detailRequestId, reviewConfirmId])

  const editingRequest =
    screen.kind === 'form' && screen.requestId
      ? requests.find((request) => request.id === screen.requestId)
      : undefined
  const selectedRequest = detailRequestId
    ? requests.find((request) => request.id === detailRequestId)
    : undefined
  const acceptingRequest = acceptRequestId
    ? requests.find((request) => request.id === acceptRequestId)
    : undefined
  const reviewConfirmRequest = reviewConfirmId
    ? requests.find((request) => request.id === reviewConfirmId)
    : undefined

  function departmentLabel(value: string) {
    if (value === LOCAL_CURRENT_DEPARTMENT) return currentDepartment
    return departmentDisplayName(value)
  }

  function memberLabel(value: string) {
    if (!value) return '미정'
    const member = teamMembers.find((item) => item.id === value)
    if (!member) return value
    return `${member.name}${member.isSelf ? ' (나)' : ''} · ${member.position}`
  }

  function requesterLabel(request: WorkRequestRecord) {
    const position =
      request.values.requesterPosition ||
      (isCurrentUserRequest(
        request.requesterDepartment,
        profile?.departmentName,
      )
        ? profile?.position
        : '')
    return personLabel(request.values.requester, position)
  }

  function openForm(request?: WorkRequestRecord) {
    setFormBrandId(request?.brandId ?? '')
    setValues(
      request
        ? { ...request.values }
        : {
            ...createEmptyValues(),
            requester: profile?.displayName ?? '',
            requesterPosition: profile?.position ?? '',
          },
    )
    setErrors({})
    setHasEdited(false)
    setFlashMessage(null)
    setScreen({ kind: 'form', requestId: request?.id })
  }

  function updateValue<K extends keyof FormValues>(
    fieldId: K,
    value: FormValues[K],
  ) {
    setValues((current) => ({ ...current, [fieldId]: value }))
    setErrors((current) => {
      if (!current[fieldId]) return current
      const next = { ...current }
      delete next[fieldId]
      return next
    })
    setHasEdited(true)
  }

  function cancelEditing() {
    if (
      hasEdited &&
      !window.confirm('작성 중인 변경 내용을 지우고 돌아갈까요?')
    ) {
      return
    }
    setErrors({})
    setHasEdited(false)
    if (editingRequest) setDetailRequestId(editingRequest.id)
    setScreen({ kind: 'list' })
  }

  function validate(): FormErrors {
    const nextErrors: FormErrors = {}
    if (!values.title.trim()) nextErrors.title = '요청 제목을 입력하세요.'
    if (!values.deadlineType) nextErrors.deadlineType = '일정 성격을 선택하세요.'
    if (!values.dueDate) nextErrors.dueDate = '희망 마감일을 선택하세요.'
    if (values.deadlineType === 'fixed' && !values.scheduleReason.trim()) {
      nextErrors.scheduleReason = '변경할 수 없는 일정의 사유를 입력하세요.'
    }
    if (!hasRequestBody(values.blocks)) {
      nextErrors.blocks = '요청 내용을 입력하거나 이미지를 넣어 주세요.'
    }
    return nextErrors
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validate()
    setErrors(nextErrors)
    pageTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (Object.keys(nextErrors).length > 0) return

    const now = new Date().toISOString()
    if (editingRequest) {
      setRequests((current) =>
        current.map((request) =>
          request.id === editingRequest.id
            ? {
                ...request,
                values: { ...values },
                brandId: request.brandId || formBrandId,
                updatedAt: now,
              }
            : request,
        ),
      )
      setFlashMessage('요청 내용을 수정했습니다.')
      setDetailRequestId(editingRequest.id)
      setScreen({ kind: 'list' })
    } else {
      const id = makeRequestId()
      setRequests((current) => [
        {
          id,
          owner,
          brandId: formBrandId,
          brandDecidedAt: formBrandId ? now : '',
          brandDecidedBy: formBrandId ? LOCAL_SELF_ID : '',
          values: { ...values },
          requesterDepartment:
            profile?.departmentName?.trim() || LOCAL_CURRENT_DEPARTMENT,
          status: 'requested',
          managerPriority: '',
          assignee: '',
          assignedBy: '',
          assignedAt: '',
          collaborators: [],
          confirmedDueDate: '',
          plannedStart: '',
          plannedEnd: '',
          messages: [],
          createdAt: now,
          updatedAt: now,
          completedAt: '',
          completionRequestedAt: '',
          completionRejectCount: 0,
        },
        ...current,
      ])
      setFlashMessage('작업 요청을 등록했습니다.')
      setDetailRequestId(id)
      setScreen({ kind: 'list' })
    }
    setHasEdited(false)
  }

  function deleteRequest(request: WorkRequestRecord) {
    if (request.status !== 'requested') return
    if (!window.confirm(`"${request.values.title}" 요청을 삭제할까요?`)) {
      return
    }
    setRequests((current) => current.filter((item) => item.id !== request.id))
    setFlashMessage('작업 요청을 삭제했습니다.')
    setDetailRequestId(null)
    setScreen({ kind: 'list' })
  }

  function cancelRequest(request: WorkRequestRecord) {
    if (
      isClosedStatus(request.status) ||
      !window.confirm('이 작업 요청을 취소할까요?')
    ) {
      return
    }
    setRequests((current) =>
      current.map((item) =>
        item.id === request.id
          ? {
              ...item,
              status: 'cancelled',
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    )
    setFlashMessage('작업 요청을 취소했습니다.')
  }

  function updateRequest(
    requestId: string,
    patch: Partial<WorkRequestRecord>,
  ) {
    const now = new Date().toISOString()
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? {
              ...request,
              ...patch,
              assignedAt:
                patch.assignedAt ||
                request.assignedAt ||
                (patch.assignee && patch.assignee !== request.assignee
                  ? now
                  : ''),
              completedAt:
                patch.completedAt ||
                (patch.status === 'completed'
                  ? request.completedAt || now
                  : request.completedAt),
              updatedAt: now,
            }
          : request,
      ),
    )
    if (
      (patch.status === 'completed' ||
        patch.status === 'cancelled' ||
        patch.status === 'rejected' ||
        isCompletionPending(patch.status ?? 'requested')) &&
      currentWorkByMember[LOCAL_SELF_ID] === requestId
    ) {
      const clock = Date.now()
      setCurrentWorkByMember((current) => {
        const next = { ...current }
        delete next[LOCAL_SELF_ID]
        return next
      })
      setWorkTimeByKey((current) =>
        flushWorkTime(current, LOCAL_SELF_ID, requestId, clock),
      )
      setWorkClock(clock)
    }
  }

  function canWriteChat(request: WorkRequestRecord) {
    const isSelfRequest = isCurrentUserRequest(
      request.requesterDepartment,
      profile?.departmentName,
    )
    if (isSelfRequest) return true
    if (canManage && request.owner === owner) return true
    return (
      request.assignee === LOCAL_SELF_ID ||
      request.collaborators.includes(LOCAL_SELF_ID)
    )
  }

  function addMessage(requestId: string, body: string, roomId: string) {
    const text = body.trim()
    if (!text) return
    const message: WorkRequestMessage = {
      id: makeMessageId(),
      roomId,
      authorId: LOCAL_SELF_ID,
      authorName: profile?.displayName?.trim() || '나',
      authorPosition: profile?.position ?? '',
      body: text,
      createdAt: new Date().toISOString(),
    }
    setRequests((current) =>
      current.map((request) => {
        if (request.id !== requestId) return request
        const nextStatus =
          canManage &&
          request.owner === owner &&
          request.status === 'requested'
            ? 'reviewing'
            : request.status
        return {
          ...request,
          status: nextStatus,
          messages: [...request.messages, message],
          updatedAt: message.createdAt,
        }
      }),
    )
    if (canManage) {
      const target = requests.find((item) => item.id === requestId)
      if (target?.status === 'requested') {
        setFlashMessage('첫 메시지로 검토를 시작했습니다.')
      }
    }
  }

  function acceptRequest(
    request: WorkRequestRecord,
    decision: {
      managerPriority: WorkRequestRecord['managerPriority']
      confirmedDueDate: string
      collaborators: string[]
    },
  ) {
    updateRequest(request.id, {
      status: 'accepted',
      assignee: '',
      assignedBy: '',
      managerPriority: decision.managerPriority,
      confirmedDueDate: decision.confirmedDueDate,
      collaborators: decision.collaborators,
      plannedStart: '',
      plannedEnd: '',
    })
    setAcceptRequestId(null)
    setFlashMessage('요청을 수락했습니다. 일정표에서 담당자를 배정하세요.')
    setListSection('team')
  }

  function rejectRequest(request: WorkRequestRecord) {
    const reason = window.prompt(
      '반려 사유를 입력하세요. 조율 대화에 남습니다.',
    )
    if (reason == null) return
    const text = reason.trim() || '요청을 반려했습니다.'
    const message: WorkRequestMessage = {
      id: makeMessageId(),
      roomId: REQUESTER_CHAT_ROOM,
      authorId: LOCAL_SELF_ID,
      authorName: profile?.displayName?.trim() || '나',
      authorPosition: profile?.position ?? '',
      body: text,
      createdAt: new Date().toISOString(),
    }
    updateRequest(request.id, {
      status: 'rejected',
      messages: [...request.messages, message],
    })
    setFlashMessage('요청을 반려했습니다.')
  }

  function requestCompletion(request: WorkRequestRecord) {
    updateRequest(request.id, {
      status: nextCompletionStatus(request),
      completionRequestedAt: new Date().toISOString(),
    })
    setFlashMessage(
      needsLeadCompletionReview(request)
        ? '완료를 요청했습니다. 팀장 확인을 기다립니다.'
        : '완료를 요청했습니다. 요청자 확인을 기다립니다.',
    )
  }

  function acceptCompletion(request: WorkRequestRecord) {
    updateRequest(request.id, { status: 'completionConfirm' })
    setFlashMessage('완료를 수락했습니다. 요청자 확인을 기다립니다.')
  }

  function rejectCompletion(
    request: WorkRequestRecord,
    roomId: string,
  ) {
    const reason = window.prompt(
      '반려 사유를 입력하세요. 작업 수준이 부족하면 다시 진행하게 됩니다.',
    )
    if (reason == null) return
    const text = reason.trim() || '완료 요청을 반려했습니다.'
    const message: WorkRequestMessage = {
      id: makeMessageId(),
      roomId,
      authorId: LOCAL_SELF_ID,
      authorName: profile?.displayName?.trim() || '나',
      authorPosition: profile?.position ?? '',
      body: text,
      createdAt: new Date().toISOString(),
    }
    updateRequest(request.id, {
      status: 'inProgress',
      completionRejectCount: request.completionRejectCount + 1,
      messages: [...request.messages, message],
    })
    setFlashMessage('완료 요청을 반려했습니다. 다시 진행합니다.')
  }

  function confirmCompletion(request: WorkRequestRecord) {
    updateRequest(request.id, { status: 'completed' })
    setFlashMessage('결과를 확인했습니다. 완료되었습니다.')
  }

  function matchesBrandFilter(request: WorkRequestRecord) {
    if (brandFilter === 'all') return true
    if (brandFilter === 'undecided') return isBrandUndecided(request)
    return request.brandId === brandFilter
  }

  const destinationRequests = requests.filter(
    (request) => request.owner === owner && matchesBrandFilter(request),
  )
  const incomingRequests = destinationRequests.filter(
    (request) =>
      !isDestinationMember ||
      request.requesterDepartment !== LOCAL_CURRENT_DEPARTMENT,
  )
  const sentRequests = destinationRequests.filter((request) =>
    isCurrentUserRequest(request.requesterDepartment, profile?.departmentName),
  )
  const unreviewedRequests = incomingRequests
    .filter((request) => request.status === 'requested')
    .sort(compareRequestsByDeadline)
  const reviewingRequests = incomingRequests
    .filter((request) => request.status === 'reviewing')
    .sort(compareRequestsByDeadline)
  const completionReviewRequests = incomingRequests
    .filter((request) => request.status === 'completionReview')
    .sort(compareRequestsByDeadline)
  const managerQueue = [
    ...unreviewedRequests,
    ...reviewingRequests,
    ...completionReviewRequests,
  ]
  const unassignedTeamRequests = incomingRequests
    .filter((request) => request.status === 'accepted' && !request.assignee)
    .sort(compareRequestsByDeadline)
  const activeTeamRequests = incomingRequests.filter(
    (request) => !isClosedStatus(request.status) && Boolean(request.assignee),
  )
  const myTasks = incomingRequests.filter(
    (request) =>
      request.assignee === LOCAL_SELF_ID ||
      request.collaborators.includes(LOCAL_SELF_ID),
  )
  const myActiveTasks = myTasks.filter(
    (request) => !isClosedStatus(request.status),
  )
  const completedRequests = (
    canManage
      ? incomingRequests
      : isDestinationMember
        ? myTasks
        : sentRequests
  ).filter((request) => request.status === 'completed')
  const managerDueSoon = activeTeamRequests.filter((request) => {
    const dueDate = request.confirmedDueDate || request.values.dueDate
    const variant = deadlineLabel(dueDate).variant
    return variant === 'danger' || variant === 'warning'
  }).length
  const myDueSoon = myActiveTasks.filter((request) => {
    const dueDate = request.confirmedDueDate || request.values.dueDate
    const variant = deadlineLabel(dueDate).variant
    return variant === 'danger' || variant === 'warning'
  }).length
  const myTodoTasks = myActiveTasks.filter(
    (request) => !isCompletionPending(request.status),
  )
  const myCompletionPendingTasks = myActiveTasks.filter((request) =>
    isCompletionPending(request.status),
  )

  const listSections: {
    id: WorkListSection
    label: string
    count?: number
  }[] = canManage
    ? [
        { id: 'inbox', label: '접수 대기', count: managerQueue.length },
        {
          id: 'team',
          label: '팀 업무',
          count: activeTeamRequests.length + unassignedTeamRequests.length,
        },
        { id: 'mine', label: '내 업무', count: myActiveTasks.length },
        { id: 'completed', label: '완료', count: completedRequests.length },
      ]
    : isDestinationMember
      ? [
          { id: 'mine', label: '내 업무', count: myActiveTasks.length },
          { id: 'completed', label: '완료', count: completedRequests.length },
        ]
      : [{ id: 'sent', label: '보낸 요청', count: sentRequests.length }]

  const allowedSection: WorkListSection = canManage
    ? listSection === 'team' ||
      listSection === 'mine' ||
      listSection === 'completed'
      ? listSection
      : 'inbox'
    : isDestinationMember
      ? listSection === 'completed'
        ? 'completed'
        : 'mine'
      : 'sent'

  function openRequest(request: WorkRequestRecord) {
    if (
      canManage &&
      request.owner === owner &&
      request.status === 'requested'
    ) {
      setReviewConfirmId(request.id)
      return
    }
    setFlashMessage(null)
    setFormBrandId(request.brandId)
    setDetailRequestId(request.id)
  }

  function workDurationMs(memberId: string, requestId: string) {
    return currentWorkElapsedMs(
      workTimeByKey[workTimeKey(memberId, requestId)],
      workClock,
    )
  }

  function workDurationLabel(memberId: string, requestId: string) {
    return formatWorkDuration(workDurationMs(memberId, requestId))
  }

  function mountCurrentWork(requestId: string) {
    const now = Date.now()
    const previous = currentWorkByMember[LOCAL_SELF_ID]
    setCurrentWorkByMember((current) => ({
      ...current,
      [LOCAL_SELF_ID]: requestId,
    }))
    setWorkTimeByKey((current) => {
      let next = current
      if (previous && previous !== requestId) {
        next = flushWorkTime(next, LOCAL_SELF_ID, previous, now)
      }
      return startWorkTime(next, LOCAL_SELF_ID, requestId, now)
    })
    setWorkClock(now)
    setFlashMessage('지금 하는 업무로 장착했습니다. 팀장 화면에 바로 보입니다.')
  }

  function unmountCurrentWork() {
    const now = Date.now()
    const previous = currentWorkByMember[LOCAL_SELF_ID]
    setCurrentWorkByMember((current) => {
      const next = { ...current }
      delete next[LOCAL_SELF_ID]
      return next
    })
    if (previous) {
      setWorkTimeByKey((current) =>
        flushWorkTime(current, LOCAL_SELF_ID, previous, now),
      )
    }
    setWorkClock(now)
    setFlashMessage('지금 하는 업무에서 뺐습니다.')
  }

  function startReview(request: WorkRequestRecord) {
    updateRequest(request.id, { status: 'reviewing' })
    setReviewConfirmId(null)
    setFlashMessage(null)
    setFormBrandId(request.brandId)
    setDetailRequestId(request.id)
  }

  function closeRequest() {
    setFlashMessage(null)
    setDetailRequestId(null)
  }

  function renderEmptyState(title: string, description: string) {
    return (
      <Card>
        <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ClipboardPlus className="size-6" />
          </div>
          <p className="mt-4 font-semibold">{title}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {description}
          </p>
        </CardContent>
      </Card>
    )
  }

  function renderRequestRow(
    request: WorkRequestRecord,
    context: 'queue' | 'mine' | 'sent' | 'completed',
  ) {
    const status = STATUS_META[request.status]
    const dueDate = request.confirmedDueDate || request.values.dueDate
    const deadline = deadlineLabel(dueDate)
    const isPrimaryAssignee = request.assignee === LOCAL_SELF_ID
    const isMounted = currentWorkByMember[LOCAL_SELF_ID] === request.id
    const completionPending = isCompletionPending(request.status)
    const canStartWork =
      isPrimaryAssignee && request.status === 'accepted'
    const canResumeWork =
      isPrimaryAssignee && request.status === 'waiting'
    const canRequestCompletion =
      isPrimaryAssignee && request.status === 'inProgress'
    const workActionLabel = canStartWork
      ? '업무 시작'
      : canResumeWork
        ? '다시 진행'
        : '완료 요청'
    const isSelfRequest =
      !isDestinationMember &&
      isCurrentUserRequest(request.requesterDepartment, profile?.departmentName)

    return (
      <Card
        key={request.id}
        className={cn(detailRequestId === request.id && 'ring-2 ring-primary')}
      >
        <CardContent className="p-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
                <Badge variant={isBrandUndecided(request) ? 'warning' : 'muted'}>
                  {brandLabelForRequest(request, brands)}
                </Badge>
                {request.managerPriority ? (
                  <Badge
                    variant={PRIORITY_META[request.managerPriority].variant}
                  >
                    {PRIORITY_META[request.managerPriority].label}
                  </Badge>
                ) : null}
                <Badge variant={deadline.variant}>{deadline.label}</Badge>
                {request.collaborators.includes(LOCAL_SELF_ID) &&
                !isPrimaryAssignee ? (
                  <Badge variant="muted">협업 참여</Badge>
                ) : null}
                {currentWorkByMember[LOCAL_SELF_ID] === request.id ? (
                  <Badge variant="default">지금 하는 중</Badge>
                ) : null}
              </div>
              <h3 className="mt-2 truncate text-base font-semibold">
                {request.values.title}
              </h3>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {context === 'sent' ? (
                  <>
                    {departmentLabel(request.requesterDepartment)} →{' '}
                    {WORK_REQUEST_CONFIG[request.owner].teamName}
                  </>
                ) : (
                  <>
                    {departmentLabel(request.requesterDepartment)} · 요청자{' '}
                    {requesterLabel(request)}
                  </>
                )}{' '}
                · {formatDateTime(request.createdAt)}
              </p>
            </div>

            <div className="flex w-full flex-wrap gap-x-5 gap-y-2 text-sm xl:w-auto xl:flex-nowrap">
              {context === 'queue' ? (
                <>
                  <div className="shrink-0">
                    <p className="text-xs text-muted-foreground">요청 희망일</p>
                    <p className="mt-1 font-medium tabular-nums">
                      {formatSlashDate(request.values.dueDate)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <p className="text-xs text-muted-foreground">대화</p>
                    <p className="mt-1 font-medium tabular-nums">
                      {request.messages.length}건
                    </p>
                  </div>
                  <div className="shrink-0">
                    <p className="text-xs text-muted-foreground">일정 성격</p>
                    <p className="mt-1 font-medium">
                      {request.values.deadlineType === 'fixed'
                        ? '변경 불가'
                        : '희망일'}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="shrink-0">
                    <p className="text-xs text-muted-foreground">확정 마감</p>
                    <p className="mt-1 font-medium tabular-nums">
                      {formatSlashDate(dueDate)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <p className="text-xs text-muted-foreground">
                      {context === 'mine' ? '작업 예정' : '주 담당자'}
                    </p>
                    <p className="mt-1 font-medium">
                      {context === 'mine'
                        ? request.plannedStart
                          ? `${formatSlashDate(requestPlannedRange(request).start)}~${formatSlashDate(requestPlannedRange(request).end)}`
                          : '미정'
                        : memberLabel(request.assignee)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <p className="text-xs text-muted-foreground">
                      {context === 'mine' ? '주 담당자' : '협업자'}
                    </p>
                    <p className="mt-1 font-medium">
                      {context === 'mine'
                        ? memberLabel(request.assignee)
                        : request.collaborators.length > 0
                          ? request.collaborators.map(memberLabel).join(', ')
                          : '없음'}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div
              className={
                context === 'mine'
                  ? 'grid w-[20.75rem] shrink-0 grid-cols-[4.5rem_4.5rem_5.75rem_4.5rem] gap-2'
                  : 'flex flex-wrap gap-2 [&_button]:shrink-0 [&_button]:whitespace-nowrap xl:flex-nowrap xl:justify-end'
              }
            >
              {context === 'mine' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full px-0"
                    disabled={isMounted || completionPending}
                    title={
                      completionPending
                        ? '완료 확인 중에는 장착할 수 없습니다'
                        : isMounted
                          ? '이미 장착한 업무입니다'
                          : '이 업무를 지금 하는 일로 장착'
                    }
                    onClick={() => mountCurrentWork(request.id)}
                  >
                    장착
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full px-0"
                    disabled={!isMounted || completionPending}
                    title={
                      completionPending
                        ? '완료 확인 중에는 뺄 수 없습니다'
                        : isMounted
                          ? '지금 하는 일에서 빼기'
                          : '장착한 업무가 아닙니다'
                    }
                    onClick={unmountCurrentWork}
                  >
                    빼기
                  </Button>
                  <Button
                    type="button"
                    variant={canRequestCompletion ? 'secondary' : 'default'}
                    size="sm"
                    className="w-full px-0"
                    disabled={
                      !canStartWork && !canResumeWork && !canRequestCompletion
                    }
                    title={
                      canStartWork
                        ? '이 업무를 시작합니다'
                        : canResumeWork
                          ? '보류한 업무를 다시 진행합니다'
                          : canRequestCompletion
                            ? '완료를 요청합니다'
                            : completionPending
                              ? '이미 완료 확인 중입니다'
                              : '진행 중인 주 담당 업무만 완료 요청할 수 있습니다'
                    }
                    onClick={() => {
                      if (canStartWork || canResumeWork) {
                        updateRequest(request.id, { status: 'inProgress' })
                        return
                      }
                      if (canRequestCompletion) requestCompletion(request)
                    }}
                  >
                    {workActionLabel}
                  </Button>
                </>
              ) : null}

              {context === 'queue' &&
              canManage &&
              request.status === 'completionReview' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => acceptCompletion(request)}
                  >
                    완료 수락
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      rejectCompletion(request, request.assignee)
                    }
                  >
                    반려
                  </Button>
                </>
              ) : null}
              {context === 'sent' &&
              isSelfRequest &&
              request.status === 'completionConfirm' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => confirmCompletion(request)}
                  >
                    결과 확인
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      rejectCompletion(request, REQUESTER_CHAT_ROOM)
                    }
                  >
                    반려
                  </Button>
                </>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className={context === 'mine' ? 'w-full px-0' : undefined}
                onClick={() => openRequest(request)}
              >
                {context === 'mine' ? null : <Eye className="size-3.5" />}
                상세
              </Button>
              {context === 'sent' &&
              isSelfRequest &&
              request.status === 'requested' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="요청 수정"
                  onClick={() => openForm(request)}
                >
                  <Pencil className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (screen.kind === 'list') {
    const managerStats = [
      {
        label: '신규·검토',
        value: incomingRequests.filter(
          (request) =>
            request.status === 'requested' || request.status === 'reviewing',
        ).length,
        description: '접수 판단 필요',
      },
      {
        label: '미배정',
        value: incomingRequests.filter(
          (request) => request.status === 'accepted' && !request.assignee,
        ).length,
        description: '담당자 지정 필요',
      },
      {
        label: '진행 중',
        value: incomingRequests.filter(
          (request) => request.status === 'inProgress',
        ).length,
        description: '팀에서 처리 중',
      },
      {
        label: '마감 주의',
        value: managerDueSoon,
        description: '3일 이내 또는 초과',
      },
    ]
    const employeeStats = [
      {
        label: '지금 하는 업무',
        value: myActiveTasks.some(
          (request) => request.id === currentWorkByMember[LOCAL_SELF_ID],
        )
          ? 1
          : 0,
        description: '오늘 장착한 업무',
      },
      {
        label: '내 진행 업무',
        value: myActiveTasks.filter(
          (request) => request.status !== 'waiting',
        ).length,
        description: '주 담당·협업 포함',
      },
      {
        label: '보류',
        value: myActiveTasks.filter(
          (request) => request.status === 'waiting',
        ).length,
        description: '확인 또는 자료 대기',
      },
      {
        label: '마감 주의',
        value: myDueSoon,
        description: '3일 이내 또는 초과',
      },
    ]
    const stats = canManage
      ? managerStats
      : isDestinationMember
        ? employeeStats
        : []

    return (
      <div ref={pageTopRef}>
        <PageHeader
          title={
            canManage
              ? `${config.teamName} 업무 관리`
              : isDestinationMember
                ? `내 ${config.teamName} 업무`
                : `${config.teamName} 작업 요청`
          }
          description={
            canManage
              ? `여러 부서에서 ${config.teamName}으로 들어온 요청을 접수하고 담당자를 배정합니다.`
              : isDestinationMember
                ? `주 담당자 또는 협업자로 배정된 ${config.teamName} 업무만 확인합니다.`
                : `${currentDepartment}에서 ${config.teamName}으로 보낸 요청과 진행 상태를 확인합니다.`
          }
          actions={
            <>
              <Badge variant={canManage ? 'default' : 'muted'}>
                {canManage
                  ? `관리자 화면 · ${profile?.position || '관리자'}`
                  : isDestinationMember
                    ? `사원 화면 · ${profile?.position || '사원'}`
                    : `${currentDepartment} 요청자 화면`}
              </Badge>
              {isDestinationMember ? null : (
                <Button type="button" onClick={() => openForm()}>
                  <Plus className="size-4" />
                  작업 요청 하기
                </Button>
              )}
            </>
          }
        />

        <div className="mb-5 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <span className="font-medium">
            현재 {currentDepartment} · {profile?.position || '직급 미설정'} 기준으로{' '}
            {canManage
              ? `${config.teamName} 관리자용 접수·배정 화면`
              : isDestinationMember
                ? `${config.teamName} 사원용 개인 업무 화면`
                : `${config.teamName}으로 요청하는 화면`}
            을 표시하고 있습니다.
          </span>
          <span className="ml-2 text-muted-foreground">
            내 설정에서 직급을 바꾸면 화면이 전환됩니다. 팀장·이사만 관리자
            화면이고, 사원·대리·과장은 사원 화면입니다. 다른 부서에 요청하려면
            그 부서의 작업 요청으로 이동하세요.
          </span>
        </div>

        {flashMessage ? (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{flashMessage}</span>
          </div>
        ) : null}

        {stats.length > 0 ? (
          <div
            className={cn(
              'mb-5 grid gap-3',
              canManage ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-2 xl:grid-cols-4',
            )}
          >
            {stats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">{stat.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stat.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={brandFilter === 'all' ? 'secondary' : 'outline'}
            onClick={() => setBrandFilter('all')}
          >
            전체
          </Button>
          <Button
            type="button"
            size="sm"
            variant={brandFilter === 'undecided' ? 'secondary' : 'outline'}
            onClick={() => setBrandFilter('undecided')}
          >
            브랜드 미정
          </Button>
          {brands.map((brand) => (
            <Button
              key={brand.id}
              type="button"
              size="sm"
              variant={brandFilter === brand.id ? 'secondary' : 'outline'}
              onClick={() => setBrandFilter(brand.id)}
            >
              {brand.name}
            </Button>
          ))}
        </div>

        <div className="mb-5 flex flex-wrap gap-2 border-b border-border pb-3">
          {listSections.map((section) => (
            <Button
              key={section.id}
              type="button"
              size="sm"
              variant={allowedSection === section.id ? 'secondary' : 'ghost'}
              onClick={() => setListSection(section.id)}
            >
              {section.id === 'inbox' ? <Inbox className="size-3.5" /> : null}
              {section.id === 'team' ? <Users className="size-3.5" /> : null}
              {section.id === 'mine' ? (
                <BriefcaseBusiness className="size-3.5" />
              ) : null}
              {section.id === 'sent' ? <Send className="size-3.5" /> : null}
              {section.id === 'completed' ? (
                <CheckCircle2 className="size-3.5" />
              ) : null}
              {section.label}
              {section.count != null ? (
                <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {section.count}
                </span>
              ) : null}
            </Button>
          ))}
        </div>

        {allowedSection === 'inbox' ? (
            <div className="space-y-8">
              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">아직 확인 안 함</h3>
                      <Badge variant="outline">{unreviewedRequests.length}건</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      아직 열어보지 않은 새 요청입니다. 상세를 열면 검토 중으로
                      넘어갑니다.
                    </p>
                  </div>
                </div>
                {unreviewedRequests.length > 0 ? (
                  <div className="space-y-3">
                    {unreviewedRequests.map((request) =>
                      renderRequestRow(request, 'queue'),
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    아직 확인하지 않은 요청이 없습니다.
                  </p>
                )}
              </section>

              <section className="space-y-3 border-t border-border pt-6">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">검토 중</h3>
                      <Badge variant="warning">{reviewingRequests.length}건</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      대화를 시작한 요청입니다. 조율이 끝나면 수락하거나
                      반려하세요.
                    </p>
                  </div>
                </div>
                {reviewingRequests.length > 0 ? (
                  <div className="space-y-3">
                    {reviewingRequests.map((request) =>
                      renderRequestRow(request, 'queue'),
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    검토 중인 요청이 없습니다.
                  </p>
                )}
              </section>

              <section className="space-y-3 border-t border-border pt-6">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">완료 확인</h3>
                      <Badge variant="warning">
                        {completionReviewRequests.length}건
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      사원이 완료를 요청한 업무입니다. 수락하면 요청자가
                      결과를 확인합니다.
                    </p>
                  </div>
                </div>
                {completionReviewRequests.length > 0 ? (
                  <div className="space-y-3">
                    {completionReviewRequests.map((request) =>
                      renderRequestRow(request, 'queue'),
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    완료 확인을 기다리는 업무가 없습니다.
                  </p>
                )}
              </section>
            </div>
        ) : null}

        {allowedSection === 'team' ? (
          <WorkRequestTeamBoard
            unassigned={unassignedTeamRequests}
            assigned={activeTeamRequests}
            teamMembers={teamMembers}
            departmentLabel={departmentLabel}
            requesterLabel={requesterLabel}
            memberLabel={memberLabel}
            onOpen={openRequest}
            currentWorkByMember={currentWorkByMember}
            workDurationByMember={Object.fromEntries(
              Object.entries(currentWorkByMember).map(([memberId, requestId]) => [
                memberId,
                workDurationLabel(memberId, requestId),
              ]),
            )}
            onAssign={(requestId, patch) => {
              updateRequest(requestId, patch)
              setFlashMessage('작업 예정과 담당자를 반영했습니다.')
            }}
          />
        ) : null}

        {allowedSection === 'mine' ? (
          myActiveTasks.length > 0 || canManage ? (
            <div className="space-y-6">
              {myActiveTasks.length > 0 ? (
                (() => {
                  const mounted = myTodoTasks.find(
                    (request) =>
                      request.id === currentWorkByMember[LOCAL_SELF_ID],
                  )
                  return (
                    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Pin className="size-4 text-primary" />
                        <h3 className="font-semibold">지금 하는 업무</h3>
                      </div>
                      <p className="mb-4 text-xs text-muted-foreground">
                        여기에 장착한 업무가 오늘 하고 있는 일입니다. 다른 업무로
                        바꾸려면 아래 목록에서 갈아 끼우면 됩니다. 팀 현황에도
                        그대로 보입니다.
                      </p>
                      {mounted ? (
                        <div className="rounded-lg border border-primary/40 bg-card p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <Badge variant="default">장착 중</Badge>
                              <p className="mt-2 font-semibold">
                                {mounted.values.title}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                작업 예정{' '}
                                {mounted.plannedStart
                                  ? `${formatCompactDate(requestPlannedRange(mounted).start)} → ${formatCompactDate(requestPlannedRange(mounted).end)}`
                                  : '미정'}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              {mounted.assignee === LOCAL_SELF_ID &&
                              mounted.status === 'inProgress' ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => requestCompletion(mounted)}
                                >
                                  완료 요청
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={unmountCurrentWork}
                              >
                                빼기
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed border-primary/30 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                          아직 장착한 업무가 없습니다. 아래 목록에서 장착하세요.
                        </p>
                      )}
                    </section>
                  )
                })()
              ) : null}
              <div
                className={
                  canManage
                    ? 'grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]'
                    : undefined
                }
              >
                {canManage ? (
                  <WorkRequestScratchTodos
                    owner={owner}
                    profileId={profile?.id}
                  />
                ) : null}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">할 일</h3>
                    <Badge variant="muted">{myTodoTasks.length}건</Badge>
                  </div>
                  {myTodoTasks.length > 0 ? (
                    <div className="space-y-3">
                      {myTodoTasks.map((request) =>
                        renderRequestRow(request, 'mine'),
                      )}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      {canManage
                        ? '배정된 요청이 없으면 왼쪽 간단 할 일에 적어두면 됩니다.'
                        : '지금 할 일이 없습니다.'}
                    </p>
                  )}
                </section>
              </div>
              {myActiveTasks.length > 0 ? (
                <section className="space-y-3 border-t border-border pt-6">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">완료 요청 대기</h3>
                    <Badge variant="warning">
                      {myCompletionPendingTasks.length}건
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    완료를 요청한 뒤 팀장 또는 요청자 확인을 기다리는 업무입니다.
                  </p>
                  {myCompletionPendingTasks.length > 0 ? (
                    <div className="space-y-3">
                      {myCompletionPendingTasks.map((request) =>
                        renderRequestRow(request, 'mine'),
                      )}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      완료 확인을 기다리는 업무가 없습니다.
                    </p>
                  )}
                </section>
              ) : null}
            </div>
          ) : (
            renderEmptyState(
              '현재 배정된 업무가 없습니다.',
              '관리자가 주 담당자 또는 협업자로 배정한 업무만 여기에 표시됩니다.',
            )
          )
        ) : null}

        {allowedSection === 'sent' ? (
          sentRequests.length > 0 ? (
            <div className="space-y-3">
              {sentRequests.map((request) =>
                renderRequestRow(request, 'sent'),
              )}
            </div>
          ) : (
            renderEmptyState(
              '보낸 요청이 없습니다.',
              `${currentDepartment}에서 ${config.teamName}으로 보낸 요청이 여기에 표시됩니다.`,
            )
          )
        ) : null}

        {allowedSection === 'completed' ? (
          <WorkRequestCompletedPanel
            canManage={canManage}
            requests={completedRequests}
            teamMembers={teamMembers}
            from={completedFrom}
            to={completedTo}
            onFromChange={setCompletedFrom}
            onToChange={setCompletedTo}
            workDurationLabel={workDurationLabel}
            workDurationMs={workDurationMs}
            departmentLabel={departmentLabel}
            requesterLabel={requesterLabel}
            onOpen={openRequest}
          />
        ) : null}

        <p className="mt-4 text-xs text-muted-foreground">
          역할별 UI 확인용 임시 데이터입니다. 변경 내용은 새로고침하면
          초기화되며 서버에는 저장되지 않습니다.
        </p>
        {renderDetailPanel()}
        {acceptingRequest ? (
          <WorkRequestAcceptDialog
            request={acceptingRequest}
            teamMembers={teamMembers}
            onClose={() => setAcceptRequestId(null)}
            onConfirm={(decision) => acceptRequest(acceptingRequest, decision)}
          />
        ) : null}
        {reviewConfirmRequest ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="닫기"
              className="absolute inset-0 bg-black/40"
              onClick={() => setReviewConfirmId(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl"
            >
              <h2 className="text-base font-semibold">검토를 시작할까요?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                해당 요청건이 검토 중으로 넘어갑니다.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReviewConfirmId(null)}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  onClick={() => startReview(reviewConfirmRequest)}
                >
                  상세 열기
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  function renderDetailPanel() {
    if (!selectedRequest) return null
    const status = STATUS_META[selectedRequest.status]
    const dueDate =
      selectedRequest.confirmedDueDate || selectedRequest.values.dueDate
    const deadline = deadlineLabel(dueDate)
    const selectedConfig = WORK_REQUEST_CONFIG[selectedRequest.owner]
    const isSelfRequest =
      !isDestinationMember &&
      isCurrentUserRequest(
        selectedRequest.requesterDepartment,
        profile?.departmentName,
      )
    const canManageSelected =
      canManage && selectedRequest.owner === owner
    const isPrimaryAssignee = selectedRequest.assignee === LOCAL_SELF_ID
    const isCollaborator =
      selectedRequest.collaborators.includes(LOCAL_SELF_ID)
    const canEdit = isSelfRequest && selectedRequest.status === 'requested'
    const chatRooms = visibleChatRooms(selectedRequest, {
      canManage: canManageSelected,
      isRequester: isSelfRequest,
      selfId: LOCAL_SELF_ID,
      teamMembers,
      teamName: selectedConfig.teamName,
      requesterDepartmentLabel: departmentLabel(
        selectedRequest.requesterDepartment,
      ),
    })

    return (
      <div className="fixed inset-0 z-50">
        <button
          type="button"
          aria-label="상세 닫기"
          className="absolute inset-0 bg-black/20"
          onClick={closeRequest}
        />
        <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {selectedRequest.id} ·{' '}
              {departmentLabel(selectedRequest.requesterDepartment)}{' '}
              {requesterLabel(selectedRequest)} →{' '}
              {selectedConfig.teamName}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold">
              {selectedRequest.values.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isSelfRequest && canEdit ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openForm(selectedRequest)}
                >
                  <Pencil className="size-4" />
                  수정
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => deleteRequest(selectedRequest)}
                >
                  <Trash2 className="size-4" />
                  삭제
                </Button>
              </>
            ) : null}
            {canManageSelected &&
            (selectedRequest.status === 'requested' ||
              selectedRequest.status === 'reviewing') ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setAcceptRequestId(selectedRequest.id)}
                >
                  수락
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => rejectRequest(selectedRequest)}
                >
                  반려
                </Button>
              </>
            ) : null}
            {canManageSelected &&
            selectedRequest.status === 'completionReview' ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => acceptCompletion(selectedRequest)}
                >
                  완료 수락
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    rejectCompletion(selectedRequest, selectedRequest.assignee)
                  }
                >
                  반려
                </Button>
              </>
            ) : null}
            {isCurrentUserRequest(
              selectedRequest.requesterDepartment,
              profile?.departmentName,
            ) && selectedRequest.status === 'completionConfirm' ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => confirmCompletion(selectedRequest)}
                >
                  결과 확인
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    rejectCompletion(selectedRequest, REQUESTER_CHAT_ROOM)
                  }
                >
                  반려
                </Button>
              </>
            ) : null}
            {isSelfRequest &&
            !canEdit &&
            !isClosedStatus(selectedRequest.status) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => cancelRequest(selectedRequest)}
              >
                취소
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="상세 닫기"
              onClick={closeRequest}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        {flashMessage ? (
          <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{flashMessage}</span>
          </div>
        ) : null}

        <div className="space-y-6">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  <Badge
                    variant={
                      isBrandUndecided(selectedRequest) ? 'warning' : 'muted'
                    }
                  >
                    {brandLabelForRequest(selectedRequest, brands)}
                  </Badge>
                  {selectedRequest.managerPriority ? (
                    <Badge
                      variant={
                        PRIORITY_META[selectedRequest.managerPriority].variant
                      }
                    >
                      {PRIORITY_META[selectedRequest.managerPriority].label}{' '}
                      우선순위
                    </Badge>
                  ) : (
                    <Badge variant="muted">우선순위 검토 전</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">브랜드</p>
                    {isBrandUndecided(selectedRequest) ? (
                      <div className="mt-1 space-y-2">
                        <p className="text-sm font-medium">브랜드 미정</p>
                        <p className="text-xs text-muted-foreground">
                          브랜드가 정해지기 전에는 상품·기획안을 만들지 않습니다.
                        </p>
                        {canManageSelected ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Select
                              value={formBrandId}
                              onChange={(e) => setFormBrandId(e.target.value)}
                            >
                              <option value="">브랜드 선택</option>
                              {brands.map((brand) => (
                                <option key={brand.id} value={brand.id}>
                                  {brand.name}
                                </option>
                              ))}
                            </Select>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!formBrandId}
                              onClick={() => {
                                const selected = brands.find(
                                  (brand) => brand.id === formBrandId,
                                )
                                if (!selected) return
                                updateRequest(selectedRequest.id, {
                                  brandId: selected.id,
                                  brandDecidedAt: new Date().toISOString(),
                                  brandDecidedBy: LOCAL_SELF_ID,
                                })
                                setFlashMessage(
                                  `${selected.name} 브랜드로 확정했습니다.`,
                                )
                              }}
                            >
                              브랜드 확정
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-1 space-y-2">
                        <p className="text-sm font-medium">
                          {brandLabelForRequest(selectedRequest, brands)}
                        </p>
                        {brands.find((brand) => brand.id === selectedRequest.brandId) ? (
                          <Link
                            to={`/products?brands=${encodeURIComponent(brands.find((brand) => brand.id === selectedRequest.brandId)?.slug ?? '')}`}
                            className="text-xs text-primary hover:underline"
                          >
                            브랜드 상품 보기
                          </Link>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          연결된 데이터가 생긴 뒤에는 브랜드를 직접 바꾸지 않고
                          잘못된 데이터를 중지한 뒤 올바른 브랜드에 새로 만듭니다.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">부서 요청자</p>
                    <p className="mt-1 text-sm font-medium">
                      {departmentLabel(selectedRequest.requesterDepartment)} ·{' '}
                      {requesterLabel(selectedRequest)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">요청 희망일</p>
                    <p className="mt-1 text-sm font-medium">
                      {formatDate(selectedRequest.values.dueDate)}
                    </p>
                    {selectedRequest.values.deadlineType === 'fixed' ||
                    !selectedRequest.confirmedDueDate ? (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {selectedRequest.values.deadlineType === 'fixed' ? (
                          <Badge variant="danger">변경 불가</Badge>
                        ) : null}
                        {!selectedRequest.confirmedDueDate ? (
                          <Badge variant={deadline.variant}>
                            {deadline.label}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">확정 마감일</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">
                        {formatDate(selectedRequest.confirmedDueDate)}
                      </p>
                      {selectedRequest.confirmedDueDate ? (
                        <Badge variant={deadline.variant}>{deadline.label}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">담당자</p>
                    <p className="mt-1 text-sm font-medium">
                      {memberLabel(selectedRequest.assignee)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">작업 예정</p>
                    <p className="mt-1 text-sm font-medium">
                      {selectedRequest.plannedStart
                        ? `${formatDate(requestPlannedRange(selectedRequest).start)} → ${formatDate(requestPlannedRange(selectedRequest).end)}`
                        : '미배정'}
                    </p>
                  </div>
                  {canManageSelected ? (
                  <div>
                    <p className="text-xs text-muted-foreground">실질 작업</p>
                    <p className="mt-1 text-sm font-medium tabular-nums">
                      {[
                        selectedRequest.assignee,
                        ...selectedRequest.collaborators,
                      ]
                        .filter(Boolean)
                        .filter((id, index, list) => list.indexOf(id) === index)
                        .map((memberId) => {
                          const duration = workDurationLabel(
                            memberId,
                            selectedRequest.id,
                          )
                          const doing =
                            currentWorkByMember[memberId] === selectedRequest.id
                          return `${memberLabel(memberId)} ${duration}${doing ? ' · 지금 하는 중' : ''}`
                        })
                        .join(' / ') || '기록 없음'}
                    </p>
                  </div>
                  ) : null}
                </div>
                {selectedRequest.collaborators.length > 0 ? (
                  <div>
                    <p className="text-xs text-muted-foreground">협업자</p>
                    <p className="mt-1 text-sm font-medium">
                      {selectedRequest.collaborators
                        .map(memberLabel)
                        .join(', ')}
                    </p>
                  </div>
                ) : null}
                {selectedRequest.values.scheduleReason ? (
                  <div>
                    <p className="text-xs text-muted-foreground">일정 사유</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {selectedRequest.values.scheduleReason}
                    </p>
                  </div>
                ) : null}
                <div className="space-y-5">
                  {splitBodyParts(selectedRequest.values.blocks).map((part, index) => {
                    if (part.type === 'file') {
                      return (
                        <FileAttachmentCard
                          key={part.file.id}
                          file={part.file.file}
                        />
                      )
                    }
                    return (
                      <BodyFlow
                        key={part.text.id}
                        flowIndex={index}
                        text={part.text}
                        images={part.images}
                        readOnly
                        heights={{}}
                      />
                    )
                  })}
                </div>
                {selectedRequest.values.referenceFiles.length > 0 ? (
                  <div>
                    <p className="text-xs text-muted-foreground">참고 파일</p>
                    <div className="mt-2 space-y-2">
                      {selectedRequest.values.referenceFiles.map((file) => (
                        <FileAttachmentCard
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          file={file}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            {canManageSelected &&
              selectedRequest.status === 'accepted' &&
              !selectedRequest.assignee ? (
              <Card>
                <CardHeader>
                  <CardTitle>미배정</CardTitle>
                  <CardDescription>
                    팀 업무 일정표에서 사원 행으로 끌어다 놓으면 담당자와 작업
                    예정 기간이 정해집니다.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (isPrimaryAssignee || isCollaborator) &&
              selectedRequest.owner === owner ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BriefcaseBusiness className="size-4" />
                    내 업무 처리
                  </CardTitle>
                  <CardDescription>
                    {isPrimaryAssignee
                      ? '주 담당자로 배정된 업무입니다. 진행 상태를 직접 변경할 수 있습니다.'
                      : '협업자로 참여 중인 업무입니다. 주 담당자가 전체 상태를 관리합니다.'}
                  </CardDescription>
                </CardHeader>
                {isPrimaryAssignee ? (
                  <CardContent className="space-y-3">
                    {isCompletionPending(selectedRequest.status) ? (
                      <p className="text-sm text-muted-foreground">
                        {selectedRequest.status === 'completionReview'
                          ? '완료를 요청했습니다. 팀장 확인을 기다립니다.'
                          : '팀장 확인이 끝났습니다. 요청자 확인을 기다립니다.'}
                      </p>
                    ) : (
                      <>
                        <label className="block space-y-1.5">
                          <span className="text-sm font-medium">진행 상태</span>
                          <Select
                            className="w-full"
                            value={selectedRequest.status}
                            onChange={(event) =>
                              updateRequest(selectedRequest.id, {
                                status: event.target.value as RequestStatus,
                              })
                            }
                          >
                            <option value="accepted">시작 전</option>
                            <option value="inProgress">진행 중</option>
                            <option value="waiting">보류</option>
                          </Select>
                        </label>
                        {selectedRequest.status === 'inProgress' ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => requestCompletion(selectedRequest)}
                          >
                            완료 요청
                          </Button>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          완료 요청 후 팀장이 수락하고, 요청자가 결과를
                          확인하면 완료됩니다. 팀장이 직접 맡은 일은 바로
                          요청자 확인으로 갑니다.
                        </p>
                      </>
                    )}
                  </CardContent>
                ) : null}
              </Card>
            ) : !canManageSelected ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock3 className="size-4" />
                    부서 검토
                  </CardTitle>
                  <CardDescription>
                    {selectedConfig.teamName} 관리자가 대화로 검토한 뒤
                    수락하고 일정표에서 배정합니다.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}

            <WorkRequestChat
              className="h-[32rem]"
              requestId={selectedRequest.id}
              rooms={chatRooms}
              messages={selectedRequest.messages}
              selfId={LOCAL_SELF_ID}
              canWrite={canWriteChat(selectedRequest)}
              onSend={(body, roomId) =>
                addMessage(selectedRequest.id, body, roomId)
              }
            />

          </div>
        </div>
        </div>
      </aside>
      </div>
    )
  }

  return (
    <div ref={pageTopRef}>
      <form onSubmit={handleSubmit} noValidate>
        <PageHeader
          title={
            editingRequest
              ? `${config.teamName} 작업 요청 수정`
              : `${config.teamName} 작업 요청 등록`
          }
          description={config.description}
          actions={
            <Button type="button" variant="outline" onClick={cancelEditing}>
              <ArrowLeft className="size-4" />
              돌아가기
            </Button>
          }
        />

        {Object.keys(errors).length > 0 ? (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>필수 입력 항목을 확인해 주세요.</span>
          </div>
        ) : null}

        <Card>
          <CardContent className="space-y-5 p-5">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">브랜드 (선택)</span>
              <Select
                value={formBrandId}
                onChange={(e) => setFormBrandId(e.target.value)}
                disabled={Boolean(editingRequest?.brandId)}
              >
                <option value="">브랜드 미정</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </Select>
              <span className="block text-xs text-muted-foreground">
                상품·기획안은 브랜드를 확정한 뒤에만 만듭니다. 이미 연결된
                데이터가 있으면 브랜드를 직접 바꾸지 않습니다.
              </span>
            </label>

            <label className="block space-y-1.5">
              <span className="flex items-center gap-1 text-sm font-medium">
                요청 제목 <span className="text-danger">*</span>
              </span>
              <Input
                id="work-request-title"
                value={values.title}
                placeholder={config.titlePlaceholder}
                aria-invalid={Boolean(errors.title)}
                onChange={(event) => updateValue('title', event.target.value)}
                className={cn(
                  errors.title && 'border-danger focus-visible:ring-danger',
                )}
              />
              <span className="block text-xs text-muted-foreground">
                제목 예시: {config.titleExample}
              </span>
              {errors.title ? (
                <span className="block text-xs text-danger">{errors.title}</span>
              ) : null}
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                일정 <span className="text-danger">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    {
                      value: 'preferred' as const,
                      label: '희망 일정',
                      description: '부서 상황에 따라 협의할 수 있는 날짜',
                    },
                    {
                      value: 'fixed' as const,
                      label: '변경 불가 일정',
                      description: '출시·행사·출고처럼 반드시 지켜야 하는 날짜',
                    },
                  ] as const
                ).map((option) => {
                  const checked = values.deadlineType === option.value
                  return (
                    <div
                      key={option.value}
                      className={cn(
                        'rounded-lg border px-3 py-3 transition-colors',
                        checked
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/40',
                        errors.deadlineType && 'border-danger',
                      )}
                    >
                      <label className="block cursor-pointer">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <input
                            type="radio"
                            name={`${owner}-deadline-type`}
                            value={option.value}
                            checked={checked}
                            className="size-4 accent-primary"
                            onChange={() =>
                              updateValue('deadlineType', option.value)
                            }
                          />
                          {option.label}
                        </span>
                        <span className="mt-1 block pl-6 text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </label>
                      {checked ? (
                        <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
                          <label className="block space-y-1.5">
                            <span className="flex items-center gap-1 text-sm font-medium">
                              희망 마감일 <span className="text-danger">*</span>
                            </span>
                            <Input
                              type="date"
                              value={values.dueDate}
                              aria-invalid={Boolean(errors.dueDate)}
                              onChange={(event) =>
                                updateValue('dueDate', event.target.value)
                              }
                              className={cn(
                                errors.dueDate &&
                                  'border-danger focus-visible:ring-danger',
                              )}
                            />
                            {errors.dueDate ? (
                              <span className="block text-xs text-danger">
                                {errors.dueDate}
                              </span>
                            ) : null}
                          </label>
                          {option.value === 'fixed' ? (
                            <label className="block space-y-1.5">
                              <span className="flex items-center gap-1 text-sm font-medium">
                                변경할 수 없는 일정의 사유
                                <span className="text-danger">*</span>
                              </span>
                              <Textarea
                                rows={3}
                                value={values.scheduleReason}
                                placeholder="예: 9월 15일 29CM 기획전 오픈이 확정되어 9월 12일까지 결과물이 필요합니다."
                                aria-invalid={Boolean(errors.scheduleReason)}
                                onChange={(event) =>
                                  updateValue(
                                    'scheduleReason',
                                    event.target.value,
                                  )
                                }
                                className={cn(
                                  errors.scheduleReason &&
                                    'border-danger focus-visible:ring-danger',
                                )}
                              />
                              {errors.scheduleReason ? (
                                <span className="block text-xs text-danger">
                                  {errors.scheduleReason}
                                </span>
                              ) : null}
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </fieldset>

            <RequestBodyEditor
              blocks={values.blocks}
              error={errors.blocks}
              placeholder={config.bodyPlaceholder}
              onChange={(blocks) => updateValue('blocks', blocks)}
            />

            <ReferenceFilesField
              files={values.referenceFiles}
              onChange={(files) => updateValue('referenceFiles', files)}
            />
          </CardContent>
        </Card>

        <div className="mt-4 flex flex-col-reverse gap-3 border-t border-border py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            UI 시안 단계입니다. 요청은 새로고침하면 초기화됩니다.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancelEditing}>
              취소
            </Button>
            <Button type="submit">
              {editingRequest ? '수정 내용 저장' : '작업 요청 등록'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

export function WorkRequestPage() {
  const { owner = '' } = useParams()

  if (!isWorkRequestOwner(owner)) {
    return <Navigate to="/work" replace />
  }

  return <WorkRequestForm key={owner} owner={owner} />
}
