import { useEffect, useMemo, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useRenderWatch } from '@/lib/diagnostics'
import { personInitials } from '@/lib/company/person-name'
import {
  listDepartments,
  listOrgChartMembers,
  type Department,
  type OrgChartMember,
} from '@/lib/supabase/profiles'
import { cn, emptyList, formatNumber } from '@/lib/utils'

const POSITION_RANK = ['이사', '팀장', '과장', '대리', '사원']

type Tone = { mark: string; glow: string }

const TEAM_TONES: readonly Tone[] = [
  { mark: 'bg-[#f1e7d6] text-[#7a5a2b]', glow: 'bg-[#e9d3ad]' },
  { mark: 'bg-[#e1ece4] text-[#2f6b4f]', glow: 'bg-[#c4dccb]' },
  { mark: 'bg-[#e3e7f2] text-[#3d4a78]', glow: 'bg-[#c8d0ea]' },
  { mark: 'bg-[#f3e1e0] text-[#9a3f3c]', glow: 'bg-[#ecc6c3]' },
  { mark: 'bg-[#ebe3f1] text-[#5d4a7a]', glow: 'bg-[#d8c9e8]' },
  { mark: 'bg-[#dfecee] text-[#2d6470]', glow: 'bg-[#bfdde2]' },
]

const UNASSIGNED_TONE: Tone = {
  mark: 'bg-muted text-muted-foreground',
  glow: 'bg-muted',
}

const CARD_DELAY_MS = 300
const CARD_STEP_MS = 70

type TeamGroup = {
  id: string
  name: string
  tone: Tone
  members: OrgChartMember[]
}

function positionRank(position: string | null) {
  const index = POSITION_RANK.indexOf((position ?? '').trim())
  return index === -1 ? POSITION_RANK.length : index
}

function memberName(member: OrgChartMember) {
  return member.displayName?.trim() || '이름 없음'
}

function compareMembers(left: OrgChartMember, right: OrgChartMember) {
  const rank = positionRank(left.position) - positionRank(right.position)
  if (rank !== 0) return rank
  return memberName(left).localeCompare(memberName(right), 'ko')
}

