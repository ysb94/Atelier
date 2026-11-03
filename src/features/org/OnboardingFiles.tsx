import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { downloadOnboardingFile, removeOnboardingFile, uploadOnboardingFile, type OnboardingRecord } from '@/lib/supabase/employee-onboarding'

export function OnboardingFiles({ record, kinds, canUpload = true, onChange }: { record: OnboardingRecord; kinds: readonly (readonly [string,string])[]; canUpload?: boolean; onChange: (record: OnboardingRecord)=>void }) {
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  async function run(action: ()=>Promise<void>) { setError('');setBusy(true);try { await action() } catch (caught) { setError(caught instanceof Error?caught.message:'첨부 처리에 실패했습니다.') } finally {setBusy(false)} }
  return <div className="space-y-3">{error?<p role="alert" className="text-sm text-danger">{error}</p>:null}{kinds.map(([kind,label])=>{
    const file=record.files.find(f=>f.kind===kind)
    return <div key={kind} className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{label}</span>{file?<span className="flex min-w-0 flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void run(async()=>downloadOnboardingFile(file))}>다운로드</Button>{canUpload&&!record.completedAt?<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>void run(async()=>onChange(await removeOnboardingFile(file.id)))}>첨부 해제</Button>:null}</span>:<span className="text-xs text-muted-foreground">미등록</span>}</div>{file?<p className="mt-2 break-all text-xs text-muted-foreground">{file.name}</p>:null}{canUpload&&!record.completedAt?<label className="mt-2 block"><span className="sr-only">{label} 업로드</span><Input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} className="h-auto py-2" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void run(async()=>onChange(await uploadOnboardingFile(record,kind,file)))}}/></label>:null}</div>
  })}{busy?<p role="status" className="text-sm text-muted-foreground">파일 처리 중… 완료될 때까지 기다려 주세요.</p>:null}</div>
}
