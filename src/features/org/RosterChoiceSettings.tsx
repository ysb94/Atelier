import { useRosterChoiceSettings } from './use-roster-choice-settings'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useRenderWatch } from '@/lib/diagnostics'
import { ROSTER_CHOICE_FIELDS, validateRosterChoices, type RosterChoiceKey } from '@/lib/company/roster-choices'
import { saveRosterChoiceSetting, type RosterChoiceSetting } from '@/lib/supabase/roster-choices'

export function RosterChoiceSettings({canEdit}:{canEdit:boolean}) {
  useRenderWatch('RosterChoiceSettings')
  const query=useRosterChoiceSettings()
  return <section className="space-y-4" aria-label="직원 배치 선택 목록 설정">
    <div><h3 className="text-base font-semibold">직원 배치 선택 목록</h3><p className="mt-1 text-sm text-muted-foreground">직원 배치에 입력된 값을 기준으로 만든 목록입니다. 직책·직급처럼 항목을 추가·수정·삭제할 수 있습니다. 목록 변경은 직원에게 저장된 값을 자동으로 바꾸지 않습니다.</p></div>
    {query.isError?<p role="alert" className="text-sm text-danger">{query.error.message}<Button size="sm" variant="outline" onClick={()=>void query.refetch()}>다시 불러오기</Button></p>:query.data&&!query.data.ready?<p role="status" className="text-sm text-warning">선택 목록 저장소 연결 대기입니다. DB 설정 적용 후 저장할 수 있으며, 직원 배치의 기존 입력 기능은 유지됩니다.</p>:null}
    <div className="grid items-start gap-4 lg:grid-cols-2">{ROSTER_CHOICE_FIELDS.map(field=><ChoiceEditor key={field.key} field={{...field,label:query.data?.settings.find(row=>row.key===field.key)?.label??field.label}} setting={query.data?.settings.find(row=>row.key===field.key)} disabled={!canEdit||query.isPending||query.isError||!query.data?.ready}/>)}</div>
  </section>
}
type ChoiceAction={options:string[];revision:number;kind:'add'|'rename'|'delete'|'move'}
function ChoiceEditor({field,setting,disabled}:{field:{key:RosterChoiceKey;label:string;max:number};setting?:RosterChoiceSetting;disabled:boolean}) {
  const cache=useQueryClient()
  const [draft,setDraft]=useState('')
  const [edit,setEdit]=useState<{original:string;draft:string;revision:number;options:string[]}|null>(null)
  const [error,setError]=useState<string|null>(null)
  const options=setting?.options??[]
  const revision=setting?.revision??0
  const rows=edit?.options??options
  const changedElsewhere=Boolean(edit&&edit.revision!==revision)
  const mutation=useMutation({
    mutationFn:(action:ChoiceAction)=>saveRosterChoiceSetting(field.key,action.options,action.revision),
    onSuccess:async(_,action)=>{if(action.kind==='add')setDraft('');setEdit(null);setError(null);await cache.invalidateQueries({queryKey:['employee-roster-choice-settings']})},
    onError:async failure=>{setError(failure.message);await cache.invalidateQueries({queryKey:['employee-roster-choice-settings']})},
  })
  const busy=disabled||mutation.isPending
  function save(next:string[],kind:ChoiceAction['kind'],expected=revision){
    const message=validateRosterChoices(field.key,next)
    if(message){setError(message);return}
    if(!busy){setError(null);mutation.mutate({options:next,revision:expected,kind})}
  }
  function move(index:number,by:number){const next=[...options];[next[index],next[index+by]]=[next[index+by],next[index]];save(next,'move')}
  return <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
    <h2 className="flex items-center gap-2 text-base font-semibold">{field.label}<span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{rows.length}개</span></h2>
    <p className="mt-1 text-xs text-muted-foreground">직원 배치에서 선택할 항목입니다. 삭제해도 기존 직원 값은 보존됩니다.</p>
    {rows.length===0?<p className="mt-3 text-sm text-muted-foreground">등록된 {field.label} 항목이 없습니다.</p>:<ul className="mt-4 divide-y divide-border/60 border-y border-border/60">{rows.map((value,index)=><li key={value} className="flex items-center gap-2 py-2.5">
      {edit?.original===value?<><Input aria-label={`${value} 이름`} value={edit.draft} maxLength={field.max} disabled={busy} onChange={event=>setEdit({...edit,draft:event.target.value})}/><Button type="button" size="sm" disabled={busy||!edit.draft.trim()||changedElsewhere} onClick={()=>save(edit.options.map(item=>item===edit.original?edit.draft.trim():item),'rename',edit.revision)}>저장</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>{setEdit(null);setError(null)}}>취소</Button></>:<><span className="min-w-0 flex-1 text-sm">{value}</span>{!disabled&&<><Button type="button" size="icon" variant="ghost" aria-label={`${value} 위로`} disabled={busy||Boolean(edit)||index===0} onClick={()=>move(index,-1)}><ChevronUp className="size-4"/></Button><Button type="button" size="icon" variant="ghost" aria-label={`${value} 아래로`} disabled={busy||Boolean(edit)||index===rows.length-1} onClick={()=>move(index,1)}><ChevronDown className="size-4"/></Button><Button type="button" size="sm" variant="outline" disabled={busy||Boolean(edit)} onClick={()=>{setEdit({original:value,draft:value,revision,options:[...options]});setError(null)}}>수정</Button><Button type="button" size="sm" variant="ghost" disabled={busy||Boolean(edit)} onClick={()=>save(options.filter(item=>item!==value),'delete')}>삭제</Button></>}</>}
    </li>)}</ul>}
    {!disabled&&<form className="mt-4 flex gap-2" onSubmit={event=>{event.preventDefault();if(draft.trim())save([...options,draft.trim()],'add')}}><Input aria-label={`${field.label} 추가`} placeholder={`${field.label} 추가`} value={draft} maxLength={field.max} disabled={busy||Boolean(edit)} onChange={event=>setDraft(event.target.value)}/><Button type="submit" size="sm" disabled={busy||Boolean(edit)||!draft.trim()}>추가</Button></form>}
    {changedElsewhere&&<p role="status" className="mt-3 text-sm text-warning">목록이 변경됐습니다. 입력 중인 내용은 보존했습니다. 취소 후 최신 목록을 확인해 주세요.</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </article>
}
