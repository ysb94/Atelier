/**
 * 회의실 일정 표 범위·행 확장 검증.
 * 실행: npx tsx src/features/meetings/meeting-schedule.verify.ts
 */
import {
  DEFAULT_MEETING_VISIBLE_DAYS,
  MEETING_RANGE_STEP_DAYS,
  MEETING_ROOMS,
  MEETING_WEEKDAY_LABELS,
  addableMeetingMembers,
  assignMeetingChipClasses,
  chunkMeetingDays,
  combineDateTime,
  currentRoundNumber,
  dateKeyFromDateTime,
  emptyRoundNotes,
  filterSeriesByStatus,
  filterSeriesForViewer,
  formatMeetingAttendees,
  formatMeetingDuration,
  formatMeetingRangeLabel,
  formatSeriesDateSpan,
  formatRoundLabel,
  groupMeetingMembersByDepartment,
  groupMeetingsByRoomDay,
  appendPendingRound,
  canDeleteMeetingSeries,
  canRemoveBookedMeeting,
  canRemovePrepFile,
  formatMeetingComposeGaps,
  formatRoundGapLabel,
  formatRoundListLabel,
  roundGapDays,
  groupPrepMaterialsByUploader,
  isMeetingComposeReady,
  isPendingRound,
  findPendingRound,
  meetingComposeGaps,
  meetingDeleteConfirmPhrase,
  meetingSeriesDeleteImpact,
  meetingPositionRank,
  listMeetingDays,
  shiftMeetingFromKey,
  meetingPersonLabel,
  nextRoundNumber,
  preferredDetailRound,
  roomDayKey,
  seriesToDrafts,
  visibleDaysToCover,
} from './meeting-schedule'
import {
  DAY_QUARTERS,
  formatSlotBlockLabel,
  MEETING_DAY_LANE_HEIGHT_PX,
  WORK_DAY_CLOCKS,
  isClockCoveredByMeeting,
  listMeetingStartTimes,
  listWorkDayClocks,
  meetingLanePlacement,
  meetingTimeOverlaps,
  quartersBlockedByKind,
  resolveDayState,
  resolveSlotState,
  resolveStartTimeState,
} from './meeting-slots'

const host = { id: 'host-1', name: '작성자', position: '팀장' }
const memberA = { id: 'a', name: '김민지', position: '대리', departmentName: '기획팀' }
const memberB = { id: 'b', name: '이준호', position: '사원', departmentName: 'MD Team' }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(MEETING_ROOMS.length === 2, '지금은 회의실 2개')
assert(
  new Set(MEETING_ROOMS.map((room) => room.id)).size === MEETING_ROOMS.length,
  '회의실 id는 고유해야 한다',
)

const days = listMeetingDays('2026-09-10', DEFAULT_MEETING_VISIBLE_DAYS)
assert(days.length === 10, '기본은 월–금 2주')
assert(days[0]?.key === '2026-09-07', '이번 주 월요일부터')
assert(days[3]?.key === '2026-09-10', '목요일은 오늘')
assert(days[3]?.isToday === true, '오늘이면 isToday')
assert(days[9]?.key === '2026-09-18', '2주 끝은 다음 주 금요일')
assert(
  days.every((day) => !day.isWeekend),
  '주말은 표에 넣지 않는다',
)
assert(
  days.map((day) => day.weekday).slice(0, 5).join() ===
    MEETING_WEEKDAY_LABELS.join(),
  '한 주는 월화수목금',
)
assert(
  formatMeetingRangeLabel(days) === '9/7 – 9/18',
  '범위 라벨',
)
assert(
  formatSeriesDateSpan({
    rounds: [
      {
        id: 'a',
        round: 1,
        startsAt: '2026-09-07T09:00',
        roomId: 'room-1',
        quarterId: 'q1',
        ...emptyRoundNotes(),
      },
      {
        id: 'b',
        round: 2,
        startsAt: '2026-09-09T13:00',
        roomId: 'room-1',
        quarterId: 'q3',
        ...emptyRoundNotes(),
      },
    ],
  }) === '9/7 – 9/9',
  '완료 건은 첫날부터 마지막날',
)
assert(
  shiftMeetingFromKey('2026-09-10', 1) === '2026-09-24',
  '다음 2주는 14일 뒤',
)
assert(
  shiftMeetingFromKey('2026-09-10', -1) === '2026-08-27',
  '이전 2주는 14일 앞',
)
assert(
  listMeetingDays(shiftMeetingFromKey('2026-09-10', 1), 10, '2026-09-10')[0]
    ?.key === '2026-09-21',
  '다음 2주 표는 그다음 월요일부터',
)

