import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { DraftSheetRow } from '@/features/drafts/DraftSheetRow'
import { DraftSheetColumns } from '@/features/drafts/DraftSheetColumns'
import { DraftMdOptionsProvider } from '@/features/drafts/DraftMdTeamCell'
import { useDraftTeamWork } from '@/features/drafts/use-draft-team-work'
import { draftVisualBoardKey, useDraftVisualBoard } from '@/features/drafts/use-draft-visual-board'
import { resolveReleaseSchedule } from '@/features/drafts/release-schedule-preview'
import { emptyDraftInput, newColorRow } from '@/lib/drafts/empty-draft'
import { normalizeColorSpecs, writeColorSpec, type SaveColorSpec } from '@/lib/drafts/color-spec'
import { newSampleWorkOrder } from '@/lib/drafts/sample-work-order'
import type { Brand, ProductDraft } from '@/lib/types'
import type { DraftPriceRequest } from '@/lib/supabase/draft-price-requests'
import type { DraftInformationTemporary, DraftInformationTemporaryStore } from '@/lib/supabase/draft-information-temporary'
import { saveDraftColors, saveDraftReleaseFolder, type DraftColorEdit } from '@/lib/supabase/product-drafts'
import '@/index.css'

const temporaryKey = 'atelier-fixture-information-temporary'
const withoutProposer = window.location.hash === '#without-proposer'
const savedRelease = window.location.hash === '#saved-release'
const brand: Brand = {
  id: 'fixture-brand', slug: 'mas', name: 'MAS', nameKo: '마스', description: '',
  color: '#b21c29', styleCount: 0, foundedYear: 2026, createdAt: '', updatedAt: '',
}
const releaseFolders = [
  { id: 'group', name: '11월 출시', releaseTiming: '' },
  { id: 'group-dec', name: '12월 출시', releaseTiming: '' },
]
const releaseSeasonMap = new Map(releaseFolders.map(folder => [folder.id, {
  ...folder, code: folder.id, brandId: brand.id, year: 2026, status: 'active' as const,
}]))
function temporaryRows(): DraftInformationTemporary[] {
  return JSON.parse(sessionStorage.getItem(temporaryKey) ?? '[]')
}

function clearTemporary(revision: string | undefined) {
  if (revision) sessionStorage.setItem(temporaryKey, JSON.stringify(temporaryRows().filter(row => row.revision !== revision)))
}

const temporaryStore: DraftInformationTemporaryStore = {
  async list() { return temporaryRows() },
  async save(_draftId, _editorId, copy) {
    const rows = temporaryRows().filter(row => row.field !== copy.field || row.color_id !== copy.color_id)
    sessionStorage.setItem(temporaryKey, JSON.stringify([...rows, copy]))
  },
}

