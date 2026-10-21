import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ASSIGNMENT_CATALOG } from '@/lib/company/assignment-catalog'
import type { PermissionCode, PermissionGrant } from '@/lib/company/permissions'
import { useRenderWatch } from '@/lib/diagnostics'

type Props = {
  legacy?: boolean; delegated?: boolean; canEditApprovers: boolean
  grants?: readonly PermissionGrant[]; loading?: boolean; error?: boolean
  onApprovers: (part: 'departments' | 'self') => void
  onPermission?: (permission: PermissionCode) => void
}

export function PermissionAssignmentCatalog({ legacy=false, delegated=false, canEditApprovers, grants=[], loading=false, error=false, onApprovers, onPermission }: Props) {
  useRenderWatch('PermissionAssignmentCatalog')
  const [search,setSearch]=useState('')
  const needle=search.trim().toLowerCase()
  const items=ASSIGNMENT_CATALOG.filter(item => (!delegated || item.permission==='partner.edit') && (!item.approvalPart || canEditApprovers)
    && `${item.group} ${item.label} ${item.scope} ${item.description}`.toLowerCase().includes(needle))
  return <section aria-label="승인자와 기능별 담당자 설정" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">승인자·기능별 담당자 설정</h2><p className="mt-1 text-xs text-muted-foreground">신청 승인과 공지·출근시간·채팅 등 기능별 담당자를 한곳에서 확인합니다.</p></div><Input aria-label="승인·담당 업무 검색" placeholder="예: 야근, 공지, 채팅, 가입" value={search} onChange={event=>setSearch(event.target.value)} className="w-full sm:w-72"/></div>
    {legacy && <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">근태·야근은 기존 지정 내역으로 설정할 수 있습니다. 다른 기능의 개인별 지정 저장은 아직 연결되지 않아 잠겨 있으며, 현재 권한 기준은 유지됩니다.</p>}
    <div className="overflow-x-auto rounded-xl border border-border"><table aria-label="승인자·기능별 담당자 설정 목록" className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{['구분','업무·기능','적용 범위','지정 상태','설정'].map(label=><th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>
      {!items.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">검색한 업무가 없습니다.</td></tr>}
      {items.map(item=>{
        const count=new Set(grants.filter(grant=>grant.permission===item.permission).map(grant=>grant.profileId)).size
        const status=item.approvalPart==='self'?'구성 시안':item.approvalPart?'기존 지정 유지':legacy?'개인별 지정 저장 미연결':loading?'불러오는 중…':error?'조회 실패':`${count}명 지정`
        return <tr key={item.id} className="border-t border-border"><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.group}</td><td className="px-4 py-3"><span className="font-medium">{item.label}</span><span className="mt-1 block text-xs text-muted-foreground">{item.description}</span></td><td className="px-4 py-3 text-xs">{item.scope}</td><td className="px-4 py-3 text-xs text-muted-foreground">{status}</td><td className="px-4 py-3"><Button size="sm" variant="outline" disabled={!item.approvalPart && (legacy || loading || error || !onPermission)} aria-label={`${item.label} 설정`} onClick={()=>{if(item.approvalPart)onApprovers(item.approvalPart);else if(item.permission)onPermission?.(item.permission)}}>{item.approvalPart==='self'?'시안 보기':item.approvalPart?'승인자 설정':'담당자 지정'}</Button></td></tr>
      })}
    </tbody></table></div>
  </section>
}