assert(
  visibleDaysToCover('2026-09-10', '2026-09-20', 10) === 10,
  '보이는 기간 안이면 그대로',
)
assert(
  visibleDaysToCover('2026-09-10', '2026-09-30', 10) === 20,
  '더 뒤 날짜면 1주 단위로 늘린다',
)
assert(
  visibleDaysToCover('2026-09-10', '2026-09-01', 10) === 10,
  '오늘 이전이면 범위를 줄이지 않는다',
)

assert(dateKeyFromDateTime('2026-09-11T14:30') === '2026-09-11', '날짜만 자른다')
assert(combineDateTime('2026-09-11', '') === '2026-09-11T09:00', '빈 시간은 09:00')

assert(meetingPersonLabel(host) === '작성자 · 팀장', '호스트 라벨')
assert(
  formatMeetingAttendees({ host, members: [] }) === '작성자',
  '멤버 없으면 호스트만',
)
assert(
  formatMeetingAttendees({ host, members: [memberA, memberB] }) ===
    '작성자 외 2명',
  '멤버 수는 호스트를 빼서 센다',
)

const addable = addableMeetingMembers(
  [host, memberA, memberB],
  host.id,
  [memberA.id],
  '',
)
assert(
  addable.every((person) => person.id !== host.id && person.id !== memberA.id),
  '호스트와 이미 넣은 멤버는 목록에서 뺀다',
)
assert(
  addableMeetingMembers([host, memberA, memberB], host.id, [], '민지')[0]?.id ===
    'a',
  '이름으로 멤버를 찾는다',
)

assert(meetingPositionRank('이사') < meetingPositionRank('사원'), '이사가 직책 앞')
const byDept = groupMeetingMembersByDepartment(
  [
    { id: 'host-1', name: '작성자', position: '팀장', departmentId: 'd1', departmentName: '기획팀' },
    { id: 'a', name: '김민지', position: '대리', departmentId: 'd1', departmentName: '기획팀' },
    { id: 'c', name: '최이사', position: '이사', departmentId: 'd1', departmentName: '기획팀' },
    { id: 'b', name: '이준호', position: '사원', departmentId: 'd2', departmentName: 'MD Team' },
  ],
  'host-1',
  [
    { id: 'd1', name: '기획팀', sortOrder: 1 },
    { id: 'd2', name: 'MD Team', sortOrder: 2 },
  ],
)
assert(byDept[0]?.name === '기획팀', '부서는 조직 순')
assert(byDept[0]?.members[0]?.name === '최이사', '부서 안은 직책 높은 순')
assert(byDept[0]?.members.every((person) => person.id !== 'host-1'), '호스트는 목록에서 뺌')
assert(byDept[1]?.name === 'MD Team', '다음 부서')

assert(formatRoundLabel(1) === '1차', '차수 라벨')
assert(formatMeetingDuration(30) === '30분', '30분은 분으로')
assert(formatMeetingDuration(60) === '1시간', '60분은 시간으로')
assert(formatMeetingDuration(90) === '1시간 30분', '90분은 시간+분')
assert(nextRoundNumber({ rounds: [] }) === 1, '첫 일정은 1차')
assert(
  nextRoundNumber({
    rounds: [
      {
        id: 'r1',
        round: 1,
        startsAt: '2026-09-11T09:00',
        roomId: 'room-1',
        quarterId: 'q1',
      },
      {
        id: 'r2',
        round: 2,
        startsAt: '2026-09-18T09:00',
        roomId: 'room-1',
        quarterId: 'q1',
      },
    ],
  }) === 3,
  '다음은 마지막 차수 + 1',
)
assert(
  currentRoundNumber({
    rounds: [
      {
        id: 'r1',
        round: 1,
        startsAt: '2026-09-11T09:00',
        roomId: 'room-1',
        quarterId: 'q1',
      },
      {
        id: 'r2',
        round: 2,
        startsAt: '2026-09-18T09:00',
        roomId: 'room-1',
        quarterId: 'q1',
      },
    ],
  }) === 2,
  '현재 차수는 가장 큰 번호',
)