function Fixture() {
  const cache = useQueryClient()
  const [priceRequest, setPriceRequest] = useState<DraftPriceRequest>()
  const [previousPriceReply, setPreviousPriceReply] = useState<DraftPriceRequest>()
  const [readOnly,setReadOnly]=useState(false)
  const [phase,setPhase]=useState('review')
  const [writes,setWrites]=useState(0)
  const [savedSpec,setSavedSpec]=useState('')
  const [opened,setOpened]=useState(0)
  const [draft,setDraft]=useState<ProductDraft>(()=>{
    const base=emptyDraftInput()
    return {...base,id:'fixture',createdBy:'owner',companyId:'fixture',brandId:brand.id,draftNo:'PL-TEST',createdAt:'2026-10-01',updatedAt:'2026-10-01',promotedStyleId:null,nameKo:'회의용 기획안',nameEn:'Meeting sample',owner:'작성자',releaseIssue:'생산 일정 협의',seasonId:savedRelease?'group':null,
      imageUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="gray"/></svg>'),
      colors:[{...newColorRow(),id:'black',name:'블랙',orderQty:12},{...newColorRow(),id:'ivory',name:'아이보리',orderQty:8}],
      sampleWorkOrders:[{...newSampleWorkOrder(),id:'sample',url:'sample.pdf',shippedAt:'2026-10-01T00:00:00Z',receivedAt:'2026-10-02T00:00:00Z',passed:false}],
      specs:{...base.specs,nameConfirmed:true,colorsConfirmed:true,colorNamesConfirmed:true,proposer:withoutProposer?undefined:{id:'proposer',name:'제안 직원'},
        releaseSchedule:savedRelease?{seasonId:'group',targetDate:'2026-11-27',certainty:'confirmed'}:undefined,
        coating:{...base.specs.coating,value:'기존 공통 코팅',note:'상품 공통 스펙 본문'},
        colorImageChoices:{black:'Image',ivory:'None'},
        colorPhotoUrls:{black:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="black"/></svg>')},
        colorSpecs:normalizeColorSpecs({
        black:{size:'300×120×210',fabric:'나일론',weight:'250g',specDoc:'공유 스펙 본문'},
        ivory:{size:'310×130×200',sizeNote:'아이보리 별도 메모',fabric:'면',weight:'240g',specDoc:'아이보리 스펙'},
      }),colorSampleRounds:[{id:'round',round:1,url:'color.pdf',name:'컬러 지시서',shippedAt:'2026-10-14T00:00:00Z',returnedAt:'2026-10-15T00:00:00Z',passed:false}]}}
  })
  const shown={...draft,sampleWorkOrders:phase==='new'?[]:draft.sampleWorkOrders,specs:{...draft.specs,colorSampleRounds:phase==='review'?draft.specs.colorSampleRounds:[]}}
  const teamWork=useDraftTeamWork(readOnly?'fixture-viewer':'fixture-owner',[draft])
  const visualBoard=useDraftVisualBoard('fixture-owner',[draft])
  const write=async()=>{setWrites(n=>n+1)}
  const saveColors = async (rows: DraftColorEdit[], revision: string) => {
    setDraft(await saveDraftColors(draft, rows, revision))
    await Promise.all([
      cache.invalidateQueries({ queryKey: draftVisualBoardKey('fixture-owner') }),
      cache.invalidateQueries({ queryKey: ['draft-visual-content', 'fixture-owner', draft.id] }),
    ])
    await write()
  }
  const saveDocument = async (note: string, revision?: string) => {
    setDraft(current => ({ ...current, specs: { ...current.specs, specDocumentConfirmed: true, coating: { ...current.specs.coating, note } } }))
    clearTemporary(revision)
    await write()
  }
  const saveSpec: SaveColorSpec = async (colorId, changes, applyAll, field, revision) => {
    setSavedSpec(JSON.stringify([colorId, changes, applyAll]))
    setDraft(current => {
      const specs = writeColorSpec(current.specs, applyAll ? current.colors.map(color => color.id) : [colorId], changes, field, !applyAll)
      return { ...current, specs: { ...specs, colorSpecs: normalizeColorSpecs(specs.colorSpecs) } }
    })
    clearTemporary(revision)
    await write()
  }
  return <main className="p-6"><button onClick={()=>setReadOnly(v=>!v)}>{readOnly?'작성자로 전환':'다른 직원으로 전환'}</button><select aria-label="검증 단계" value={phase} onChange={event=>setPhase(event.target.value)}><option value="review">샘플 검토</option><option value="new">최초 지시서</option><option value="color-upload">컬러 지시서</option></select><output data-testid="writes">{writes}</output><output data-testid="opened">{opened}</output>
    <output data-testid="saved-spec">{savedSpec}</output>
    <button type="button" onClick={() => setPriceRequest(current => current && {
      ...current, answeredAt: current.round === 1 ? '2026-11-02T10:00:00Z' : '2026-11-02T15:00:30Z',
      amounts: { ivory: 0, black: 14 + current.round },
    })}>단가 회신 반영</button>
    <div className="draft-board-scroll"><table className="draft-board-table"><DraftSheetColumns /><DraftMdOptionsProvider><tbody><DraftSheetRow draft={shown} readOnly={readOnly} brand={brand} schedule={savedRelease?resolveReleaseSchedule(shown,releaseSeasonMap,[],{}):{group:{id:'group',brandId:'fixture-brand',name:'11월 출시',releaseTiming:''},targetDate:'2026-11-03',certainty:'confirmed',brandId:null,isPreview:false}}
      releaseFolders={releaseFolders} onChangeReleaseFolder={async seasonId => { setDraft(await saveDraftReleaseFolder(draft, seasonId)) }}
      informationEditorId="fixture-owner" informationTemporaryStore={temporaryStore} teamWork={teamWork.forDraft(draft.id)} visualBoard={visualBoard.forDraft(draft.id)}
      onSharedPhotoChange={async saved => {
        if (!saved) return
        setDraft(current => ({ ...current, specs: { ...current.specs,
          colorImageChoices: { ...current.specs.colorImageChoices, [saved.colorId]: 'Image' },
          colorPhotoUrls: { ...current.specs.colorPhotoUrls, [saved.colorId]: saved.photo },
        } }))
      }}
      price={{
        latest: priceRequest, reply: priceRequest?.answeredAt ? priceRequest : previousPriceReply,
        loading: false, error: '', retry: () => {},
        request: async () => {
          if (priceRequest?.answeredAt) setPreviousPriceReply(priceRequest)
          const round = (priceRequest?.round ?? 0) + 1
          setPriceRequest({
            id: `fixture-price-${round}`, draftId: draft.id, draftNo: draft.draftNo, round,
            requestedAt: round === 1 ? '2026-10-29T07:46:00Z' : '2026-11-02T14:46:00Z',
            answeredAt: null, amounts: null, colors: [
              { id: 'black', name: '블랙', hasPhoto: true }, { id: 'ivory', name: '아이보리', hasPhoto: false },
            ],
          })
        },
        confirm: async reply => setDraft(current => ({
          ...current, specs: { ...current.specs, confirmedPriceRequestId: reply.id },
        })),
      }}
      onOpen={()=>setOpened(n=>n+1)} onSchedule={()=>{void write()}} onSaveColors={saveColors} onRenameProduct={async(field,name)=>{await write();setDraft(d=>({...d,[field]:name}))}} onRenameColor={write} onSaveSheetValue={saveSpec} onSaveSpecDocument={saveDocument} onUploadSampleWorkOrder={write} onReceiveSample={write} onRequestNextSampleRound={write} onUploadColorWorkOrder={write} onReceiveColorSample={write} onSetColorSampleDone={write} onToggleConfirm={write}/></tbody></DraftMdOptionsProvider></table></div></main>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><Fixture /></QueryClientProvider>)
