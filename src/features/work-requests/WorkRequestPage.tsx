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
import { Navigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardPlus,
  Clock3,
  Eye,
  Inbox,
  Pencil,
  Plus,
  Send,
  Trash2,
  UserRoundCheck,
  Users,
} from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
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
import { useAuth } from '@/lib/supabase/auth'
import { cn } from '@/lib/utils'
import {
  departmentDisplayName,
  isSameDepartment,
  isWorkRequestOwner,
  resolveWorkRequestViewRole,
  WORK_REQUEST_CONFIG,
  WORK_REQUEST_OWNERS,
  type WorkRequestOwner,
} from './work-request-form-config'

type TextContentBlock = {
  id: string
  type: 'text'
  text: string
}

type ImageWrap = 'none' | 'left' | 'right'

type ImageContentBlock = {
  id: string
  type: 'image'
  file: File
  caption: string
  widthPercent: number
  heightPx?: number
  offsetY: number
  wrap: ImageWrap
}

type FileContentBlock = {
  id: string
  type: 'file'
  file: File
}

type ContentBlock = TextContentBlock | ImageContentBlock | FileContentBlock

type FormValues = {
  title: string
  requester: string
  deadlineType: 'preferred' | 'fixed' | ''
  dueDate: string
  scheduleReason: string
  referenceUrl: string
  blocks: ContentBlock[]
}

type FormErrors = Partial<Record<keyof FormValues, string>>

type RequestStatus =
  | 'requested'
  | 'reviewing'
  | 'accepted'
  | 'inProgress'
  | 'waiting'
  | 'completed'
  | 'cancelled'

type ManagerPriority = 'urgent' | 'high' | 'normal' | 'low'

type WorkRequestRecord = {
  id: string
  owner: WorkRequestOwner
  values: FormValues
  requesterDepartment: string
  status: RequestStatus
  managerPriority: ManagerPriority | ''
  assignee: string
  collaborators: string[]
  confirmedDueDate: string
  managerNote: string
  createdAt: string
  updatedAt: string
}

type RequestScreen =
  | { kind: 'list' }
  | { kind: 'form'; requestId?: string }
  | { kind: 'detail'; requestId: string }

type WorkListSection = 'inbox' | 'team' | 'mine' | 'sent' | 'completed'

type LocalTeamMember = {
  id: string
  name: string
  position: string
  isSelf?: boolean
}

const LOCAL_SELF_ID = 'local-self'
const LOCAL_CURRENT_DEPARTMENT = 'local-current-department'

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
    deadlineType: 'preferred',
    dueDate: '',
    scheduleReason: '',
    referenceUrl: '',
    blocks: [emptyTextBlock()],
  }
}

function dateFromToday(days: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function dateTimeFromToday(days: number, hour: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hour, 20, 0, 0)
  return date.toISOString()
}