const weeks = chunkMeetingDays(days)
assert(weeks.length === 2, '2주는 가로 스크롤 없이 주 2덩어리')
assert(weeks[0]?.length === 5 && weeks[1]?.length === 5, '한 주는 월–금 5일')
const chipClasses = assignMeetingChipClasses([
  { id: 'one', seriesId: 's-a' },
  { id: 'two', seriesId: 's-b' },
])
assert(
  chipClasses.get('one') !== chipClasses.get('two'),
  '같은 칸 예약은 색이 달라야 한다',
)

const extraRoomId = 'room-3'
const grouped = groupMeetingsByRoomDay([
  {
    id: 'a',
    title: '오후',
    startsAt: '2026-09-11T15:00',
    roomId: 'room-1',
    host,
    members: [],
    seriesId: 's1',
    round: 2,
    quarterId: 'q3',
    durationMinutes: 60,
  },
  {
    id: 'b',
    title: '오전',
    startsAt: '2026-09-11T09:00',
    roomId: 'room-1',
    host,
    members: [memberA],
    seriesId: 's1',
    round: 1,
    quarterId: 'q1',
    durationMinutes: 60,
  },
  {
    id: 'c',
    title: '새 회의실',
    startsAt: '2026-09-12T10:00',
    roomId: extraRoomId,
    host,
    members: [],
    seriesId: 's2',
    round: 1,
    quarterId: 'q2',
    durationMinutes: 60,
  },
])
const room1 = grouped.get(roomDayKey('room-1', '2026-09-11'))
assert(room1?.[0]?.title === '오전', '같은 칸은 시간순')
assert(room1?.[1]?.title === '오후', '같은 칸 두 번째')
assert(
  grouped.get(roomDayKey(extraRoomId, '2026-09-12'))?.[0]?.title ===
    '새 회의실',
  '회의실이 늘어도 행 키만 추가하면 된다',
)

