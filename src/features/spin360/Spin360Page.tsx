import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { SpinModelViewer } from './SpinModelViewer'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useRenderWatch } from '@/lib/diagnostics'

const LOCAL='http://127.0.0.1:4320'
const DIRECTIONS=['앞','오른쪽','뒤','왼쪽']
type Result={id:string;title:string;createdAt:string;status?:string;progress?:number;message?:string}
const fileData=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('사진을 읽지 못했습니다.'));reader.readAsDataURL(file)})
async function local<T>(route:string,body?:unknown):Promise<T>{const response=await fetch(LOCAL+route,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'로컬 제작 서버 요청 실패');return data}

export function Spin360Page(){
 useRenderWatch('Spin360Page')
 const active=useWorkspaceTabActivity()
 const [title,setTitle]=useState(''),[photos,setPhotos]=useState<(File|null)[]>([null,null,null,null]),[previews,setPreviews]=useState<string[]>(['','','',''])
 const [jobs,setJobs]=useState<Result[]>([]),[selected,setSelected]=useState<Result|null>(null)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[localNotice,setLocalNotice]=useState(''),[loading,setLoading]=useState(true)
 const requestId=useRef(crypto.randomUUID()),lock=useRef(false),alive=useRef(true),urls=useRef<string[]>([])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;urls.current.forEach(url=>URL.revokeObjectURL(url))}},[])
 const refresh=useCallback(async()=>{
  try {
   const results=import.meta.env.DEV?await local<Result[]>('/jobs'):[]
   if(alive.current){setJobs(results.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));setLocalNotice('')}
  } catch(reason) {
   console.warn('[spin360] 로컬 제작 결과 조회 실패',reason)
   if(alive.current)setLocalNotice('이 PC의 제작 서버에 연결하지 못했습니다. 개발 서버를 확인하고 다시 조회해 주세요.')
  } finally {if(alive.current)setLoading(false)}
 },[])
 useEffect(()=>{void refresh()},[refresh])
 useEffect(()=>{if(!active||!jobs.some(job=>['queued','running','submitting','reserved'].includes(job.status??'')))return;const timer=window.setTimeout(()=>void refresh(),5000);return()=>clearTimeout(timer)},[jobs,refresh,active])
 function choose(index:number,file?:File){if(!file||lock.current)return;setError('');if(!['image/jpeg','image/png'].includes(file.type)||file.size>8*1024*1024){setError('사진은 각 8MB 이하의 JPG·PNG를 선택하세요.');return}if(urls.current[index])URL.revokeObjectURL(urls.current[index]);const url=URL.createObjectURL(file);urls.current[index]=url;setPhotos(previous=>previous.map((p,i)=>i===index?file:p));setPreviews(previous=>previous.map((p,i)=>i===index?url:p));requestId.current=crypto.randomUUID()}
 async function create(){if(lock.current||!title.trim()||!photos.every(Boolean))return;lock.current=true;setBusy(true);setError('');try{const result=await local<Result>('/jobs',{id:requestId.current,title:title.trim(),photos:await Promise.all(photos.map(file=>fileData(file!)))});if(alive.current){setSelected(result);await refresh()}}catch(e){console.warn('[spin360] 제작 접수 실패',e);if(alive.current)setError(e instanceof Error?e.message:'제작 접수 실패. 같은 접수 ID로 재조회하며 자동 재생성하지 않습니다.')}finally{lock.current=false;if(alive.current)setBusy(false)}}
 const current=jobs.find(j=>j.id===selected?.id)??selected
 return <div className="space-y-5">
  <PageHeader title="360 상세이미지 생성" description="Tripo · 사진 네 장으로 3D 모델을 만들고, 필요한 결과만 GLB 파일로 내려받으세요." />
  {error&&<p role="alert" className="text-danger">{error}</p>}
  {import.meta.env.DEV&&<Card className="space-y-4 p-4 sm:p-5"><h2 className="font-semibold">새 3D 제작</h2><label className="block space-y-1 text-sm">제품 이름<Input aria-label="제품 이름" maxLength={100} value={title} disabled={busy} onChange={e=>{setTitle(e.target.value);requestId.current=crypto.randomUUID()}} /></label><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{DIRECTIONS.map((name,i)=><label key={name} className="min-w-0 space-y-2 rounded-lg border border-border p-3"><span className="text-sm font-medium">{name} 원본</span>{previews[i]&&<img src={previews[i]} alt={`${name} 원본`} className="aspect-square w-full object-contain" />}<Input aria-label={`${name} 사진`} type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e=>{choose(i,e.target.files?.[0]);e.target.value=''}} /></label>)}</div><p className="text-sm text-muted-foreground">기본 3D·텍스처 옵션 · 1회 30크레딧($0.30). 결과는 이 PC에 보관됩니다. 이미지 업로드 저장소에는 자동으로 올리지 않습니다. 필요한 모델만 내려받아 직접 업로드하세요.</p><Button className="h-auto max-w-full whitespace-normal py-2" disabled={busy||!title.trim()||!photos.every(Boolean)||!!localNotice} onClick={()=>void create()}>{busy?'처리 중…':'3D 모델 제작 · 30크레딧 사용'}</Button>{localNotice&&<p className="text-sm text-warning">{localNotice}</p>}</Card>}
  <Card className="space-y-3 p-4 sm:p-5">
   <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">이 PC의 제작 결과</h2><Button size="sm" variant="outline" onClick={()=>void refresh()}>다시 조회</Button></div>
   {!import.meta.env.DEV&&<p className="text-sm text-muted-foreground">제작과 결과 다운로드는 로컬 개발 화면에서 이용하세요.</p>}
   {loading?<p>불러오는 중…</p>:jobs.length===0&&!localNotice?<p className="text-sm text-muted-foreground">아직 이 PC에서 제작한 결과가 없습니다.</p>:null}
   {jobs.map(job=><div key={job.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
    <b>{job.title}</b><span className="text-sm">{job.status==='success'?'제작 완료':job.status==='error'?'연결 확인 필요':`${job.progress??0}% · ${job.status}`}</span>
    <Button size="sm" variant="outline" onClick={()=>setSelected(job)}>결과 보기</Button>
    {job.status==='success'&&<a className="text-sm underline" href={`${LOCAL}/job/${job.id}/model.glb?download=1`} download="model.glb">model.glb 다운로드</a>}
    {job.status==='error'&&<Button size="sm" variant="outline" onClick={()=>{void local(`/job/${job.id}/resume`,{}).then(()=>refresh()).catch(e=>setError(e.message))}}>기존 작업만 조회</Button>}
   </div>)}
  </Card>
  {current&&<Card className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{current.title}</h2><Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label="결과 보기 닫기" onClick={() => setSelected(null)}><X className="size-4" /></Button></div>{current.status==='success'?<SpinModelViewer key={current.id} title={current.title} src={`${LOCAL}/job/${current.id}/model.glb`} />:<p role="status">{current.message||`3D 생성 중 · ${current.progress??0}%`}</p>}</Card>}
 </div>
}
