import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DraftSheetRow } from '@/features/drafts/DraftSheetRow'
import { emptyDraftInput, newColorRow } from '@/lib/drafts/empty-draft'
import { newSampleWorkOrder } from '@/lib/drafts/sample-work-order'
import type { ProductDraft } from '@/lib/types'
import '@/index.css'

function Fixture() {
  const [readOnly,setReadOnly]=useState(false)
  const [phase,setPhase]=useState('review')
  const [writes,setWrites]=useState(0)
  const [opened,setOpened]=useState(0)
  const [draft,setDraft]=useState<ProductDraft>(()=>{
    const base=emptyDraftInput()
    return {...base,id:'fixture',createdBy:'owner',companyId:'fixture',draftNo:'PL-TEST',createdAt:'2026-10-01',updatedAt:'2026-10-01',promotedStyleId:null,nameKo:'회의용 기획안',nameEn:'Meeting sample',owner:'작성자',releaseIssue:'생산 일정 협의',
      imageUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="gray"/></svg>'),
      colors:[{...newColorRow(),id:'black',name:'블랙',orderQty:12},{...newColorRow(),id:'ivory',name:'아이보리',orderQty:8}],
      sampleWorkOrders:[{...newSampleWorkOrder(),id:'sample',url:'sample.pdf',passed:true}],
      specs:{...base.specs,nameConfirmed:true,colorsConfirmed:true,colorNamesConfirmed:true,colorSpecs:{black:{size:'300×120×210',fabric:'나일론',weight:'250g',specDoc:'공유 스펙 본문'},ivory:{size:'300×120×210',fabric:'면',weight:'240g',specDoc:'아이보리 스펙'}},colorSampleRounds:[{id:'round',round:1,url:'color.pdf',name:'컬러 지시서',shippedAt:'2026-10-14T00:00:00Z',returnedAt:'2026-10-15T00:00:00Z',passed:false}]}}
  })
  const shown={...draft,sampleWorkOrders:phase==='new'?[]:draft.sampleWorkOrders,specs:{...draft.specs,colorSampleRounds:phase==='review'?draft.specs.colorSampleRounds:[]}}
  const write=async()=>{setWrites(n=>n+1)}
  return <main className="p-6"><button onClick={()=>setReadOnly(v=>!v)}>{readOnly?'작성자로 전환':'다른 직원으로 전환'}</button><select aria-label="검증 단계" value={phase} onChange={event=>setPhase(event.target.value)}><option value="review">샘플 검토</option><option value="new">최초 지시서</option><option value="color-upload">컬러 지시서</option></select><output data-testid="writes">{writes}</output><output data-testid="opened">{opened}</output>
    <div className="draft-board-scroll"><table className="draft-sheet"><thead><tr>{['BRAND','IMAGE','PRICE','COLOR','INFORMATION','MD TEAM'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody><DraftSheetRow draft={shown} readOnly={readOnly} brand={undefined} schedule={{group:{id:'group',brandId:'fixture-brand',name:'11월 출시',releaseTiming:''},targetDate:'2026-11-03',certainty:'confirmed',brandId:null,isPreview:false}}
      onOpen={()=>setOpened(n=>n+1)} onSchedule={()=>{void write()}} onAddColor={write} onRenameProduct={async(field,name)=>{await write();setDraft(d=>({...d,[field]:name}))}} onRenameColor={write} onSaveSheetValue={write} onUploadSampleWorkOrder={write} onPassSample={write} onRequestNextSampleRound={write} onUploadColorWorkOrder={write} onPassColorSample={write} onRequestNextColorSampleRound={write} onToggleConfirm={write}/></tbody></table></div></main>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