function delayStyle(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` }
}

function cardDelay(index: number) {
  return CARD_DELAY_MS + Math.min(index, 10) * CARD_STEP_MS
}

export function OrgChartPage() {
  useRenderWatch('OrgChartPage')
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })
  const membersQuery = useQuery({
    queryKey: ['orgChartMembers'],
    queryFn: () => listOrgChartMembers(),
  })
  const departments = departmentsQuery.data ?? emptyList<Department>()
  const members = membersQuery.data ?? emptyList<OrgChartMember>()

  useEffect(() => {
    if (!membersQuery.error) return
    console.warn('[org-chart] 직원 목록 조회 실패', membersQuery.error)
  }, [membersQuery.error])

  const { staffed, empty } = useMemo(() => {
    const activeIds = new Set(departments.map((dept) => dept.id))
    const byDepartment = new Map<string, OrgChartMember[]>()
    const unassigned: OrgChartMember[] = []
    for (const member of members) {
      if (member.departmentId && activeIds.has(member.departmentId)) {
        const list = byDepartment.get(member.departmentId) ?? []
        list.push(member)
        byDepartment.set(member.departmentId, list)
      } else {
        unassigned.push(member)
      }
    }
    const teams: TeamGroup[] = departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
      tone: UNASSIGNED_TONE,
      members: (byDepartment.get(dept.id) ?? []).sort(compareMembers),
    }))
    const staffedTeams = teams
      .filter((team) => team.members.length > 0)
      .map((team, index) => ({
        ...team,
        tone: TEAM_TONES[index % TEAM_TONES.length] ?? UNASSIGNED_TONE,
      }))
    if (unassigned.length > 0) {
      staffedTeams.push({
        id: 'unassigned',
        name: '소속 없음',
        tone: UNASSIGNED_TONE,
        members: unassigned.sort(compareMembers),
      })
    }
    return {
      staffed: staffedTeams,
      empty: teams.filter((team) => team.members.length === 0),
    }
  }, [departments, members])

  const loading = departmentsQuery.isPending || membersQuery.isPending
  const membersFailed = Boolean(membersQuery.error)
  const loadError =
    (departmentsQuery.error instanceof Error
      ? departmentsQuery.error.message
      : null) ||
    (membersQuery.error instanceof Error ? membersQuery.error.message : null)
  const emptyDelay = cardDelay(staffed.length) + 150

  return (
    <div>
      <PageHeader
        title="조직도"
        description="E&J 회사 공통 팀입니다. 브랜드는 데이터가 나뉘는 축이고, 직원 소속은 여기입니다."
      />

      {loadError ? (
        <p className="mb-4 text-sm text-danger">{loadError}</p>
      ) : null}

      <section className="relative isolate overflow-hidden rounded-3xl border border-border bg-card/50 px-4 pt-10 pb-12 md:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 [background-image:radial-gradient(circle,rgba(26,26,26,0.1)_1px,transparent_1.5px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_80%_70%_at_50%_0%,black_35%,transparent_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-1/2 -z-10 h-56 w-[40rem] max-w-full -translate-x-1/2 -translate-y-1/3 rounded-full bg-accent/80 blur-3xl"
        />

        <div className="flex flex-col items-center">
          <RootNode
            loading={loading}
            memberCount={members.length}
            teamCount={departments.length}
          />
          <Connector />

          {loading ? (
            <TeamSkeletons />
          ) : departments.length === 0 && staffed.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 팀이 없습니다.</p>
          ) : (
            <>
              {staffed.length > 0 ? (
                <ul className="flex w-full flex-wrap items-start justify-center gap-4">
                  {staffed.map((team, index) => (
                    <TeamCard key={team.id} team={team} delay={cardDelay(index)} />
                  ))}
                </ul>
              ) : null}
              {empty.length > 0 ? (
                <TeamChips
                  label={
                    membersFailed
                      ? `팀 ${formatNumber(empty.length)}`
                      : `아직 소속 직원이 없는 팀 ${formatNumber(empty.length)}`
                  }
                  teams={empty}
                  delay={staffed.length > 0 ? emptyDelay : CARD_DELAY_MS}
                  spaced={staffed.length > 0}
                />
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function RootNode({
  loading,
  memberCount,
  teamCount,
}: {
  loading: boolean
  memberCount: number
  teamCount: number
}) {
  return (
    <div className="animate-org-pop flex items-center gap-3 rounded-2xl bg-primary py-3 pr-5 pl-3 text-primary-foreground shadow-[0_16px_40px_-18px_rgba(26,26,26,0.6)]">
      <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
        <Building2 className="size-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-semibold tracking-tight">E&J</span>
        <span className="block text-xs text-primary-foreground/60">
          {loading
            ? '불러오는 중'
            : `직원 ${formatNumber(memberCount)}명 · 팀 ${formatNumber(teamCount)}개`}
        </span>
      </span>
    </div>
  )
}

function Connector() {
  return (
    <div aria-hidden className="flex flex-col items-center">
      <span
        className="animate-org-grow-y h-7 w-px origin-top bg-linear-to-b from-foreground/40 to-foreground/15"
        style={delayStyle(150)}
      />
      <span
        className="animate-org-pop size-2.5 rounded-full border-2 border-foreground/25 bg-card"
        style={delayStyle(380)}
      />
      <span
        className="animate-org-grow-y h-7 w-px origin-top bg-linear-to-b from-foreground/15 to-transparent"
        style={delayStyle(420)}
      />
    </div>
  )
}

function TeamCard({ team, delay }: { team: TeamGroup; delay: number }) {
  return (
    <li className="animate-org-rise w-full sm:w-68" style={delayStyle(delay)}>
      <article className="group relative isolate overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm transition duration-300 ease-out hover:-translate-y-1 hover:border-foreground/15 hover:shadow-[0_18px_40px_-20px_rgba(26,26,26,0.35)]">
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -top-10 -right-10 -z-10 size-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-80',
            team.tone.glow,
          )}
        />
        <header className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold',
              team.tone.mark,
            )}
          >
            {team.name.trim().slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold tracking-tight">
              {team.name}
            </h3>
            <p className="text-xs text-muted-foreground">
              {formatNumber(team.members.length)}명
            </p>
          </div>
        </header>
        <ul className="mt-3 space-y-0.5 border-t border-border/70 pt-2.5">
          {team.members.map((member, index) => (
            <li
              key={member.id}
              className="animate-org-rise flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/70"
              style={delayStyle(delay + 120 + Math.min(index, 8) * 45)}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  team.tone.mark,
                )}
              >
                {personInitials(member.displayName)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {memberName(member)}
              </span>
              <PositionPill position={member.position} />
            </li>
          ))}
        </ul>
      </article>
    </li>
  )
}

function PositionPill({ position }: { position: string | null }) {
  const label = position?.trim()
  if (!label) return null
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
        label === '이사'
          ? 'bg-foreground text-background'
          : label === '팀장'
            ? 'bg-foreground/10 text-foreground'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  )
}

function TeamChips({
  label,
  teams,
  delay,
  spaced,
}: {
  label: string
  teams: readonly TeamGroup[]
  delay: number
  spaced: boolean
}) {
  return (
    <div className={cn('flex w-full flex-col items-center gap-3', spaced && 'mt-10')}>
      <p
        className="animate-org-rise text-xs font-medium text-muted-foreground"
        style={delayStyle(delay)}
      >
        {label}
      </p>
      <ul className="flex max-w-4xl flex-wrap justify-center gap-2">
        {teams.map((team, index) => (
          <li
            key={team.id}
            className="animate-org-rise inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-card/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            style={delayStyle(delay + 60 + Math.min(index, 12) * 35)}
          >
            <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/30" />
            {team.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TeamSkeletons() {
  return (
    <ul aria-hidden className="flex w-full flex-wrap items-start justify-center gap-4">
      {[0, 1, 2].map((key) => (
        <li
          key={key}
          className="w-full animate-pulse rounded-2xl border border-border bg-card p-4 sm:w-68"
        >
          <div className="flex items-center gap-3">
            <span className="size-9 rounded-xl bg-muted" />
            <span className="h-3 w-24 rounded bg-muted" />
          </div>
          <div className="mt-4 space-y-2.5 border-t border-border/70 pt-3">
            <span className="block h-3 w-40 rounded bg-muted" />
            <span className="block h-3 w-32 rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  )
}