const seriesList = [
  {
    id: 's-open',
    title: '운영 점검',
    host,
    members: [memberA],
    status: 'in_progress' as const,
    durationMinutes: 60,
    rounds: [
      {
        id: 'r1',
        round: 1,
        startsAt: '2026-09-11T09:00',
        roomId: 'room-1',
        quarterId: 'q1' as const,
        ...emptyRoundNotes(),
      },
    ],
  },
  {
    id: 's-done',
    title: '끝난 주제',
    host,
    members: [],
    status: 'done' as const,
    durationMinutes: 30,
    rounds: [
      {
        id: 'r9',
        round: 3,
        startsAt: '2026-09-01T09:00',
        roomId: 'room-2',
        quarterId: 'q1' as const,
        ...emptyRoundNotes(),
      },
    ],
  },
]
assert(filterSeriesByStatus(seriesList, 'in_progress').length === 1, '진행중 탭')
assert(filterSeriesByStatus(seriesList, 'done')[0]?.id === 's-done', '완료 탭')
assert(
  filterSeriesForViewer(seriesList, host, true).length === seriesList.length,
  '관리자는 모든 회의를 본다',
)
assert(
  filterSeriesForViewer(seriesList, memberB, false).length === 0,
  '안 들어간 회의는 목록에 없다',
)
assert(
  filterSeriesForViewer(seriesList, memberA, false).map((item) => item.id).join() ===
    's-open',
  '멤버는 본인 회의만 본다',
)
assert(seriesToDrafts(seriesList).length === 2, '차수가 일정 칸으로 펼쳐진다')
assert(
  seriesToDrafts([
    {
      ...seriesList[0],
      rounds: [
        ...seriesList[0].rounds,
        {
          id: 'pending',
          round: 2,
          startsAt: '',
          roomId: '',
          quarterId: 'q1' as const,
          ...emptyRoundNotes(),
        },
      ],
    },
  ]).length === 1,
  '예정 차는 달력에 안 올라간다',
)
assert(isPendingRound({ startsAt: '' }), '시작 시각이 없으면 예정')
const pendingSeries = appendPendingRound(seriesList[0], 'pending-next')
assert(findPendingRound(pendingSeries)?.id === 'pending-next', '다음 차를 예정으로 붙인다')
assert(
  preferredDetailRound(pendingSeries)?.id === 'pending-next',
  '상세는 예정 차를 연다',
)
assert(
  preferredDetailRound(seriesList[0])?.id === 'r1',
  '예정이 없으면 최근 차를 연다',
)
assert(
  canRemoveBookedMeeting({ host }, host),
  '호스트는 일정 칸을 지울 수 있다',
)
assert(
  !canRemoveBookedMeeting({ host }, memberA),
  '호스트가 아니면 일정 칸을 지울 수 없다',
)
assert(
  canDeleteMeetingSeries({ host }, host, false),
  '호스트는 회의건을 지울 수 있다',
)
assert(
  canDeleteMeetingSeries({ host }, memberA, true),
  '관리자는 회의건을 지울 수 있다',
)
assert(
  !canDeleteMeetingSeries({ host }, memberA, false),
  '다른 멤버는 회의건을 못 지운다',
)
assert(
  meetingDeleteConfirmPhrase(' 주간 운영 점검 ') === '주간 운영 점검',
  '삭제 확인은 주제 그대로',
)
assert(
  meetingSeriesDeleteImpact({
    rounds: [
      {
        id: 'r1',
        round: 1,
        startsAt: '2026-09-07T16:30',
        roomId: 'room-1',
        quarterId: 'q1',
        prepMaterials: [
          {
            id: 'f1',
            name: 'a.pdf',
            size: 1,
            type: 'application/pdf',
            url: 'blob:a',
            uploadedBy: host,
          },
        ],
        content: '내용',
        result: '결과',
      },
      {
        id: 'r2',
        round: 2,
        startsAt: '',
        roomId: '',
        quarterId: 'q1',
        ...emptyRoundNotes(),
      },
    ],
  }).files === 1,
  '삭제 영향에 자료를 센다',
)
assert(
  appendPendingRound(pendingSeries, 'pending-dup') === pendingSeries,
  '예정 차가 있으면 다시 붙이지 않는다',
)
assert(
  formatRoundListLabel({ round: 3, startsAt: '2026-09-10T14:30' }) ===
    '3차 회의',
  '확정 차 목록 이름',
)
assert(
  formatRoundListLabel({ round: 4, startsAt: '' }) === '다음 차 예정',
  '예정 차 목록 이름',
)
const gapRounds = [
  { round: 1, startsAt: '2026-09-07T16:30' },
  { round: 2, startsAt: '2026-09-09T10:00' },
  { round: 3, startsAt: '2026-09-09T14:30' },
  { round: 4, startsAt: '' },
]
assert(roundGapDays(gapRounds, gapRounds[0]) == null, '1차는 간격 없음')
assert(roundGapDays(gapRounds, gapRounds[1]) === 2, '2차는 이틀 만')
assert(roundGapDays(gapRounds, gapRounds[2]) === 0, '같은 날 이어서')
assert(roundGapDays(gapRounds, gapRounds[3]) == null, '예정 차는 간격 없음')
assert(formatRoundGapLabel(0) === '+0일', '같은 날')
assert(formatRoundGapLabel(1) === '+1일', '하루 뒤')
assert(formatRoundGapLabel(7) === '+7일', '일주일')
assert(formatRoundGapLabel(-3) === '-3일', '이전 차보다 앞')
const emptyCompose = meetingComposeGaps({
  title: '',
  durationMinutes: null,
  memberCount: 0,
})
assert(!isMeetingComposeReady(emptyCompose), '비어 있으면 날짜를 고르지 않는다')
assert(
  formatMeetingComposeGaps(emptyCompose) ===
    '아직 안 정한 항목: 주제, 회의 시간, 멤버',
  '빠진 항목을 알려 준다',
)
assert(
  formatMeetingComposeGaps(
    meetingComposeGaps({
      title: '운영 점검',
      durationMinutes: null,
      memberCount: 1,
    }),
  ) === '회의 시간을 선택하세요.',
  '다음 차는 시간만 고르면 된다',
)
assert(
  canRemovePrepFile(
    {
      uploadedBy: host,
    },
    host,
  ),
  '올린 사람은 지울 수 있다',
)
assert(
  !canRemovePrepFile(
    {
      uploadedBy: host,
    },
    memberA,
  ),
  '다른 사람은 지울 수 없다',
)
const prepGroups = groupPrepMaterialsByUploader([
  {
    id: 'f2',
    name: 'b.pdf',
    size: 2,
    type: 'application/pdf',
    url: 'blob:b',
    uploadedBy: memberA,
  },
  {
    id: 'f1',
    name: 'a.pdf',
    size: 1,
    type: 'application/pdf',
    url: 'blob:a',
    uploadedBy: host,
  },
  {
    id: 'f3',
    name: 'c.pdf',
    size: 3,
    type: 'application/pdf',
    url: 'blob:c',
    uploadedBy: memberA,
  },
])
assert(prepGroups.length === 2, '자료는 올린 사람별로 묶인다')
assert(prepGroups[0]?.person.id === memberA.id, '먼저 올린 사람이 앞에 온다')
assert(prepGroups[0]?.files.length === 2, '같은 사람 파일은 한 묶음')
assert(prepGroups[1]?.person.id === host.id, '다른 사람은 다음 묶음')

