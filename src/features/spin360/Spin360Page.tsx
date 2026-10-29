import { useCallback, useEffect, useRef, useState } from 'react'
import { SpinModelViewer } from './SpinModelViewer'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useRenderWatch } from '@/lib/diagnostics'
import { fetchServerFiles } from '@/features/design/file-manager/file-manager-api'
import { buildPublicUrl } from '@/features/design/file-manager/file-manager-utils'

const LOCAL='http://127.0.0.1:4320'
const DIRECTIONS=['앞','오른쪽','뒤','왼쪽']
type Result={id:string;title:string;createdAt:string;status?:string;progress?:number;credits?:number;frameCount?:number;prefix?:string;cloud?:unknown;message?:string}
const fileData=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('사진을 읽지 못했습니다.'));reader.readAsDataURL(file)})
async function local<T>(route:string,body?:unknown):Promise<T>{const response=await fetch(LOCAL+route,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'로컬 제작 서버 요청 실패');return data}

export function Spin360Page(){
 useRenderWatch('Spin360Page')
 const active=useWorkspaceTabActivity()
 const [title,setTitle]=useState(''),[photos,setPhotos]=useState<(File|null)[]>([null,null,null,null]),[previews,setPreviews]=useState<string[]>(['','','',''])
 const [jobs,setJobs]=useState<Result[]>([]),[saved,setSaved]=useState<Result[]>([]),[selected,setSelected]=useState<Result|null>(null)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[localNotice,setLocalNotice]=useState(''),[cloudError,setCloudError]=useState(''),[loading,setLoading]=useState(true)
 const requestId=useRef(crypto.randomUUID()),lock=useRef(false),alive=useRef(true),urls=useRef<string[]>([])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;urls.current.forEach(url=>URL.revokeObjectURL(url))}},[])
 const refresh=useCallback(async()=>{
  const results=await Promise.allSettled([
   import.meta.env.DEV?local<Result[]>('/jobs'):Promise.resolve([]),
   fetchServerFiles('spin360','atelier').then(async items=>{
    const records=items.map(item=>item.key||`spin360/${item.name||''}`).filter(key=>/^spin360\/tripo\/[a-z0-9-]{8,64}\/manifest\.json$/.test(key))
    return (await Promise.all(records.map(async key=>{const response=await fetch(buildPublicUrl(key));if(!response.ok)throw Error('저장 결과 정보 조회 실패');const row=await response.json();const prefix=key.slice(0,-14);if(row.version!==1||row.frameCount!==70||row.prefix!==prefix)throw Error('저장 결과 형식 확인 실패');return row as Result}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
   })
  ])
  if(!alive.current)return
  const [localResult,cloudResult]=results
  if(localResult.status==='fulfilled'){setJobs(localResult.value.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));setLocalNotice('')}else{console.warn('[spin360] 로컬 제작 서버 조회 실패',localResult.reason);setLocalNotice('로컬 제작 서버가 연결되지 않았습니다. 저장된 사이트 결과는 계속 볼 수 있습니다.')}
  if(cloudResult.status==='fulfilled'){setSaved(cloudResult.value);setCloudError('')}else{console.warn('[spin360] 저장 결과 조회 실패',cloudResult.reason);setCloudError('사이트 저장 결과를 불러오지 못했습니다. 다시 조회해 주세요.')}
  setLoading(false)
 },[])
 useEffect(()=>{void refresh()},[refresh])
 useEffect(()=>{if(!active||!jobs.some(job=>['queued','running','submitting','reserved'].includes(job.status??'')))return;const timer=window.setTimeout(()=>void refresh(),5000);return()=>clearTimeout(timer)},[jobs,refresh,active])
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.origin!==LOCAL||event.data?.type!=='tripo-saved')return;void refresh()};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[refresh])
 function choose(index:number,file?:File){if(!file||lock.current)return;setError('');if(!['image/jpeg','image/png'].includes(file.type)||file.size>8*1024*1024){setError('사진은 각 8MB 이하의 JPG·PNG를 선택하세요.');return}if(urls.current[index])URL.revokeObjectURL(urls.current[index]);const url=URL.createObjectURL(file);urls.current[index]=url;setPhotos(previous=>previous.map((p,i)=>i===index?file:p));setPreviews(previous=>previous.map((p,i)=>i===index?url:p));requestId.current=crypto.randomUUID()}
 async function create(){if(lock.current||!title.trim()||!photos.every(Boolean))return;lock.current=true;setBusy(true);setError('');try{const result=await local<Result>('/jobs',{id:requestId.current,title:title.trim(),photos:await Promise.all(photos.map(file=>fileData(file!)))});if(alive.current){setSelected(result);await refresh()}}catch(e){console.warn('[spin360] 제작 접수 실패',e);if(alive.current)setError(e instanceof Error?e.message:'제작 접수 실패. 같은 접수 ID로 재조회하며 자동 재생성하지 않습니다.')}finally{lock.current=false;if(alive.current)setBusy(false)}}
 async function save(job:Result){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await local(`/job/${job.id}/publish`,{});await refresh()}catch(e){console.warn('[spin360] 사이트 저장 실패',e);if(alive.current)setError(e instanceof Error?e.message:'저장 실패')}finally{lock.current=false;if(alive.current)setBusy(false)}}
 const current=selected?.prefix?selected:jobs.find(j=>j.id===selected?.id)??selected
 return <div className="space-y-5">
  <PageHeader title="360 상세이미지 생성" description="Tripo · 사진 네 장으로 3D 모델을 만들고 70방향 결과를 사이트 파일 저장소에 보관합니다." />
  {error&&<p role="alert" className="text-danger">{error}</p>}
  {import.meta.env.DEV&&<Card className="space-y-4 p-4 sm:p-5"><h2 className="font-semibold">새 3D 제작</h2><label className="block space-y-1 text-sm">제품 이름<Input aria-label="제품 이름" maxLength={100} value={title} disabled={busy} onChange={e=>{setTitle(e.target.value);requestId.current=crypto.randomUUID()}} /></label><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{DIRECTIONS.map((name,i)=><label key={name} className="min-w-0 space-y-2 rounded-lg border border-border p-3"><span className="text-sm font-medium">{name} 원본</span>{previews[i]&&<img src={previews[i]} alt={`${name} 원본`} className="aspect-square w-full object-contain" />}<Input aria-label={`${name} 사진`} type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e=>{choose(i,e.target.files?.[0]);e.target.value=''}} /></label>)}</div><p className="text-sm text-muted-foreground">기본 3D·텍스처 옵션 · 1회 30크레딧($0.30). 생성 완료 후 아래 결과를 열면 70방향 추출과 사이트 저장을 진행합니다. 원본·모델·이미지·뷰어·ZIP은 기존 이미지 업로드 저장소에 보관됩니다.</p><Button className="h-auto max-w-full whitespace-normal py-2" disabled={busy||!title.trim()||!photos.every(Boolean)||!!localNotice} onClick={()=>void create()}>{busy?'처리 중…':'3D 모델 제작 · 30크레딧 사용'}</Button>{localNotice&&<p className="text-sm text-warning">{localNotice}</p>}</Card>}
  <Card className="space-y-3 p-4 sm:p-5"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">사이트에 저장된 결과</h2><Button size="sm" variant="outline" onClick={()=>void refresh()}>다시 조회</Button></div>{cloudError&&<p role="alert" className="text-danger">{cloudError}</p>}{loading?<p>불러오는 중…</p>:saved.length===0&&!cloudError?<p className="text-sm text-muted-foreground">아직 사이트에 저장한 결과가 없습니다.</p>:null}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{saved.map(result=><article key={result.id} className="space-y-2 rounded-lg border border-border p-3"><img src={buildPublicUrl(result.prefix+'/frames/000.png')} alt={result.title} className="aspect-square w-full object-contain"/><b className="block break-words">{result.title}</b><p className="text-xs text-muted-foreground">3D 모델 · 70장 포함 · {new Date(result.createdAt).toLocaleDateString('ko-KR')}</p><Button size="sm" onClick={()=>setSelected(result)}>결과 보기</Button><div className="flex flex-wrap gap-3 text-sm"><a className="underline" href={buildPublicUrl(result.prefix+'/result.zip')} download>ZIP 다운로드</a><a className="underline" href={buildPublicUrl(result.prefix+'/model.glb')} download>3D 원본 GLB 다운로드</a></div></article>)}</div></Card>
  {import.meta.env.DEV&&jobs.some(job=>!job.cloud)&&<Card className="space-y-3 p-4"><h2 className="font-semibold">이 PC의 제작·저장 대기</h2>{jobs.filter(job=>!job.cloud).map(job=><div key={job.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"><b>{job.title}</b><span className="text-sm">{job.status==='success'?'제작 완료':job.status==='error'?'연결 확인 필요':`${job.progress??0}% · ${job.status}`}</span><Button size="sm" variant="outline" onClick={()=>setSelected(job)}>결과·상태 보기</Button>{job.status==='success'&&job.frameCount===70&&<Button size="sm" disabled={busy} onClick={()=>void save(job)}>사이트에 저장</Button>}{job.status==='error'&&<Button size="sm" variant="outline" onClick={()=>{void local(`/job/${job.id}/resume`,{}).then(()=>refresh()).catch(e=>setError(e.message))}}>기존 작업만 조회</Button>}</div>)}</Card>}
  <p className="text-sm text-muted-foreground">저장된 3D 모델은 사이트 파일 저장소에 보관됩니다. 이미지 업로드의 spin360 → tripo 폴더에서 model.glb를 확인하거나 내려받아 보관할 수 있습니다.</p>
  {current&&<Card className="space-y-3 p-4"><h2 className="font-semibold">{current.title}</h2>{current.prefix?<SpinModelViewer key={current.id} title={current.title} src={buildPublicUrl(current.prefix+'/model.glb')} />:current.status==='success'?<iframe key={current.id} title="3D 모델 · 70방향 추출과 저장" className="h-[min(90vh,1000px)] w-full border-0" src={`${LOCAL}/?job=${current.id}&auto=1`} />:<p role="status">{current.message||`3D 생성 중 · ${current.progress??0}%`}</p>}</Card>}
 </div>
}
