import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import {
  companyNavGroups,
  companyNavItemActive,
  companyTopNav,
  membersNavItem,
} from './company-workspace-nav'

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
  /** 제목 위 작은 글씨. 비우면 메뉴 구성에서 이 화면이 속한 구역 이름을 자동으로 쓴다. false면 숨긴다. */
  eyebrow?: string | false
}

function sectionOf(pathname: string): string | undefined {
  if (companyNavItemActive(membersNavItem.to, pathname)) return '운영지원'
  const group = companyNavGroups.find((item) =>
    item.items.some((entry) => companyNavItemActive(entry.to, pathname)),
  )
  if (group) return group.title
  if (companyTopNav.some((entry) => companyNavItemActive(entry.to, pathname))) {
    return 'E&J'
  }
  return undefined
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: PageHeaderProps) {
  const { pathname } = useLocation()
  const section = eyebrow === false ? undefined : (eyebrow ?? sectionOf(pathname))

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {section ? (
          <p className="mb-1 text-[11px] font-semibold tracking-[0.12em] text-primary">
            {section}
          </p>
        ) : null}
        <h1 className="text-[22px] font-bold leading-tight tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-4xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