assert(quartersBlockedByKind('annual').length === 4, '연차는 하루 전체')
assert(quartersBlockedByKind('am_quarter').join() === 'q1', '오전반반차는 오전1')
assert(quartersBlockedByKind('pm_quarter').join() === 'q4', '오후반반차는 오후2')
assert(
  quartersBlockedByKind('am_half').join() === 'q1,q2',
  '오전반차는 오전 두 칸',
)

const weekday = days[1]
assert(weekday && !weekday.isWeekend, '둘째 날은 평일')
const q1 = DAY_QUARTERS[0]
const future = new Date(2026, 8, 1, 8, 0)
assert(
  resolveSlotState({
    composeReady: false,
    day: weekday,
    quarter: q1,
    roomId: 'room-1',
    attendees: [host],
    attendance: [],
    occupant: null,
    now: future,
  }).available === false,
  '주제 없으면 칸이 꺼진다',
)
assert(
  resolveSlotState({
    composeReady: true,
    day: weekday,
    quarter: q1,
    roomId: 'room-1',
    attendees: [host, memberA],
    attendance: [
      { personId: memberA.id, dateKey: weekday.key, kind: 'am_half' },
    ],
    occupant: null,
    now: future,
  }).available === false,
  '멤버 오전반차면 오전1 불가',
)
const taken = resolveSlotState({
  composeReady: true,
  day: weekday,
  quarter: q1,
  roomId: 'room-1',
  attendees: [host],
  attendance: [],
  occupant: {
    id: 'other',
    title: '다른 팀 회의',
    startsAt: `${weekday.key}T09:00`,
    roomId: 'room-1',
    host,
    members: [],
    seriesId: 'other-team',
    round: 1,
    quarterId: 'q1',
    durationMinutes: 60,
  },
  now: future,
})
assert(taken.available === false, '다른 팀이 잡으면 불가')
assert(
  formatSlotBlockLabel(taken.blocks).includes('다른 팀'),
  '다른 팀 예약 안내',
)

