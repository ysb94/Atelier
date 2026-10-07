import { PageHeader } from '@/components/layout/PageHeader'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAuth } from '@/lib/supabase/auth'
import { capabilityLabel } from '@/lib/company/capabilities'
import { useState } from 'react'
import { useRenderWatch } from '@/lib/diagnostics'
import { PersonalRequestsPanel } from './PersonalRequestsPanel'

export function ProfileSettingsPage() {
  useRenderWatch('ProfileSettingsPage')
  const { profile, email } = useAuth()
  const [part, setPart] = useState<'requests' | 'profile'>('requests')

  return (
    <div>
      <PageHeader
        title="마이페이지"
        description="내 휴가·근무 신청과 승인 상태, 개인 정보를 확인합니다."
      />

      <div className="personal-page-tabs" role="tablist" aria-label="마이페이지 메뉴">
        <button type="button" role="tab" id="personal-requests-tab" aria-selected={part === 'requests'} aria-controls="personal-requests-panel" onClick={() => setPart('requests')}>근태·신청</button>
        <button type="button" role="tab" id="personal-profile-tab" aria-selected={part === 'profile'} aria-controls="personal-profile-panel" onClick={() => setPart('profile')}>내 정보</button>
      </div>
      <div id="personal-requests-panel" role="tabpanel" aria-labelledby="personal-requests-tab" hidden={part !== 'requests'}><PersonalRequestsPanel /></div>
      <div id="personal-profile-panel" role="tabpanel" aria-labelledby="personal-profile-tab" hidden={part !== 'profile'}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>프로필</CardTitle>
            <CardDescription>
              확인한 본명은 직접 바꿀 수 없습니다. 개명이나 오타는 운영지원팀
              또는 관리자에게 요청해 주세요.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">본명</p>
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                {profile?.displayName?.trim() || '본명 미입력'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">팀</p>
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  {profile?.departmentName || '팀 미정'}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">직책</p>
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  {profile?.position?.trim() || '직책 미정'}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              본명, 팀, 직책 변경은 운영지원팀 또는 관리자에게 요청해 주세요.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>계정 정보</CardTitle>
            <CardDescription>로그인 계정과 회사 업무 역량입니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                이메일
              </div>
              <div className="mt-1">{email ?? profile?.email ?? '—'}</div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                업무 역량
              </div>
              {profile?.capabilities.length ? (
                <ul className="mt-2 space-y-2">
                  {profile.capabilities.map((capability) => (
                    <li
                      key={capability}
                      className="rounded-md border border-border px-3 py-2"
                    >
                      {capabilityLabel(capability)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">지정된 역량 없음</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                역량 변경은 멤버 관리자에게 요청해 주세요. 승인된 직원은 모든
                브랜드를 조회할 수 있습니다.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  )
}