function demoValues({
  title,
  requester,
  dueIn,
  body,
  fixed = false,
}: {
  title: string
  requester: string
  dueIn: number
  body: string
  fixed?: boolean
}): FormValues {
  return {
    title,
    requester,
    deadlineType: fixed ? 'fixed' : 'preferred',
    dueDate: dateFromToday(dueIn),
    scheduleReason: fixed
      ? '외부 채널 오픈 일정이 확정되어 마감일 변경이 어렵습니다.'
      : '',
    referenceUrl: '',
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

  return [
    {
      id: `WR-${prefix}-001`,
      owner,
      requesterDepartment: sourceA,
      values: demoValues({
        title: `[긴급 확인] ${destination} 결과물 일정 검토 요청`,
        requester: '한유진',
        dueIn: 2,
        body: `${sourceA}에서 ${destination}으로 보낸 요청입니다. 채널 오픈 전에 필요한 결과물이니 처리 일정과 추가 자료를 알려 주세요.`,
        fixed: true,
      }),
      status: 'requested',
      managerPriority: '',
      assignee: '',
      collaborators: [],
      confirmedDueDate: '',
      managerNote: '',
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
        dueIn: 5,
        body: `${sourceB}에서 ${destination}으로 보낸 요청입니다. 26FW 프로모션 오픈에 맞춰 세부 범위를 조율해 주세요.`,
      }),
      status: 'reviewing',
      managerPriority: 'high',
      assignee: '',
      collaborators: [],
      confirmedDueDate: '',
      managerNote: '요청 범위와 일정 조율 중',
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
        dueIn: 8,
        body: `${sourceC}에서 ${destination}으로 보낸 요청입니다. 접수 후 주 담당자와 협업자를 배정해 주세요.`,
      }),
      status: 'accepted',
      managerPriority: 'normal',
      assignee: '',
      collaborators: [],
      confirmedDueDate: dateFromToday(7),
      managerNote: '접수 완료, 담당자 배정 필요',
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
        dueIn: 3,
        body: `${sourceA}에서 요청한 운영 수정입니다. 주 담당자와 협업자가 함께 진행 중입니다.`,
      }),
      status: 'inProgress',
      managerPriority: 'high',
      assignee: LOCAL_SELF_ID,
      collaborators: ['member-min'],
      confirmedDueDate: dateFromToday(3),
      managerNote: '오늘 1차 결과 확인 예정',
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
        dueIn: 1,
        body: `${sourceB}에서 요청한 시즌 캠페인 준비입니다. 다른 사원에게 배정된 업무입니다.`,
      }),
      status: 'inProgress',
      managerPriority: 'urgent',
      assignee: 'member-min',
      collaborators: [],
      confirmedDueDate: dateFromToday(1),
      managerNote: '마감 임박',
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
        dueIn: 9,
        body: `${sourceC}에서 요청한 업무입니다. 협력사 원본 자료가 도착하면 재개합니다.`,
      }),
      status: 'waiting',
      managerPriority: 'low',
      assignee: 'member-jun',
      collaborators: [LOCAL_SELF_ID],
      confirmedDueDate: dateFromToday(9),
      managerNote: '협력사 회신 대기',
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
        dueIn: -1,
        body: `${sourceA}에서 보낸 지난주 요청으로, 다른 사원이 완료했습니다.`,
      }),
      status: 'completed',
      managerPriority: 'normal',
      assignee: 'member-seo',
      collaborators: [],
      confirmedDueDate: dateFromToday(-1),
      managerNote: '요청 부서 확인 완료',
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
        dueIn: 6,
        body: `현재 소속 부서에서 ${destination}으로 보낸 요청입니다. 요청자 화면에서만 목록에 함께 보입니다.`,
      }),
      status: 'reviewing',
      managerPriority: '',
      assignee: '',
      collaborators: [],
      confirmedDueDate: '',
      managerNote: '',
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
        dueIn: 10,
        body: `현재 소속 부서에서 ${destination}으로 보낸 요청입니다. 접수됐지만 아직 담당자는 없습니다.`,
      }),
      status: 'accepted',
      managerPriority: 'normal',
      assignee: '',
      collaborators: [],
      confirmedDueDate: dateFromToday(9),
      managerNote: '접수 완료, 담당자 배정 예정',
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
        dueIn: -2,
        body: `${sourceB}에서 요청한 업무로, 현재 접속자에게 배정되어 완료된 임시 데이터입니다.`,
      }),
      status: 'completed',
      managerPriority: 'normal',
      assignee: LOCAL_SELF_ID,
      collaborators: [],
      confirmedDueDate: dateFromToday(-2),
      managerNote: '요청 부서 확인 완료',
      createdAt: dateTimeFromToday(-12, 11),
      updatedAt: dateTimeFromToday(-2, 16),
    },
  ]
}