const dayClocks = listWorkDayClocks()
assert(dayClocks[0] === '09:00', '팝업 첫 칸은 9시')
assert(dayClocks[dayClocks.length - 1] === '19:00', '팝업 마지막 칸은 19시')
assert(dayClocks.length === 21, '9–19시를 30분으로 나누면 21칸')
assert(WORK_DAY_CLOCKS.length === 21, '업무 시각 목록')
const morningLane = meetingLanePlacement('2026-09-14T09:00', 60)
assert(morningLane.topPx === 0, '9시 예약은 칸 위')
const noonLane = meetingLanePlacement('2026-09-14T14:00', 60)
assert(
  noonLane.topPx === MEETING_DAY_LANE_HEIGHT_PX / 2,
  '14시 예약은 칸 가운데',
)
assert(
  meetingLanePlacement('2026-09-14T18:00', 60).topPx > noonLane.topPx,
  '저녁 예약은 더 아래',
)
assert(morningLane.heightPx < noonLane.topPx, '1시간은 하루 칸보다 짧다')

const starts = listMeetingStartTimes(60)
assert(starts[0] === '09:00', '업무 시작 9시')
assert(starts.includes('18:00'), '1시간이면 18시 시작까지')
assert(!starts.includes('18:30'), '19시를 넘기면 시작 불가')
assert(
  meetingTimeOverlaps('10:00', 60, [
    { startsAt: '2026-09-11T09:30', durationMinutes: 60 },
  ]),
  '겹치면 다른 팀 예약',
)
assert(
  !meetingTimeOverlaps('11:00', 60, [
    { startsAt: '2026-09-11T09:30', durationMinutes: 60 },
  ]),
  '끝나면 다음 시작 가능',
)

const weekend = {
  key: '2026-09-12',
  month: 9,
  day: 12,
  weekday: '토',
  isWeekend: true,
  isToday: false,
}
assert(weekend.isWeekend === true, '주말 날짜 모델')
assert(
  resolveDayState({
    composeReady: true,
    day: weekday,
    durationMinutes: 60,
    attendees: [host, memberA],
    attendance: [
      { personId: memberA.id, dateKey: weekday.key, kind: 'am_quarter' },
    ],
    occupants: [],
    now: future,
  }).available,
  '한 명 반반차여도 날짜는 켜진다',
)
assert(
  resolveDayState({
    composeReady: true,
    day: weekend,
    durationMinutes: 60,
    attendees: [host],
    attendance: [],
    occupants: [],
    now: future,
  }).available === false,
  '주말은 날짜가 꺼진다',
)
assert(
  resolveDayState({
    composeReady: true,
    day: weekday,
    durationMinutes: 60,
    attendees: [host],
    attendance: [
      { personId: host.id, dateKey: weekday.key, kind: 'annual' },
    ],
    occupants: [],
    now: future,
  }).available === false,
  '전원이 연차면 날짜가 꺼진다',
)
assert(
  resolveStartTimeState({
    dateKey: weekday.key,
    clock: '09:00',
    durationMinutes: 60,
    attendees: [host, memberA],
    attendance: [
      { personId: memberA.id, dateKey: weekday.key, kind: 'am_quarter' },
    ],
    occupants: [],
    now: future,
  }).available === false,
  '오전반반차는 9시 시작을 끈다',
)
assert(
  resolveStartTimeState({
    dateKey: weekday.key,
    clock: '11:00',
    durationMinutes: 60,
    attendees: [host, memberA],
    attendance: [
      { personId: memberA.id, dateKey: weekday.key, kind: 'am_quarter' },
    ],
    occupants: [],
    now: future,
  }).available,
  '오전반반차 뒤 시간은 고를 수 있다',
)
assert(
  resolveStartTimeState({
    dateKey: weekday.key,
    clock: '19:00',
    durationMinutes: 30,
    attendees: [host],
    attendance: [],
    occupants: [],
    now: future,
  }).available === false,
  '19시 시작은 업무 끝을 넘긴다',
)
assert(
  isClockCoveredByMeeting('09:30', '09:00', 60),
  '1시간이면 시작 다음 30분도 포함',
)
assert(
  !isClockCoveredByMeeting('10:00', '09:00', 60),
  '1시간이면 끝나는 시각은 다음 회의 자리',
)
assert(
  isClockCoveredByMeeting('10:00', '09:00', 120),
  '2시간이면 10시도 포함',
)

console.log('meeting-schedule.verify ok')
