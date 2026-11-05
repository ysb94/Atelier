import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Plus, PackagePlus, Search, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { StatusPill } from '@/components/ui/status-pill'
import { useAuth } from '@/lib/supabase/auth'
import { useRenderWatch } from '@/lib/diagnostics'

const KINDS = ['원단', '부자재', '포장자재', '기타'] as const
type MaterialRequest = { id:string; kind:string; name:string; specification:string; quantity:string; unit:string; neededOn:string; draft:string; note:string }
const blank = ():MaterialRequest => ({id:crypto.randomUUID(),kind:'원단',name:'',specification:'',quantity:'',unit:'m',neededOn:'',draft:'',note:''})

export function MaterialRequestsPage() {
  const {session}=useAuth()
  return <MaterialRequestsPreview key={session?.user.id??'signed-out'}/>
}

function MaterialRequestsPreview() {
  useRenderWatch('MaterialRequestsPage')
  const [rows,setRows]=useState<MaterialRequest[]>([]),[form,setForm]=useState<MaterialRequest|null>(null)
  const [search,setSearch]=useState(''),[kind,setKind]=useState(''),[notice,setNotice]=useState('')
  const filtered=rows.filter(row=>(!kind||row.kind===kind)&&`${row.name} ${row.specification} ${row.draft}`.toLowerCase().includes(search.trim().toLowerCase()))
  function save(value:MaterialRequest) {
    setRows(current=>[value,...current.filter(row=>row.id!==value.id)]);setForm(null);setNotice('미리보기 목록에 반영했습니다. 실제 요청은 전송되지 않았습니다.')
  }
  return <div className="space-y-5">
    <PageHeader title="자재요청" description="기획에 필요한 원단과 부자재 요청 내용을 한곳에서 확인합니다." actions={<Button onClick={()=>setForm(blank())}><Plus size={16}/>자재 요청</Button>}/>
    <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">UI 미리보기입니다. 입력한 내용은 이 화면에서만 확인할 수 있으며 새로고침하면 초기화됩니다.</p>
    <FilterBar><label className="flex min-w-0 flex-1 items-center gap-2"><Search size={16} className="shrink-0 text-muted-foreground"/><Input aria-label="자재 검색" placeholder="자재명·규격·기획안 검색" value={search} onChange={event=>setSearch(event.target.value)}/></label><Select aria-label="자재 구분 필터" className="sm:w-44" value={kind} onChange={event=>setKind(event.target.value)}><option value="">전체 자재</option>{KINDS.map(value=><option key={value}>{value}</option>)}</Select></FilterBar>
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">자재 요청 목록 <span className="ml-1 tabular-nums text-primary">{filtered.length}</span></h2><span className="text-xs text-muted-foreground">단위별 수량을 확인해 주세요.</span></div>
    {notice&&<p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left text-sm" aria-label="자재 요청 목록"><thead className="bg-primary text-primary-foreground"><tr>{['구분','자재명 / 규격','수량','필요 일자','관련 기획안','상태',''].map((label,i)=><th key={i} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>
      {filtered.map(row=><tr key={row.id} className="border-t border-border"><td className="px-4 py-4 text-muted-foreground">{row.kind}</td><th scope="row" className="px-4 py-4 font-medium"><button className="text-left hover:text-primary" onClick={()=>setForm({...row})}>{row.name}</button><p className="mt-1 font-normal text-muted-foreground">{row.specification||'—'}</p></th><td className="whitespace-nowrap px-4 py-4 tabular-nums">{Number(row.quantity).toLocaleString('ko-KR',{maximumFractionDigits:10})} {row.unit}</td><td className="whitespace-nowrap px-4 py-4">{row.neededOn||'—'}</td><td className="px-4 py-4">{row.draft||'—'}</td><td className="px-4 py-4"><StatusPill tone="muted">미리보기</StatusPill></td><td className="px-4 py-4"><Button size="sm" variant="ghost" aria-label={`${row.name} 미리보기 삭제`} onClick={()=>setRows(current=>current.filter(item=>item.id!==row.id))}>삭제</Button></td></tr>)}
      {!filtered.length&&<tr><td colSpan={7} className="px-6 py-16 text-center"><PackagePlus size={28} className="mx-auto mb-3 text-muted-foreground"/><p className="font-medium">{rows.length?'검색 결과가 없습니다.':'등록된 자재요청이 없습니다.'}</p><p className="mt-2 text-sm text-muted-foreground">{rows.length?'검색어나 자재 구분을 변경해 주세요.':'자재 요청 버튼을 눌러 작성 화면을 확인해 보세요.'}</p></td></tr>}
    </tbody></table></div></Card>
    {form&&<WorkspaceTabOverlay><MaterialRequestDialog initial={form} onClose={()=>setForm(null)} onSave={save}/></WorkspaceTabOverlay>}
  </div>
}

function MaterialRequestDialog({initial,onClose,onSave}:{initial:MaterialRequest;onClose:()=>void;onSave:(value:MaterialRequest)=>void}) {
  const ref=useRef<HTMLDialogElement>(null),[form,setForm]=useState(initial)
  useEffect(()=>{ref.current?.showModal()},[])
  function submit(event:FormEvent){event.preventDefault();onSave({...form,name:form.name.trim()})}
  return <dialog ref={ref} aria-labelledby="material-request-title" onCancel={onClose} onClose={onClose} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-0 text-card-foreground shadow-sm backdrop:bg-foreground/30">
    <form onSubmit={submit}><header className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-xs text-muted-foreground">기획 · 자재요청</p><h2 id="material-request-title" className="mt-1 text-lg font-semibold">자재 요청 작성</h2></div><Button type="button" size="icon" variant="ghost" aria-label="자재 요청 닫기" onClick={onClose}><X size={18}/></Button></header>
    <div className="grid gap-4 p-5 sm:grid-cols-2"><label className="space-y-2 text-sm">자재 구분<Select value={form.kind} onChange={event=>setForm({...form,kind:event.target.value})}>{KINDS.map(value=><option key={value}>{value}</option>)}</Select></label><label className="space-y-2 text-sm">관련 기획안<Input placeholder="기획안 번호 또는 제목" value={form.draft} onChange={event=>setForm({...form,draft:event.target.value})}/></label>
      <label className="space-y-2 text-sm sm:col-span-2">자재명 <span className="text-primary">*</span><Input required maxLength={100} placeholder="요청할 자재명을 입력하세요" value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label>
      <label className="space-y-2 text-sm sm:col-span-2">규격·색상<Input placeholder="폭, 두께, 색상 등" value={form.specification} onChange={event=>setForm({...form,specification:event.target.value})}/></label>
      <label className="space-y-2 text-sm">요청 수량 <span className="text-primary">*</span><Input required type="number" min="0.001" step="any" placeholder="0" value={form.quantity} onChange={event=>setForm({...form,quantity:event.target.value})}/></label><label className="space-y-2 text-sm">단위<Select value={form.unit} onChange={event=>setForm({...form,unit:event.target.value})}>{['m','개','장','세트','kg'].map(unit=><option key={unit}>{unit}</option>)}</Select></label>
      <label className="space-y-2 text-sm">필요 일자<Input type="date" value={form.neededOn} onChange={event=>setForm({...form,neededOn:event.target.value})}/></label><label className="space-y-2 text-sm sm:col-span-2">요청 내용<Textarea rows={3} placeholder="용도와 전달할 내용을 적어 주세요" value={form.note} onChange={event=>setForm({...form,note:event.target.value})}/></label>
    </div><footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4"><p className="text-xs text-muted-foreground">실제 저장·발송 없이 화면에서만 확인합니다.</p><div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>취소</Button><Button type="submit" disabled={!form.name.trim()}>미리보기 추가</Button></div></footer></form>
  </dialog>
}