function localTeamMembers(
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

function hasRequestBody(blocks: ContentBlock[]): boolean {
  return blocks.some((block) =>
    block.type === 'text' ? block.text.trim().length > 0 : true,
  )
}

const STATUS_META: Record<
  RequestStatus,
  {
    label: string
    variant: 'default' | 'success' | 'warning' | 'danger' | 'outline' | 'muted'
  }
> = {
  requested: { label: '요청됨', variant: 'outline' },
  reviewing: { label: '검토 중', variant: 'warning' },
  accepted: { label: '접수됨', variant: 'default' },
  inProgress: { label: '진행 중', variant: 'default' },
  waiting: { label: '보류', variant: 'warning' },
  completed: { label: '완료', variant: 'success' },
  cancelled: { label: '취소', variant: 'muted' },
}

const PRIORITY_META: Record<
  ManagerPriority,
  { label: string; variant: 'default' | 'warning' | 'danger' | 'muted' }
> = {
  urgent: { label: '긴급', variant: 'danger' },
  high: { label: '높음', variant: 'warning' },
  normal: { label: '보통', variant: 'default' },
  low: { label: '낮음', variant: 'muted' },
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

function formatDate(value: string): string {
  if (!value) return '미정'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function deadlineLabel(value: string): {
  label: string
  variant: 'outline' | 'warning' | 'danger' | 'muted'
} {
  if (!value) return { label: '마감 미정', variant: 'muted' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${value}T00:00:00`)
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { label: `${Math.abs(days)}일 초과`, variant: 'danger' }
  if (days === 0) return { label: '오늘 마감', variant: 'danger' }
  if (days <= 3) return { label: `${days}일 남음`, variant: 'warning' }
  return { label: `${days}일 남음`, variant: 'outline' }
}

function requestDueDate(request: WorkRequestRecord): string {
  return request.confirmedDueDate || request.values.dueDate
}

function formatCompactDate(value: string): string {
  if (!value) return '미정'
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function scheduleDurationLabel(createdAt: string, dueDate: string): string {
  if (!dueDate) return '일정 미정'
  const requested = new Date(createdAt)
  requested.setHours(0, 0, 0, 0)
  const due = new Date(`${dueDate}T00:00:00`)
  const days = Math.max(
    0,
    Math.round((due.getTime() - requested.getTime()) / 86_400_000),
  )
  return days === 0 ? '당일 일정' : `${days}일 일정`
}

function compareRequestsByDeadline(
  left: WorkRequestRecord,
  right: WorkRequestRecord,
): number {
  const leftDueDate = requestDueDate(left)
  const rightDueDate = requestDueDate(right)
  if (!leftDueDate && rightDueDate) return 1
  if (leftDueDate && !rightDueDate) return -1
  const dueDateOrder = leftDueDate.localeCompare(rightDueDate)
  return dueDateOrder || left.createdAt.localeCompare(right.createdAt)
}

function toCalendarDate(value: string | Date): Date {
  const date =
    typeof value === 'string'
      ? new Date(value.includes('T') ? value : `${value}T00:00:00`)
      : new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function addCalendarDays(value: Date, days: number): Date {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

function calendarDayNumber(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
}

function calendarDayDifference(left: Date, right: Date): number {
  return Math.round(
    (calendarDayNumber(left) - calendarDayNumber(right)) / 86_400_000,
  )
}

function isSameCalendarDate(left: Date, right: Date): boolean {
  return calendarDayNumber(left) === calendarDayNumber(right)
}

function buildTeamTimelineDates(requests: WorkRequestRecord[]): Date[] {
  const today = toCalendarDate(new Date())
  let firstDate = today
  let lastDate = addCalendarDays(today, 27)

  if (requests.length > 0) {
    const requestedDates = requests.map((request) =>
      toCalendarDate(request.createdAt),
    )
    const dueDates = requests.map((request) => {
      const dueDate = requestDueDate(request)
      return dueDate
        ? toCalendarDate(dueDate)
        : toCalendarDate(request.createdAt)
    })
    firstDate = addCalendarDays(
      new Date(Math.min(...requestedDates.map((date) => date.getTime()))),
      -1,
    )
    const latestDueDate = addCalendarDays(
      new Date(Math.max(...dueDates.map((date) => date.getTime()))),
      1,
    )
    lastDate = new Date(
      Math.max(
        latestDueDate.getTime(),
        addCalendarDays(firstDate, 27).getTime(),
      ),
    )
  }

  const dateCount = calendarDayDifference(lastDate, firstDate) + 1
  return Array.from({ length: dateCount }, (_, index) =>
    addCalendarDays(firstDate, index),
  )
}

type TimelineRequestPlacement = {
  request: WorkRequestRecord
  lane: number
  startIndex: number
  endIndex: number
}

function layoutTimelineRequests(
  requests: WorkRequestRecord[],
  timelineStart: Date,
  timelineDayCount: number,
): {
  placements: TimelineRequestPlacement[]
  laneCount: number
} {
  const ordered = [...requests].sort((left, right) => {
    const leftStart = toCalendarDate(left.createdAt)
    const rightStart = toCalendarDate(right.createdAt)
    return (
      calendarDayDifference(leftStart, rightStart) ||
      compareRequestsByDeadline(left, right)
    )
  })
  const laneEnds: number[] = []
  const placements = ordered.map((request) => {
    const requestedDate = toCalendarDate(request.createdAt)
    const dueDateValue = requestDueDate(request)
    const dueDate = dueDateValue
      ? toCalendarDate(dueDateValue)
      : requestedDate
    const startIndex = Math.max(
      0,
      Math.min(
        timelineDayCount - 1,
        calendarDayDifference(requestedDate, timelineStart),
      ),
    )
    const endIndex = Math.max(
      startIndex,
      Math.min(
        timelineDayCount - 1,
        calendarDayDifference(dueDate, timelineStart),
      ),
    )
    let lane = laneEnds.findIndex((laneEnd) => laneEnd < startIndex)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = endIndex
    return { request, lane, startIndex, endIndex }
  })

  return { placements, laneCount: Math.max(1, laneEnds.length) }
}

function timelineBarTone(request: WorkRequestRecord): string {
  const deadline = deadlineLabel(requestDueDate(request))
  if (request.status === 'waiting') {
    return 'border-border bg-muted text-foreground hover:bg-muted/80'
  }
  if (
    request.managerPriority === 'urgent' ||
    deadline.variant === 'danger'
  ) {
    return 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/15'
  }
  if (
    request.managerPriority === 'high' ||
    deadline.variant === 'warning'
  ) {
    return 'border-warning/40 bg-warning/10 text-foreground hover:bg-warning/15'
  }
  return 'border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15'
}

function RequestDateComparison({
  request,
}: {
  request: WorkRequestRecord
}) {
  const dueDate = requestDueDate(request)
  const deadline = deadlineLabel(dueDate)

  return (
    <div className="mt-3 rounded-md border border-border/70 bg-muted/30 px-2.5 py-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div>
          <p className="text-[10px] font-medium text-muted-foreground">
            요청일
          </p>
          <p className="mt-0.5 text-xs font-semibold">
            {formatCompactDate(request.createdAt)}
          </p>
        </div>
        <ArrowRight
          aria-hidden="true"
          className="mb-0.5 size-3.5 text-muted-foreground"
        />
        <div className="text-right">
          <p className="text-[10px] font-medium text-muted-foreground">
            마감일
          </p>
          <p className="mt-0.5 text-xs font-semibold">
            {formatCompactDate(dueDate)}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
        <span className="text-[10px] text-muted-foreground">
          {scheduleDurationLabel(request.createdAt, dueDate)}
        </span>
        <Badge
          variant={deadline.variant}
          className="shrink-0 px-1.5 py-0 text-[10px]"
        >
          {deadline.label}
        </Badge>
      </div>
    </div>
  )
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
  const config = WORK_REQUEST_CONFIG[owner]
  const { profile } = useAuth()
  const pageTopRef = useRef<HTMLDivElement>(null)
  const [screen, setScreen] = useState<RequestScreen>({ kind: 'list' })
  const [requests, setRequests] = useState<WorkRequestRecord[]>(() =>
    createDemoRequests(owner),
  )
  const [listSection, setListSection] = useState<WorkListSection>('sent')
  const [values, setValues] = useState<FormValues>(createEmptyValues)
  const [errors, setErrors] = useState<FormErrors>({})
  const [hasEdited, setHasEdited] = useState(false)
  const [flashMessage, setFlashMessage] = useState<string | null>(null)

  const currentDepartment = profile?.departmentName
    ? departmentDisplayName(profile.departmentName)
    : '현재 부서'
  const viewRole = resolveWorkRequestViewRole(
    owner,
    profile?.departmentName,
    profile?.position,
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
  }, [canManage, isDestinationMember, owner])

  useEffect(() => {
    if (screen.kind === 'form' && isDestinationMember && !screen.requestId) {
      setScreen({ kind: 'list' })
    }
  }, [isDestinationMember, screen])

  const editingRequest =
    screen.kind === 'form' && screen.requestId
      ? requests.find((request) => request.id === screen.requestId)
      : undefined
  const selectedRequest =
    screen.kind === 'detail'
      ? requests.find((request) => request.id === screen.requestId)
      : undefined

  function departmentLabel(value: string) {
    if (value === LOCAL_CURRENT_DEPARTMENT) return currentDepartment
    return departmentDisplayName(value)
  }

  function memberLabel(value: string) {
    if (!value) return '미정'
    return teamMembers.find((member) => member.id === value)?.name ?? value
  }

  function openForm(request?: WorkRequestRecord) {
    setValues(
      request
        ? { ...request.values }
        : {
            ...createEmptyValues(),
            requester: profile?.displayName ?? '',
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
    setScreen(
      editingRequest
        ? { kind: 'detail', requestId: editingRequest.id }
        : { kind: 'list' },
    )
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
            ? { ...request, values: { ...values }, updatedAt: now }
            : request,
        ),
      )
      setFlashMessage('요청 내용을 수정했습니다.')
      setScreen({ kind: 'detail', requestId: editingRequest.id })
    } else {
      const id = makeRequestId()
      setRequests((current) => [
        {
          id,
          owner,
          values: { ...values },
          requesterDepartment:
            profile?.departmentName?.trim() || LOCAL_CURRENT_DEPARTMENT,
          status: 'requested',
          managerPriority: '',
          assignee: '',
          collaborators: [],
          confirmedDueDate: '',
          managerNote: '',
          createdAt: now,
          updatedAt: now,
        },
        ...current,
      ])
      setFlashMessage('작업 요청을 등록했습니다.')
      setScreen({ kind: 'detail', requestId: id })
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
    setScreen({ kind: 'list' })
  }

  function cancelRequest(request: WorkRequestRecord) {
    if (
      request.status === 'completed' ||
      request.status === 'cancelled' ||
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

  function updateManagerField(
    requestId: string,
    patch: Partial<
      Pick<
        WorkRequestRecord,
        | 'status'
        | 'managerPriority'
        | 'assignee'
        | 'collaborators'
        | 'confirmedDueDate'
        | 'managerNote'
      >
    >,
  ) {
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? {
              ...request,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : request,
      ),
    )
  }

  function saveManagerDecision(requestId: string) {
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? { ...request, updatedAt: new Date().toISOString() }
          : request,
      ),
    )
    setFlashMessage('부서 처리 정보를 저장했습니다.')
    pageTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const destinationRequests = requests.filter(
    (request) => request.owner === owner,
  )
  const incomingRequests = destinationRequests.filter(
    (request) =>
      !isDestinationMember ||
      request.requesterDepartment !== LOCAL_CURRENT_DEPARTMENT,
  )
  const sentRequests = destinationRequests.filter((request) =>
    isCurrentUserRequest(request.requesterDepartment, profile?.departmentName),
  )
  const managerQueue = incomingRequests.filter(
    (request) =>
      request.status === 'requested' ||
      request.status === 'reviewing' ||
      (request.status === 'accepted' && !request.assignee),
  )
  const unassignedTeamRequests = incomingRequests
    .filter(
      (request) => request.status === 'accepted' && !request.assignee,
    )
    .sort(compareRequestsByDeadline)
  const activeTeamRequests = incomingRequests.filter(
    (request) =>
      request.status !== 'completed' &&
      request.status !== 'cancelled' &&
      Boolean(request.assignee),
  )
  const teamTimelineDates = buildTeamTimelineDates(activeTeamRequests)
  const teamTimelineStart = teamTimelineDates[0]
  const myTasks = incomingRequests.filter(
    (request) =>
      request.assignee === LOCAL_SELF_ID ||
      request.collaborators.includes(LOCAL_SELF_ID),
  )
  const myActiveTasks = myTasks.filter(
    (request) =>
      request.status !== 'completed' && request.status !== 'cancelled',
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

  const listSections: {
    id: WorkListSection
    label: string
    count?: number
  }[] = canManage
    ? [
        { id: 'inbox', label: '접수 대기', count: managerQueue.length },
        { id: 'team', label: '팀 업무', count: activeTeamRequests.length },
        { id: 'completed', label: '완료', count: completedRequests.length },
      ]
    : isDestinationMember
      ? [
          { id: 'mine', label: '내 업무', count: myActiveTasks.length },
          { id: 'completed', label: '완료', count: completedRequests.length },
        ]
      : [{ id: 'sent', label: '보낸 요청', count: sentRequests.length }]

  const allowedSection: WorkListSection = canManage
    ? listSection === 'team' || listSection === 'completed'
      ? listSection
      : 'inbox'
    : isDestinationMember
      ? listSection === 'completed'
        ? 'completed'
        : 'mine'
      : 'sent'

  function openRequest(request: WorkRequestRecord) {
    setFlashMessage(null)
    setScreen({ kind: 'detail', requestId: request.id })
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
    const isSelfRequest =
      !isDestinationMember &&
      isCurrentUserRequest(request.requesterDepartment, profile?.departmentName)

    return (
      <Card key={request.id}>
        <CardContent className="p-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem_15rem] xl:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
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
                    {request.values.requester || '미입력'}
                  </>
                )}{' '}
                · {formatDateTime(request.createdAt)}
              </p>
            </div>

            <div className="grid min-w-0 shrink-0 grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">확정 마감</p>
                <p className="mt-1 truncate font-medium">
                  {formatDate(dueDate)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">주 담당자</p>
                <p className="mt-1 truncate font-medium">
                  {memberLabel(request.assignee)}
                </p>
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="text-xs text-muted-foreground">협업자</p>
                <p className="mt-1 truncate font-medium">
                  {request.collaborators.length > 0
                    ? request.collaborators.map(memberLabel).join(', ')
                    : '없음'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 xl:min-h-9 xl:flex-nowrap xl:justify-end">
              {context === 'queue' && canManage ? (
                <>
                  {request.status === 'requested' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateManagerField(request.id, { status: 'reviewing' })
                      }
                    >
                      검토 시작
                    </Button>
                  ) : null}
                  {request.status === 'requested' ||
                  request.status === 'reviewing' ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        updateManagerField(request.id, {
                          status: 'accepted',
                          confirmedDueDate:
                            request.confirmedDueDate || request.values.dueDate,
                        })
                      }
                    >
                      접수
                    </Button>
                  ) : null}
                </>
              ) : null}

              {context === 'mine' && isPrimaryAssignee ? (
                <>
                  {request.status === 'accepted' ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        updateManagerField(request.id, {
                          status: 'inProgress',
                        })
                      }
                    >
                      업무 시작
                    </Button>
                  ) : null}
                  {request.status === 'waiting' ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        updateManagerField(request.id, {
                          status: 'inProgress',
                        })
                      }
                    >
                      다시 진행
                    </Button>
                  ) : null}
                  {request.status === 'inProgress' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        updateManagerField(request.id, {
                          status: 'completed',
                        })
                      }
                    >
                      완료 처리
                    </Button>
                  ) : null}
                </>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openRequest(request)}
              >
                <Eye className="size-3.5" />
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

  function renderTeamRequestCard(
    request: WorkRequestRecord,
    unassigned = false,
  ) {
    const requestStatus = STATUS_META[request.status]

    return (
      <button
        key={request.id}
        type="button"
        className={cn(
          'w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted',
          unassigned
            ? 'border-warning/40 hover:border-warning'
            : 'border-border',
        )}
        onClick={() => openRequest(request)}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={requestStatus.variant}>{requestStatus.label}</Badge>
          {request.managerPriority ? (
            <Badge variant={PRIORITY_META[request.managerPriority].variant}>
              {PRIORITY_META[request.managerPriority].label}
            </Badge>
          ) : null}
          {unassigned ? <Badge variant="warning">배정 필요</Badge> : null}
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-medium">
          {request.values.title}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {departmentLabel(request.requesterDepartment)} · 요청자{' '}
          {request.values.requester || '미입력'}
        </p>
        <RequestDateComparison request={request} />
        {request.collaborators.length > 0 ? (
          <p className="mt-2 truncate text-xs text-muted-foreground">
            협업 {request.collaborators.map(memberLabel).join(', ')}
          </p>
        ) : null}
      </button>
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
              canManage ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3',
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
          managerQueue.length > 0 ? (
            <div className="space-y-3">
              {managerQueue.map((request) =>
                renderRequestRow(request, 'queue'),
              )}
            </div>
          ) : (
            renderEmptyState(
              '접수 대기 요청이 없습니다.',
              '새 요청이 들어오면 검토와 접수 여부를 여기에서 결정합니다.',
            )
          )
        ) : null}

        {allowedSection === 'team' ? (
          <div className="space-y-5">
            {unassignedTeamRequests.length > 0 ? (
              <section className="rounded-xl border border-warning/30 bg-warning/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">미배정 업무</p>
                      <Badge variant="warning">
                        {unassignedTeamRequests.length}건
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      접수됐지만 주 담당자가 정해지지 않은 업무입니다. 우선
                      배정이 필요합니다.
                    </p>
                  </div>
                  <span className="rounded-md bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                    사원별 현황과 별도 관리
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {unassignedTeamRequests.map((request) =>
                    renderTeamRequestCard(request, true),
                  )}
                </div>
              </section>
            ) : null}

            <section>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" />
                    <h3 className="font-semibold">사원별 업무 현황</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    업무 막대의 시작은 요청일, 끝은 마감일입니다.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  표를 좌우·상하로 스크롤할 수 있습니다.
                </p>
              </div>

              <div className="max-h-[44rem] overflow-auto rounded-xl border border-border bg-card">
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `11rem repeat(${teamTimelineDates.length}, 4rem)`,
                  }}
                >
                  <div
                    className="sticky left-0 top-0 z-40 flex h-14 items-center border-b border-r border-border bg-muted px-4 text-xs font-semibold"
                    style={{ gridColumn: '1', gridRow: '1' }}
                  >
                    담당자
                  </div>
                  {teamTimelineDates.map((date, dateIndex) => {
                    const today = isSameCalendarDate(date, new Date())
                    const weekend = date.getDay() === 0 || date.getDay() === 6
                    return (
                      <div
                        key={date.toISOString()}
                        className={cn(
                          'sticky top-0 z-30 flex h-14 flex-col items-center justify-center border-b border-r border-border bg-card text-[10px]',
                          weekend && 'bg-muted/50',
                          today && 'bg-primary/15 text-primary',
                        )}
                        style={{
                          gridColumn: `${dateIndex + 2}`,
                          gridRow: '1',
                        }}
                      >
                        <span className="font-semibold">
                          {date.getMonth() + 1}.{date.getDate()}
                        </span>
                        <span className="mt-0.5 text-muted-foreground">
                          {new Intl.DateTimeFormat('ko-KR', {
                            weekday: 'short',
                          }).format(date)}
                        </span>
                      </div>
                    )
                  })}

                  {teamMembers.map((member, memberIndex) => {
                    const memberRequests = activeTeamRequests
                      .filter((request) => request.assignee === member.id)
                      .sort(compareRequestsByDeadline)
                    const { placements, laneCount } = layoutTimelineRequests(
                      memberRequests,
                      teamTimelineStart,
                      teamTimelineDates.length,
                    )
                    const rowHeight = Math.max(72, laneCount * 58 + 12)
                    const gridRow = `${memberIndex + 2}`

                    return (
                      <Fragment key={member.id}>
                        <div
                          className="sticky left-0 z-20 flex items-center justify-between gap-2 border-b border-r border-border bg-card px-4"
                          style={{
                            gridColumn: '1',
                            gridRow,
                            height: rowHeight,
                          }}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {member.name}
                              {member.isSelf ? ' (나)' : ''}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {member.position}
                            </p>
                          </div>
                          <Badge variant="muted">{memberRequests.length}</Badge>
                        </div>

                        <div
                          className="relative border-b border-border"
                          style={{
                            gridColumn: `2 / span ${teamTimelineDates.length}`,
                            gridRow,
                            height: rowHeight,
                          }}
                        >
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 grid"
                            style={{
                              gridTemplateColumns: `repeat(${teamTimelineDates.length}, 4rem)`,
                            }}
                          >
                            {teamTimelineDates.map((date) => {
                              const today = isSameCalendarDate(
                                date,
                                new Date(),
                              )
                              const weekend =
                                date.getDay() === 0 || date.getDay() === 6
                              return (
                                <div
                                  key={date.toISOString()}
                                  className={cn(
                                    'border-r border-border/60',
                                    weekend && 'bg-muted/30',
                                    today && 'bg-primary/5',
                                  )}
                                />
                              )
                            })}
                          </div>

                          {placements.length > 0 ? (
                            placements.map(
                              ({ request, lane, startIndex, endIndex }) => {
                                const requestStatus =
                                  STATUS_META[request.status]
                                const deadline = deadlineLabel(
                                  requestDueDate(request),
                                )
                                return (
                                  <button
                                    key={request.id}
                                    type="button"
                                    title={`${request.values.title} · ${formatCompactDate(request.createdAt)} → ${formatCompactDate(requestDueDate(request))}`}
                                    className={cn(
                                      'absolute z-10 h-[50px] overflow-hidden rounded-md border px-2.5 py-1.5 text-left shadow-sm transition-colors',
                                      timelineBarTone(request),
                                    )}
                                    style={{
                                      left: startIndex * 64 + 4,
                                      top: lane * 58 + 6,
                                      width:
                                        (endIndex - startIndex + 1) * 64 - 8,
                                    }}
                                    onClick={() => openRequest(request)}
                                  >
                                    <p className="truncate text-xs font-semibold">
                                      {request.values.title}
                                    </p>
                                    <p className="mt-1 truncate text-[10px] opacity-80">
                                      {requestStatus.label} · {deadline.label} ·{' '}
                                      {departmentLabel(
                                        request.requesterDepartment,
                                      )}
                                    </p>
                                  </button>
                                )
                              },
                            )
                          ) : (
                            <div className="absolute inset-y-0 left-4 z-10 flex items-center text-xs text-muted-foreground">
                              배정된 업무가 없습니다.
                            </div>
                          )}
                        </div>
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {allowedSection === 'mine' ? (
          myActiveTasks.length > 0 ? (
            <div className="space-y-3">
              {myActiveTasks.map((request) =>
                renderRequestRow(request, 'mine'),
              )}
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
          completedRequests.length > 0 ? (
            <div className="space-y-3">
              {completedRequests.map((request) =>
                renderRequestRow(request, 'completed'),
              )}
            </div>
          ) : (
            renderEmptyState(
              '완료된 업무가 없습니다.',
              '완료 처리한 업무가 이 목록에 쌓입니다.',
            )
          )
        ) : null}

        <p className="mt-4 text-xs text-muted-foreground">
          역할별 UI 확인용 임시 데이터입니다. 변경 내용은 새로고침하면
          초기화되며 서버에는 저장되지 않습니다.
        </p>
      </div>
    )
  }

  if (screen.kind === 'detail' && selectedRequest) {
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

    return (
      <div ref={pageTopRef}>
        <PageHeader
          title={selectedRequest.values.title}
          description={`${selectedRequest.id} · ${departmentLabel(
            selectedRequest.requesterDepartment,
          )} → ${selectedConfig.teamName}`}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFlashMessage(null)
                  setScreen({ kind: 'list' })
                }}
              >
                <ArrowLeft className="size-4" />
                목록
              </Button>
              {canEdit ? (
                <Button type="button" onClick={() => openForm(selectedRequest)}>
                  <Pencil className="size-4" />
                  수정
                </Button>
              ) : null}
            </>
          }
        />

        {flashMessage ? (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{flashMessage}</span>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={status.variant}>{status.label}</Badge>
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
                  <Badge variant={deadline.variant}>{deadline.label}</Badge>
                  {selectedRequest.values.deadlineType === 'fixed' ? (
                    <Badge variant="warning">변경 불가 일정</Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <p className="text-xs text-muted-foreground">요청 부서</p>
                    <p className="mt-1 text-sm font-medium">
                      {departmentLabel(selectedRequest.requesterDepartment)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">요청자</p>
                    <p className="mt-1 text-sm font-medium">
                      {selectedRequest.values.requester || '미입력'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">요청 희망일</p>
                    <p className="mt-1 text-sm font-medium">
                      {formatDate(selectedRequest.values.dueDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">확정 마감일</p>
                    <p className="mt-1 text-sm font-medium">
                      {formatDate(selectedRequest.confirmedDueDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">담당자</p>
                    <p className="mt-1 text-sm font-medium">
                      {memberLabel(selectedRequest.assignee)}
                    </p>
                  </div>
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
                {selectedRequest.values.referenceUrl ? (
                  <a
                    href={selectedRequest.values.referenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {selectedRequest.values.referenceUrl}
                  </a>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            {canManageSelected ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserRoundCheck className="size-4" />
                    부서 관리자 처리
                  </CardTitle>
                  <CardDescription>
                    요청자가 제시한 일정을 검토한 뒤 실제 처리 순서를
                    결정하세요.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">상태</span>
                    <Select
                      className="w-full"
                      value={selectedRequest.status}
                      onChange={(event) =>
                        updateManagerField(selectedRequest.id, {
                          status: event.target.value as RequestStatus,
                        })
                      }
                    >
                      {Object.entries(STATUS_META).map(([value, meta]) => (
                        <option key={value} value={value}>
                          {meta.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">부서 우선순위</span>
                    <Select
                      className="w-full"
                      value={selectedRequest.managerPriority}
                      onChange={(event) =>
                        updateManagerField(selectedRequest.id, {
                          managerPriority: event.target
                            .value as ManagerPriority,
                        })
                      }
                    >
                      <option value="">검토 전</option>
                      {Object.entries(PRIORITY_META).map(([value, meta]) => (
                        <option key={value} value={value}>
                          {meta.label}
                        </option>
                      ))}
                    </Select>
                    <span className="block text-xs text-muted-foreground">
                      {selectedConfig.teamName} 작업 대기열 안에서의
                      순서입니다.
                    </span>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">주 담당자</span>
                    <Select
                      className="w-full"
                      value={selectedRequest.assignee}
                      onChange={(event) =>
                        updateManagerField(selectedRequest.id, {
                          assignee: event.target.value,
                          collaborators:
                            selectedRequest.collaborators.filter(
                              (id) => id !== event.target.value,
                            ),
                        })
                      }
                    >
                      <option value="">미배정</option>
                      {teamMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                          {member.isSelf ? ' (나)' : ''} · {member.position}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">협업자</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {teamMembers
                        .filter(
                          (member) => member.id !== selectedRequest.assignee,
                        )
                        .map((member) => {
                          const checked =
                            selectedRequest.collaborators.includes(member.id)
                          return (
                            <label
                              key={member.id}
                              className={cn(
                                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm',
                                checked
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                className="size-4 accent-primary"
                                onChange={() =>
                                  updateManagerField(selectedRequest.id, {
                                    collaborators: checked
                                      ? selectedRequest.collaborators.filter(
                                          (id) => id !== member.id,
                                        )
                                      : [
                                          ...selectedRequest.collaborators,
                                          member.id,
                                        ],
                                  })
                                }
                              />
                              <span className="truncate">
                                {member.name}
                                {member.isSelf ? ' (나)' : ''}
                              </span>
                            </label>
                          )
                        })}
                    </div>
                  </fieldset>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">확정 마감일</span>
                    <Input
                      type="date"
                      value={selectedRequest.confirmedDueDate}
                      onChange={(event) =>
                        updateManagerField(selectedRequest.id, {
                          confirmedDueDate: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">관리자 메모</span>
                    <Textarea
                      rows={4}
                      value={selectedRequest.managerNote}
                      placeholder="일정 조정 사유나 처리 방향"
                      onChange={(event) =>
                        updateManagerField(selectedRequest.id, {
                          managerNote: event.target.value,
                        })
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => saveManagerDecision(selectedRequest.id)}
                  >
                    처리 정보 저장
                  </Button>
                </CardContent>
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
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">진행 상태</span>
                      <Select
                        className="w-full"
                        value={selectedRequest.status}
                        onChange={(event) =>
                          updateManagerField(selectedRequest.id, {
                            status: event.target.value as RequestStatus,
                          })
                        }
                      >
                        <option value="accepted">시작 전</option>
                        <option value="inProgress">진행 중</option>
                        <option value="waiting">보류</option>
                        <option value="completed">완료</option>
                      </Select>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      완료 처리하면 내 업무 목록에서 완료 탭으로 이동합니다.
                    </p>
                  </CardContent>
                ) : null}
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock3 className="size-4" />
                    부서 검토
                  </CardTitle>
                  <CardDescription>
                    {selectedConfig.teamName} 관리자가 요청을 검토한 뒤
                    우선순위, 담당자와 확정 마감일을 지정합니다.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            {isSelfRequest ? (
              <Card>
                <CardHeader>
                  <CardTitle>보낸 요청 관리</CardTitle>
                  <CardDescription>
                    접수 전에는 내용을 수정하거나 삭제할 수 있습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {canEdit ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => openForm(selectedRequest)}
                      >
                        <Pencil className="size-4" />
                        요청 수정
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        className="w-full"
                        onClick={() => deleteRequest(selectedRequest)}
                      >
                        <Trash2 className="size-4" />
                        요청 삭제
                      </Button>
                    </>
                  ) : selectedRequest.status !== 'completed' &&
                    selectedRequest.status !== 'cancelled' ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => cancelRequest(selectedRequest)}
                    >
                      요청 취소
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      현재 상태에서는 수정하거나 삭제할 수 없습니다.
                    </p>
                  )}
                  <p className="pt-2 text-xs text-muted-foreground">
                    최종 수정 {formatDateTime(selectedRequest.updatedAt)}
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
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

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">참고 페이지 주소</span>
              <Input
                type="url"
                value={values.referenceUrl}
                placeholder="https://…"
                onChange={(event) =>
                  updateValue('referenceUrl', event.target.value)
                }
              />
            </label>
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
  const { brandSlug } = useBrand()

  if (!isWorkRequestOwner(owner)) {
    return <Navigate to={`/b/${brandSlug}`} replace />
  }

  return <WorkRequestForm key={owner} owner={owner} />
}
