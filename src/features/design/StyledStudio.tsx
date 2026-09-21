import { runStudioBatch, type StudioBatch } from '../../lib/design/studio-batch'
import { StudioLibrary } from './StudioLibrary'
import { StudioPhotoInfo } from './StudioPhotoInfo'
import { addLibraryAssets, assetUsageMessage, attachAssetsToRequest, insertAtCaret, normalizeLibrary, photoLabel, photoNote, productDescription, removeLibraryAsset, selectedProducts, selectedPhotoNotes, missingPhotoMentions, REQUEST_ATTACH_LIMIT } from '../../lib/design/studio-library'
import { fitStudioRequestImages } from '../../lib/design/studio-image-processing'
import { StudioImagePreview } from './StudioImagePreview'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowUp, Check, ChevronRight, ImagePlus, Images, Layers3, Paperclip, Plus, Sparkles, X } from 'lucide-react'
import { OUTPUT_RATIOS, PRODUCT_PHOTO_SLOTS, type FormState } from '../../lib/design/styled-cuts'
import { loadStudio, newStudio, readStudioAsset, saveStudio, type StudioAsset, type StudioPreviewTurn, type StudioState, type StudioVersion } from '../../lib/design/styled-studio'
import { useRenderWatch } from '../../lib/diagnostics/render-watch'
import './styled-studio.css'
import { DEFAULT_DIRECTOR_MODEL_ID, DEFAULT_IMAGE_SETTINGS, directorModelLabel, imageModel, imageQualities, outputSize, preferredDirectorModelId, validateImageRequest, type ImageSettings, type DirectorPlan, STYLED_IMAGE_MODELS, type StyledDirectorAvailability, type StyledDirectorModelId, type StyledImageModelId, type StudioCatalog, type StudioImageApi, type StyledImageAvailability } from '../../../supabase/functions/_shared/styled-image-core'
import { buildStudioGenerationRequest, generationAssetIds } from '../../lib/design/studio-generation'
import { timeStudioWork } from '../../lib/design/studio-timing'
import { applyDirectorPlan } from '../../../supabase/functions/_shared/styled-director'
import { StudioGenerationProgress } from './StudioGenerationProgress'

const ACTIONS = {
  create: { title: '새로운 연출 만들기', tool: 'Nano Banana Pro', description: '제품 사진과 레퍼런스로 새로운 장면을 구성하는 작업', keep: '체크한 사진과 이번 요청을 기준으로 작업' },
  background: { title: '배경 바꾸기', tool: 'Photoroom', description: '선택한 컷의 제품 모습을 활용해 배경을 바꾸는 작업', keep: '제품 모습과 구도 유지 · 요청한 배경만 변경' },
  angle: { title: '다른 구도 만들기', tool: 'Nano Banana Pro', description: '원본 제품을 함께 참고해 다른 방향의 연출을 만드는 작업', keep: '제품 정체성과 현재 배경 유지 · 구도 변경' },
  detail: { title: '부분 수정하기', tool: 'Adobe Firefly', description: '선택한 컷에서 요청한 부분을 수정하는 작업', keep: '선택한 컷 기준 · 요청한 부분 외의 연출 유지' },
}
function conversation(state: StudioState) {
  return state.conversationUi ?? { sampleIds: [], roles: {}, turns: [] }
}
function productIds(state: StudioState) {
  return [...new Set([...Object.values(state.product), ...conversation(state).sampleIds])].filter((id): id is string => !!id && !!state.assets[id])
}
function referenceIds(state: StudioState) {
  return [...new Set(Object.values(state.references).flat())].filter((id) => !!state.assets[id])
}
function roleOf(state: StudioState, id: string) {
  if (conversation(state).roles[id]) return conversation(state).roles[id]
  const slot = PRODUCT_PHOTO_SLOTS.find((item) => state.product[item.key] === id)
  return slot ? slot.key === 'material' ? '원단 디테일' : slot.key === 'scale' ? '크기 비교' : slot.key === 'front' ? '제품 기준' : slot.label : '제품 사진'
}

export function StyledStudio({ api }: { api?: StudioImageApi }) {
  useRenderWatch('StyledStudio')
  const [state, setState] = useState<StudioState>(() => normalizeLibrary(newStudio()))
  const [ready, setReady] = useState(false)
  const [storageEnabled, setStorageEnabled] = useState(true)
  const [saveStatus, setSaveStatus] = useState('불러오는 중')
  const [request, setRequest] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [continueSelected, setContinueSelected] = useState(false)
  const [count, setCount] = useState(api ? '1' : '2')
  const [modelId, setModelId] = useState<StyledImageModelId>('gpt-image-2')
  const [directorModelId, setDirectorModelId] = useState<StyledDirectorModelId>(DEFAULT_DIRECTOR_MODEL_ID)
  const [availability, setAvailability] = useState<StyledImageAvailability[]>([])
  const [directors, setDirectors] = useState<StyledDirectorAvailability[]>([])
  const [modelStatus, setModelStatus] = useState('연결 확인 중…')
  const [checkingModels, setCheckingModels] = useState(false)
  const [progress, setProgress] = useState('')
  const [settings, setSettings] = useState<ImageSettings>(DEFAULT_IMAGE_SETTINGS)
  const [reviewFirst, setReviewFirst] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [infoId, setInfoId] = useState<string | null>(null)
  const [photoFilter, setPhotoFilter] = useState<'all' | 'attached'>('all')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [director, setDirector] = useState<{ key: string; plan: DirectorPlan; failure?: string } | null>(null)
  const [batches, setBatches] = useState<Record<string, StudioBatch>>({})
  const generationLock = useRef(false)
  const alive = useRef(true)
  const saveQueue = useRef(Promise.resolve())
  const saveSequence = useRef(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const latest = useRef<HTMLDivElement>(null)
  const libraryPanel = useRef<HTMLElement>(null)
  const caret = useRef(0)
  const dragDepth = useRef(0)

  useEffect(() => {
    alive.current = true
    let cancelled = false
    if (api) {
      setReady(true)
      setSaveStatus('시험 생성 · 결과 내려받기')
      return () => { alive.current = false }
    }
    loadStudio().then((saved) => { if (!cancelled && saved) setState(normalizeLibrary(saved)) }).catch((error) => {
      console.warn('[styled-studio] 작업 복원 실패', { path: location.pathname, error })
      if (!cancelled) { setStorageEnabled(false); setNotice('저장된 작업을 불러오지 못했습니다. 기존 저장 내용은 덮어쓰지 않습니다.'); setSaveStatus('자동 저장 중지') }
    }).finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true; alive.current = false }
  }, [api])
  useEffect(() => {
    if (api || !ready || !storageEnabled) return
    const sequence = ++saveSequence.current
    setSaveStatus('저장 중…')
    saveQueue.current = saveQueue.current.then(() => saveStudio(state)).then(() => {
      if (alive.current && sequence === saveSequence.current) setSaveStatus('이 브라우저에 저장됨')
    }).catch((error) => {
      console.warn('[styled-studio] 작업 저장 실패', { path: location.pathname, error })
      if (alive.current) { setSaveStatus('저장 실패'); setNotice('작업을 저장하지 못했습니다. 새로고침 전 사진과 결과를 따로 보관해 주세요.') }
    })
  }, [state, ready, storageEnabled, api])

  const applyCatalog = useCallback((catalog: StudioCatalog) => {
    const nextDirectors = catalog.directors ?? []
    setAvailability(catalog.models ?? [])
    setDirectors(nextDirectors)
    setModelStatus('모델 조회 완료')
    setDirectorModelId(current => nextDirectors.length && !nextDirectors.some(item => item.modelId === current) ? preferredDirectorModelId(nextDirectors.map(item => item.modelId)) : current)
  }, [])
  useEffect(() => {
    if (!api) return
    let cancelled = false
    setCheckingModels(true)
    api.models().then((catalog) => {
      if (!cancelled) applyCatalog(catalog)
    }).catch((error) => {
      console.warn('[styled-image] 모델 조회 실패', { path: location.pathname, error })
      if (!cancelled) { setAvailability([]); setDirectors([]); setModelStatus(error instanceof Error ? error.message : '모델 조회 실패') }
    }).finally(() => { if (!cancelled) setCheckingModels(false) })
    return () => { cancelled = true }
  }, [api, applyCatalog])

  useEffect(() => {
    if (!state.products || Object.values(state.assets).some(asset => !asset.photoNo)) setState(prev => normalizeLibrary(prev))
  }, [state.products, state.assets])
  useEffect(() => {
    if (!libraryOpen && !infoId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (infoId) setInfoId(null)
      else setLibraryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [libraryOpen, infoId])
  useEffect(() => {
    if (libraryOpen) libraryPanel.current?.focus()
  }, [libraryOpen])
  const ui = conversation(state)
  const generating = busy && !!progress
  const products = productIds(state)
  const references = referenceIds(state)
  const selected = state.versions.find((item) => item.id === state.selectedId)
  const comparisonIds = selected?.inputRoles
    ? selected.assetIds.filter((id) => !['편집 대상', '연출 레퍼런스', '요청 참고'].includes(selected.inputRoles![id]))
    : products
  const parent = continueSelected ? selected : undefined
  const selectionKey = parent?.id ?? 'new'
  const additionalImages = state.editInputs?.[selectionKey]
  const attachedIds = Object.keys(additionalImages ?? {})
  const editSelectionEmpty = !attachedIds.length
  const hasConversation = ui.turns.length > 0 || state.versions.length > 0
  const missingMentions = missingPhotoMentions(state, request, attachedIds)
  const directorKey = JSON.stringify([request.trim(), modelId, directorModelId, settings, state.form.outputRatio, parent?.id, Object.keys(additionalImages ?? {}).map(id => [id, state.assets[id]?.photoNo, photoNote(state.assets[id]), state.assets[id]?.productIds]), selectedProducts(state, Object.keys(additionalImages ?? {}))])
  const invalidNumbers = selectedProducts(state, Object.keys(additionalImages ?? {})).some(p => [p.width, p.height, p.depth].some(v => v.trim() && (!Number.isFinite(Number(v)) || Number(v) <= 0)))
  const imageModelLabel = STYLED_IMAGE_MODELS.find((model) => model.id === modelId)?.label ?? modelId
  const directorOptions = directors.some((item) => item.modelId === directorModelId)
    ? directors
    : [{ modelId: directorModelId, label: directorModelLabel(directorModelId), available: true, message: '' }, ...directors]
  const directorLabel = directorOptions.find((item) => item.modelId === directorModelId)?.label ?? directorModelLabel(directorModelId)
  const currentDirector = director?.key === directorKey ? director.plan : undefined
  const showWorkspace = hasConversation || !!currentDirector || generating
  const isGemini = modelId === 'gemini-3-pro-image'
  function field<K extends keyof FormState>(key: K, value: FormState[K]) { setState((prev) => ({ ...prev, form: { ...prev.form, [key]: value } })) }
  async function upload(files: FileList | File[] | null, target: 'product' | 'reference' | 'result' | 'edit', versionId?: string, attach = false) {
    const picked = files ? Array.from(files) : []
    if (!picked.length) return
    setBusy(true); setNotice('큰 이미지는 고화질로 자동 최적화하고 있습니다…')
    const problems: string[] = []
    try {
      const assets: StudioAsset[] = []
      const list = target === 'product' || target === 'edit' ? picked : picked.slice(0, 1)
      for (const file of list) {
        try { assets.push(await readStudioAsset(file)) }
        catch (error) {
          console.warn('[styled-studio] 사진 등록 실패', { path: location.pathname, target, name: file.name, error })
          problems.push(`${file.name}: ${error instanceof Error ? error.message : '등록하지 못했습니다.'}`)
        }
      }
      if (!alive.current) return
      if (!assets.length) {
        setNotice(problems.join('\n') || '사진을 등록하지 못했습니다.')
        return
      }
      const leftover = attach ? attachAssetsToRequest(state, selectionKey, assets.map((asset) => asset.id)).leftover : 0
      setState((prev) => {
        const next = addLibraryAssets(prev, assets)
        if (target === 'product') next.conversationUi = { ...conversation(prev), sampleIds: [...conversation(prev).sampleIds, ...assets.map((asset) => asset.id)] }
        if (target === 'reference') next.references = { composition: [assets[0].id] }
        if (target === 'result') next.versions = prev.versions.map((item) => item.id === versionId && !item.resultId ? { ...item, resultId: assets[0].id } : item)
        if (attach) next.editInputs = attachAssetsToRequest(next, selectionKey, assets.map((asset) => asset.id)).editInputs
        return next
      })
      if (target === 'result') setContinueSelected(true)
      if (leftover) problems.push(`요청당 ${REQUEST_ATTACH_LIMIT}장까지 첨부할 수 있어 ${leftover}장은 보관함에만 넣었습니다.`)
      setNotice(problems.join('\n'))
    } catch (error) {
      console.warn('[styled-studio] 사진 등록 실패', { path: location.pathname, target, error })
      if (alive.current) setNotice(error instanceof Error ? error.message : '사진을 등록하지 못했습니다.')
    } finally { if (alive.current) setBusy(false) }
  }
  function picker(label: string, target: 'product' | 'reference' | 'result' | 'edit', versionId?: string) {
    return <label className="cs-upload"><ImagePlus size={22} /><strong>{label}</strong><small>{target === 'product' ? '여러 장 한 번에 · 큰 이미지는 고화질로 자동 최적화' : 'JPG, PNG, WEBP · 큰 이미지는 고화질로 자동 최적화'}</small><input aria-label={label} disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" multiple={target === 'product' || target === 'edit'} onChange={(event) => { void upload(event.target.files, target, versionId); event.target.value = '' }} /></label>
  }
  function selectPhoto(id: string, checked: boolean) {
    setState(prev => { const next = { ...prev.editInputs?.[selectionKey] }; if (checked) { if (Object.keys(next).length >= REQUEST_ATTACH_LIMIT) return prev; next[id] = '이번 요청에서 용도 해석' } else delete next[id]; return { ...prev, editInputs: { ...prev.editInputs, [selectionKey]: next } } })
  }
  function deletePhoto(id: string) {
    const preview = removeLibraryAsset(state, id)
    if (!preview.removed) {
      setNotice(preview.message ?? assetUsageMessage(state, id))
      return
    }
    const label = state.assets[id] ? photoLabel(state.assets[id]) : '이 사진'
    if (!window.confirm(`${label}을 보관함에서 삭제할까요? 현재 요청 첨부에서도 빠집니다.`)) return
    setState((prev) => {
      const next = removeLibraryAsset(prev, id)
      if (!next.removed) return prev
      return next.state
    })
    if (infoId === id) setInfoId(null)
    setNotice('')
  }
  function hasFileDrag(event: DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files')
  }
  function onStudioDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setDropping(true)
  }
  function onStudioDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  function onStudioDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDropping(false)
  }
  function onStudioDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDropping(false)
    if (busy || generationLock.current || !event.dataTransfer?.files.length) return
    void upload(Array.from(event.dataTransfer.files), 'edit', undefined, true)
  }
  function rememberCaret() {
    const el = input.current
    if (el) caret.current = el.selectionStart ?? el.value.length
  }
  function mentionPhoto(name: string) {
    if (busy || generationLock.current) return
    const el = input.current
    const current = el?.value ?? request
    const pos = el && typeof el.selectionStart === 'number' ? el.selectionStart : caret.current
    const next = insertAtCaret(current, name, pos)
    setRequest(next.text)
    caret.current = next.caret
    requestAnimationFrame(() => {
      const box = input.current
      if (!box) return
      box.focus()
      box.setSelectionRange(next.caret, next.caret)
    })
  }
  function resultActions(version: StudioVersion) {
    const image = version.resultId ? state.assets[version.resultId] : undefined
    return <div className="cs-result-actions">
      {image ? <a className="cs-result-download" href={image.data} download={image.name}>사진 내려받기</a> : picker('테스트 결과 사진 등록', 'result', version.id)}
      <button type="button" className="cs-favorite" aria-pressed={version.favorite} onClick={() => setState((prev) => ({ ...prev, versions: prev.versions.map((item) => item.id === version.id ? { ...item, favorite: !item.favorite } : item) }))}>{version.favorite ? '★ 최종 후보' : '☆ 최종 후보로 담기'}</button>
      <button type="button" className="cs-primary" disabled={busy || (!!api && !image)} onClick={() => { setState((prev) => ({ ...prev, selectedId: version.id })); setContinueSelected(true); input.current?.focus() }}>이 컷에서 이어가기</button>
      {!!comparisonIds.length && <details className="cs-inline-compare"><summary>원본과 비교</summary><div className="cs-compare">{comparisonIds.slice(0, 4).map((id) => <img key={id} src={state.assets[id].data} alt={state.assets[id].name + ' 비교 원본'} />)}</div></details>}
      {!!version.prompt && <details className="cs-inline-compare"><summary>사용한 지시문</summary><textarea aria-label="사용한 지시문" readOnly rows={5} value={version.prompt} /></details>}
    </div>
  }
  async function refreshModels() {
    if (!api || checkingModels) return
    setCheckingModels(true)
    try { applyCatalog(await api.models()) }
    catch (error) {
      console.warn('[styled-image] 모델 다시 확인 실패', { path: location.pathname, error })
      setAvailability([]); setDirectors([]); setModelStatus(error instanceof Error ? error.message : '모델 조회 실패')
    } finally { setCheckingModels(false) }
  }
  async function executeBatch(batch: StudioBatch, mode: 'generate' | 'resume', selectResults = false) {
    if (!api) return false
    const turnId = batch.turn.id
    setState(prev => ({ ...prev, conversationUi: { ...conversation(prev), turns: conversation(prev).turns.map(turn => turn.id === turnId ? { ...turn, status: 'generating', error: undefined } : turn) } }))
    const next = await runStudioBatch(batch, api, mode, {
      shouldContinue: () => alive.current,
      onProgress: message => { if (alive.current) setProgress(message) },
      onResult: (result, prompt, index) => {
        const resultId = crypto.randomUUID()
        const versionId = crypto.randomUUID()
        const mime = result.data.slice(5, result.data.indexOf(';'))
        const asset: StudioAsset = { id: resultId, name: `${result.modelId}-${Date.now()}-${index + 1}.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`, type: mime, data: result.data, productIds: batch.outputProductIds }
        setState(prev => {
          const turn = batch.turn
          const titleNumber = prev.versions.filter(item => !!item.parentId === !!turn.parentId).length + 1
          const version: StudioVersion = { id: versionId, productSnapshot: turn.productSnapshot, title: `${turn.parentId ? '수정' : '시안'} ${titleNumber}`, created: new Date().toISOString(), request: turn.request, prompt, assetIds: turn.assetIds, resultId, parentId: turn.parentId, favorite: false, modelId: result.modelId, settings: turn.settings, director: turn.director, inputRoles: Object.fromEntries(turn.assetIds.map((id, itemIndex) => [id, batch.prepared.images[itemIndex].role])), productInfo: batch.productInfo }
          return { ...addLibraryAssets(prev, [asset]), versions: [...prev.versions, version], selectedId: selectResults ? versionId : prev.selectedId, conversationUi: { ...conversation(prev), turns: conversation(prev).turns.map(item => item.id === turnId ? { ...item, versionIds: [...item.versionIds, versionId] } : item) } }
        })
      },
    })
    if (!alive.current) return false
    const complete = next.nextIndex === next.total
    const message = complete ? `${next.total}장 생성이 완료되었습니다. 결과를 내려받아 보관해 주세요.` : next.error ?? `${next.nextIndex}/${next.total}장 완료 · 남은 ${next.total - next.nextIndex}장은 아래 버튼으로 생성할 수 있습니다.`
    setBatches(prev => {
      const updated = { ...prev }
      if (complete) delete updated[turnId]
      else updated[turnId] = next
      return updated
    })
    setState(prev => ({ ...prev, conversationUi: { ...conversation(prev), turns: conversation(prev).turns.map(turn => turn.id === turnId ? { ...turn, status: complete ? 'complete' : next.error ? 'failed' : 'paused', error: complete ? undefined : message } : turn) } }))
    setNotice(message)
    return complete
  }
  async function continueBatch(turnId: string, mode: 'generate' | 'resume') {
    const batch = batches[turnId]
    if (!api || !batch || busy || generationLock.current) return
    generationLock.current = true
    setBusy(true); setNotice(''); setProgress(mode === 'resume' ? '접수된 이미지 결과 확인 중…' : '남은 이미지 생성 중…')
    const started = performance.now()
    try { await executeBatch(batch, mode) }
    catch (error) {
      console.warn('[styled-image] 작업 이어가기 실패', { path: location.pathname, lastInput: '이미지 작업 이어가기', turnId, error })
      if (alive.current) setNotice(error instanceof Error ? error.message : '작업을 이어가지 못했습니다.')
    } finally {
      console.info('[styled-image] 작업 이어가기 종료', { path: location.pathname, lastInput: '이미지 작업 이어가기', turnId, elapsedMs: Math.round(performance.now() - started) })
      generationLock.current = false
      if (alive.current) { setBusy(false); setProgress('') }
    }
  }
  function batchActions(turnId: string) {
    const batch = batches[turnId]
    if (!batch) return null
    return <section className="cs-director-review" aria-label="중단된 이미지 작업">
      <strong>{batch.nextIndex}/{batch.total}장 완료 · {batch.pendingJob ? '접수된 이미지 결과 대기' : `남은 ${batch.total - batch.nextIndex}장`}</strong>
      <p>{batch.pendingJob ? '원래 사진·지시문·화질로 접수된 작업의 결과만 확인합니다. 새 이미지를 요청하지 않습니다.' : '완료된 이미지는 유지하고 남은 장수만 원래 사진·지시문·화질로 생성합니다.'}</p>
      {!batch.pendingJob && <small>{batch.error ? '직전 요청은 제공자에서 처리되었을 수 있습니다. 남은 이미지를 새로 요청하면 추가 요금이 발생할 수 있습니다.' : '남은 이미지를 생성하면 API 요금이 발생합니다.'}</small>}
      <button type="button" className="cs-primary" disabled={busy} onClick={() => void continueBatch(turnId, batch.pendingJob ? 'resume' : 'generate')}>{batch.pendingJob ? '진행 중인 이미지 결과 확인' : `남은 ${batch.total - batch.nextIndex}장 생성`}</button>
    </section>
  }
  async function generate(approved = false) {
    if (!api || busy || generationLock.current) return
    if (invalidNumbers || editSelectionEmpty || !request.trim()) {
      setNotice(invalidNumbers ? '연결된 제품의 크기를 양수로 입력하거나 비워 주세요.' : editSelectionEmpty ? '이번 요청에 사용할 이미지를 체크해 주세요.' : '요청 내용을 입력해 주세요.')
      return
    }
    generationLock.current = true
    setBusy(true); setProgress('참고자료 준비 중…'); setNotice('')
    const started = performance.now()
    const turnId = crypto.randomUUID()
    let stage: 'prepare' | 'direct' | 'generate' = 'prepare'
    try {
      const preparedInput = { state, modelId, directorModelId, request, products, references, roles: Object.fromEntries(products.map((id) => [id, roleOf(state, id)])), parent, additionalImages }
      const draft = timeStudioWork('요청 구성·사진 검증', () => ({ ...buildStudioGenerationRequest(preparedInput), settings }))
      setProgress('큰 이미지는 고화질로 자동 최적화하고 있습니다…')
      const fitStarted = performance.now()
      const fitted = await fitStudioRequestImages(draft, imageModel(modelId).provider)
      const fitMs = Math.round(performance.now() - fitStarted)
      if (fitMs >= 200) console[fitMs >= 1000 ? 'warn' : 'info']('[styled-studio] 요청 이미지 최적화', { path: location.pathname, elapsedMs: fitMs, input: '이미지 생성', images: fitted.images.length })
      const base = { ...validateImageRequest(fitted), settings }
      stage = currentDirector ? 'prepare' : 'direct'
      setProgress(currentDirector ? '완성된 지시문으로 이미지 생성 준비 중…' : `디렉터가 선택한 사진 ${base.images.length}장을 분석하고 있어요…`)
      console.info('[styled-image] 디렉터 첨부 구성', { path: location.pathname, input: '이미지 생성', imageCount: base.images.length, roles: base.images.map((image) => image.role) })
      const plan = currentDirector ?? await api.direct(base)
      const productSnapshot = selectedProducts(state, Object.keys(additionalImages ?? {}))
      const outputProductIds = (plan.outputProductIds ?? []).filter(id => productSnapshot.some(p => p.id === id))
      if (!alive.current) return
      setDirector({ key: directorKey, plan })
      console.info('[styled-image] 디렉터 단계 완료', { path: location.pathname, input: '이미지 생성', reused: !!currentDirector, elapsedMs: Math.round(performance.now() - started), reviewFirst, approved })
      if (plan.question) { setNotice(`디렉터 확인: ${plan.question} 요청창에 답을 덧붙여 다시 요청해 주세요.`); return }
      if (reviewFirst && !approved) { setNotice('연출 지시문을 준비했습니다. 확인하거나 수정한 뒤 생성해 주세요.'); return }
      const prepared = applyDirectorPlan(base, plan)
      stage = 'generate'
      setDirector(null)
      const assetIds = generationAssetIds(preparedInput)
      const total = parent ? 1 : Number(count)
      const action = parent ? 'detail' : 'create'
      const turn: StudioPreviewTurn = { id: turnId, productSnapshot, imageRoles: prepared.images.map((image) => image.role), request: request.trim(), action, assetIds, versionIds: [], parentId: parent?.id, productName: state.form.productName, material: state.form.fabricMaterial, dimensions: [state.form.sizeWidth, state.form.sizeHeight, state.form.sizeDepth].map((value) => value || '미입력').join(' × '), ratio: prepared.ratio, modelId, settings, director: plan, status: 'generating' }
      setState((prev) => ({ ...prev, conversationUi: { ...conversation(prev), turns: [...conversation(prev).turns, turn] } }))
      setRequest(''); setContinueSelected(false)
      requestAnimationFrame(() => latest.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
      const complete = await executeBatch({ turn, prepared, total, nextIndex: 0, outputProductIds, productInfo: selectedPhotoNotes(state, assetIds).join(' / ') }, 'generate', true)
      if (alive.current && complete) setContinueSelected(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '이미지 생성에 실패했습니다.'
      console.warn('[styled-image] 생성 실패', { path: location.pathname, input: '이미지 생성', modelId, stage, error })
      if (alive.current) {
        setDirector(prev => prev?.key === directorKey ? { ...prev, failure: message } : prev)
        setNotice(message)
      }
    } finally {
      console.info('[styled-image] 생성 작업 종료', { path: location.pathname, input: '이미지 생성', modelId, elapsedMs: Math.round(performance.now() - started) })
      generationLock.current = false
      if (alive.current) { setBusy(false); setProgress(''); requestAnimationFrame(() => latest.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })) }
    }
  }
  function preview() {
    if (!request.trim() || editSelectionEmpty || invalidNumbers || busy) return
    // Deterministic UI example, NOT a model/router. No network, image analysis or prompt execution.
    const action: StudioPreviewTurn['action'] = !parent ? 'create' : /부분|끈만|원단|소재|로고|그림자/.test(request) ? 'detail' : /배경만|배경을.*(바꿔|변경|교체)/.test(request) ? 'background' : /구도로|각도로|옆에서|다른 구도|방향/.test(request) ? 'angle' : 'detail'
    const assetIds = generationAssetIds({state, products, references, parent, additionalImages})
    const turnId = crypto.randomUUID()
    const versionIds = Array.from({ length: parent ? 1 : Number(count) }, () => crypto.randomUUID())
    const turn: StudioPreviewTurn = { id: turnId, request: request.trim(), action, assetIds, versionIds, parentId: parent?.id, productName: state.form.productName, material: state.form.fabricMaterial, dimensions: [state.form.sizeWidth, state.form.sizeHeight, state.form.sizeDepth].map((value) => value || '미입력').join(' × '), ratio: state.form.outputRatio }
    const versions: StudioVersion[] = versionIds.map((id, index) => ({ id, title: parent ? '수정 ' + (ui.turns.filter((item) => item.parentId).length + 1) : '시안 ' + (state.versions.filter((item) => !item.parentId).length + index + 1), parentId: parent?.id, created: new Date().toISOString(), request: request.trim(), prompt: '', assetIds, favorite: false, previewOnly: true }))
    setState((prev) => ({ ...prev, conversationUi: { ...conversation(prev), turns: [...conversation(prev).turns, turn] }, versions: [...prev.versions, ...versions], selectedId: versionIds[0] }))
    setRequest(''); setContinueSelected(false)
    requestAnimationFrame(() => latest.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  const composer = (
    <fieldset disabled={busy} className={'cs-composer-wrap cs-request-fieldset' + (generating ? ' is-generating' : '')} aria-label="이미지 생성 요청" aria-busy={generating}>
      {notice && !generating && !director?.failure && <div className="cs-request-notice" role="status">{notice}<button type="button" aria-label="알림 닫기" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {parent && <div className="cs-context"><span><Layers3 size={14} />{parent.title}에서 이어서 <small>{parent.resultId ? '사용할 이미지를 직접 선택' : '결과 없는 흐름 예시'}</small></span><button type="button" aria-label="선택한 컷에서 이어가기 해제" onClick={() => setContinueSelected(false)}><X size={14} /></button></div>}
      {!!attachedIds.length && <div className="cs-request-attachments" aria-label={`이번 요청 첨부 ${attachedIds.length}장`}>
        <strong>이번 요청 · {attachedIds.length}장</strong>
        <div className="cs-attach-thumbs">{attachedIds.map((id) => state.assets[id] && <figure key={id}><img src={state.assets[id].data} alt={photoLabel(state.assets[id])} /><figcaption>{photoLabel(state.assets[id])}</figcaption><button type="button" aria-label={`${photoLabel(state.assets[id])} 첨부 해제`} onClick={() => selectPhoto(id, false)}><X size={12} /></button></figure>)}</div>
      </div>}
      {missingMentions.length > 0 && <p role="alert" className="cs-help">요청에 적은 {missingMentions.map((n) => '사진 ' + n).join(', ')}이 첨부되지 않았습니다. 보관함에서 체크하거나 번호를 수정해 주세요.</p>}
      <div className="cs-composer">
        <textarea ref={input} disabled={busy} aria-label="AI에게 요청" rows={hasConversation ? 2 : 3} value={request} onChange={(event) => { setRequest(event.target.value); caret.current = event.target.selectionStart ?? event.target.value.length }} onSelect={rememberCaret} onClick={rememberCaret} onKeyUp={rememberCaret} onBlur={rememberCaret} placeholder={parent ? '이 컷에서 바꾸고 싶은 부분을 말해 주세요.' : '이 제품으로 레퍼런스처럼 연출컷을 만들어줘.'} />
        <div className="cs-composer-bottom">
          <div className="cs-composer-tools">
            <label className="cs-composer-action"><ImagePlus size={16} /><span>사진 추가</span><input aria-label="사진 추가" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void upload(event.target.files, 'edit', undefined, true); event.target.value = '' }} /></label>
            <button type="button" className="cs-composer-action" aria-expanded={libraryOpen} aria-controls="cs-library-panel" onClick={() => { setLibraryOpen(true); setPickerOpen(false) }}><Images size={16} /><span>사진 보관함</span></button>
            <label>비율<select aria-label="화면 비율" disabled={busy} value={state.form.outputRatio} onChange={(event) => field('outputRatio', event.target.value as FormState['outputRatio'])}>{OUTPUT_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label>
            <label>장 수<select aria-label="시안 수" value={parent ? '1' : count} disabled={busy || !!parent} onChange={(event) => setCount(event.target.value)}>{['1', '2', '3', '4'].map((value) => <option key={value} value={value}>{value}장</option>)}</select></label>
          </div>
          <button type="button" className="cs-primary" disabled={!request.trim() || editSelectionEmpty || busy || invalidNumbers || (!!api && (checkingModels || availability.find((item) => item.modelId === modelId)?.available !== true))} onClick={api ? () => void generate() : preview}>{api ? busy ? progress || '처리 중…' : reviewFirst ? '디렉터 지시문 만들기' : '이미지 생성' : '요청 흐름 체험'} <ArrowUp size={16} /></button>
        </div>
      </div>
      <p className="cs-composer-note">{invalidNumbers ? '연결된 제품의 크기를 양수로 입력하거나 비워 주세요.' : editSelectionEmpty ? '사진을 끌어다 놓거나 사진 추가로 첨부해 주세요. 큰 이미지는 고화질로 자동 최적화합니다. 보관함에서 고른 사진은 체크해야 합니다.' : api ? '사진과 요청을 OpenAI 디렉터와 선택한 이미지 제공자에 전송합니다. 여러 장은 한 장씩 생성하며 실패 시 자동 재시도하지 않습니다.' : '화면 체험용입니다. AI 호출·이미지 생성·요금 발생이 없습니다.'}</p>
    </fieldset>
  )
  if (!ready) return <div className="conversation-studio cs-docked"><p role="status">저장된 작업을 불러오고 있습니다…</p></div>
  return <div className={'conversation-studio cs-docked' + (showWorkspace ? ' is-threaded' : ' is-empty') + (dropping ? ' is-dropping' : '')} onDragEnter={onStudioDragEnter} onDragOver={onStudioDragOver} onDragLeave={onStudioDragLeave} onDrop={onStudioDrop}>
    <header className="cs-header"><div className="cs-brand"><span className="cs-logo"><Layers3 size={23} /></span><div><span className="cs-eyebrow">ATELIER CREATIVE</span><h1>연출컷 스튜디오</h1></div></div><div className="cs-header-right"><span className="cs-save" role="status">{saveStatus}</span>{api ? <div className={"cs-model-picker" + (pickerOpen ? " is-open" : "")}>
        <button type="button" className="cs-model-picker-toggle" aria-expanded={pickerOpen} onClick={() => setPickerOpen((value) => !value)}>
          <span>모델 · 출력 설정</span>
          <small>{imageModelLabel} · 디렉터 {directorLabel}</small>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {pickerOpen ? <div className="cs-model-picker-body">
          <div className="cs-model-row">
            <label className="cs-field">이미지 모델<select aria-label="이미지 모델" value={modelId} disabled={busy} onChange={(event) => { const next = event.target.value as StyledImageModelId; setModelId(next); setSettings((value) => ({ resolution: next !== 'gemini-3-pro-image' && value.resolution === '4K' ? '2K' : value.resolution, quality: imageQualities(next).includes(value.quality) ? value.quality : 'high' })) }}>{STYLED_IMAGE_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}{availability.find((item) => item.modelId === model.id)?.available === false ? ' · 연결 확인 필요' : ''}</option>)}</select></label>
            <button type="button" className="cs-model-refresh" disabled={busy || checkingModels} onClick={() => void refreshModels()}>연결 다시 확인</button>
          </div>
          <p className="cs-help" role="status">{checkingModels ? '등록된 키로 모델을 확인하고 있습니다…' : availability.find((item) => item.modelId === modelId)?.message ?? modelStatus}</p>
          <div className="cs-quality-controls">
            <label className="cs-field">출력 크기<select aria-label="출력 크기" disabled={busy} value={settings.resolution} onChange={(event) => setSettings((value) => ({ ...value, resolution: event.target.value as ImageSettings['resolution'] }))}>{(isGemini ? ['1K', '2K', '4K'] : ['1K', '2K']).map((size) => <option key={size} value={size}>{isGemini ? size : `${size === '1K' ? '표준' : '고해상도'} · ${outputSize({ ratio: state.form.outputRatio, settings: { ...settings, resolution: size as ImageSettings['resolution'] } })} px`}</option>)}</select></label>
            {!isGemini && <label className="cs-field">생성 품질<select aria-label="생성 품질" disabled={busy} value={settings.quality} onChange={(event) => setSettings((value) => ({ ...value, quality: event.target.value as ImageSettings['quality'] }))}>{imageQualities(modelId).map((quality) => <option key={quality} value={quality}>{{ low: '빠르게 · Low', medium: '균형 · Medium', high: '정밀 · High', xhigh: '더 정밀 · XHigh', max: '최대 · Max' }[quality]}</option>)}</select></label>}
          </div>
          <label className="cs-field">디렉터 모델<select aria-label="디렉터 모델" value={directorModelId} disabled={busy || !directorOptions.length} onChange={(event) => setDirectorModelId(event.target.value as StyledDirectorModelId)}>{directorOptions.map((model) => <option key={model.modelId} value={model.modelId}>{model.label}</option>)}</select></label>
          <label className="cs-review-toggle"><input type="checkbox" disabled={busy} checked={reviewFirst} onChange={(event) => setReviewFirst(event.target.checked)} />생성 전에 디렉터 지시문 확인·수정</label>
          <p className="cs-help">Flare: 빠른 생성 · Sunburst: 정밀 편집 · 나노바나나 Pro: Google 모델<br />출력 크기와 품질이 높을수록 비용과 생성 시간이 늘어납니다.</p>
        </div> : null}
      </div> : null}</div></header>
    <div className="cs-workspace">
      {showWorkspace ? <div className="cs-workspace-main">
      {api ? null : <details className="cs-tool-details cs-panel"><summary><span>요청 이해 <ChevronRight size={12} /> 자료 선택 <ChevronRight size={12} /> 도구 연결</span><small>작동 방식 보기</small></summary><p>담당 AI가 요청과 사진을 해석하고, 필요한 작업 도구를 선택하는 구성입니다.</p><div className="cs-tool-grid">{(['background', 'create', 'detail'] as const).map((key) => <div key={key}><strong>{ACTIONS[key].tool}</strong><span>{ACTIONS[key].title}</span><small>미연결</small></div>)}</div><p className="cs-help">아래 체험에서는 요청의 일부 단어와 사진 역할로 정해진 예시를 표시합니다. 실제 AI 판단이나 전송이 아닙니다.</p></details>}
      <div className="cs-chat-column">
      <main className="cs-chat cs-panel">
        {!!state.versions.length && <div className="cs-thread-bar" aria-label="작업 이력"><button type="button" disabled={busy} onClick={() => { setContinueSelected(false); setRequest(''); input.current?.focus() }}><Plus size={13} />새 연출</button>{[...state.versions].reverse().map((version) => <button type="button" disabled={busy} className={'cs-thread-thumb' + (selected?.id === version.id ? ' is-selected' : '')} key={version.id} aria-label={version.title + ' 선택'} aria-pressed={selected?.id === version.id} onClick={() => { setState((prev) => ({ ...prev, selectedId: version.id })); setContinueSelected(true) }}>{version.resultId ? <img src={state.assets[version.resultId].data} alt="" /> : <Images size={14} />}<span>{version.resultId ? photoLabel(state.assets[version.resultId]) + " · " : ""}{version.title}{version.favorite ? ' ★' : ''}</span></button>)}</div>}
        <div className="cs-messages">
          {ui.turns.map((turn) => <section className="cs-turn" key={turn.id}><div className="cs-user-message">{turn.parentId && <small>↳ {state.versions.find((item) => item.id === turn.parentId)?.title ?? '선택한 컷'}에서 이어서</small>}<p>{turn.request}</p>{turn.imageRoles && <div className="cs-sent-images" aria-label="이번 요청에 전달한 이미지">{turn.assetIds.map((id) => state.assets[id] && <figure key={id}><img src={state.assets[id].data} alt={photoLabel(state.assets[id])} /><figcaption>{photoLabel(state.assets[id])}</figcaption></figure>)}</div>}</div><div className="cs-assistant-message"><span className="cs-mini-avatar"><Sparkles size={14} /></span><div><div className="cs-reply-title"><strong>{ACTIONS[turn.action].title}</strong><span>{turn.modelId ? STYLED_IMAGE_MODELS.find((model) => model.id === turn.modelId)?.label ?? turn.modelId : "응답 예시"}</span></div><p>{turn.modelId ? turn.status === "generating" ? progress || "생성 중…" : (turn.status === "failed" || turn.status === "paused") ? turn.error : "생성이 완료되었습니다. 결과를 선택해 이어서 수정할 수 있습니다." : ACTIONS[turn.action].description + "이에요. 연결 후에는 이곳에서 결과를 받고 이어서 수정할 수 있습니다."}</p>{turn.director && <div className="cs-director-summary"><strong>디렉터의 연출 계획</strong><p>{turn.director.summary}</p><details><summary>사용한 상세 지시문</summary><p className="cs-director-text">{turn.director.prompt}</p></details><small>{turn.settings?.resolution} · {turn.modelId === "gemini-3-pro-image" ? "JPEG" : turn.settings?.quality}</small></div>}<div className="cs-keep"><Check size={13} />{turn.parentId && turn.imageRoles ? turn.imageRoles.includes("편집 대상") ? "체크한 편집 대상과 참고 사진으로 작업" : "체크한 참고 사진과 이번 요청으로 작업" : ACTIONS[turn.action].keep}</div><details className="cs-packet"><summary><Paperclip size={13} /> 참고자료 {turn.assetIds.length}장 · {turn.modelId ? STYLED_IMAGE_MODELS.find((model) => model.id === turn.modelId)?.label : ACTIONS[turn.action].tool}<ChevronRight size={13} /></summary><p className="cs-help">{turn.modelId ? "생성 요청에 사용한 참고자료입니다." : "전달 구성 예시 · 실제로 전송되지 않았습니다."}</p><div className="cs-packet-photos">{turn.assetIds.map((id) => state.assets[id] && <figure key={id}><img src={state.assets[id].data} alt="" /><figcaption>{photoLabel(state.assets[id])}</figcaption></figure>)}</div><p className="cs-help">{turn.assetIds.some(id => photoNote(state.assets[id])) ? turn.assetIds.map(id => photoNote(state.assets[id]) && <span key={id}>{photoLabel(state.assets[id])}: {photoNote(state.assets[id])}<br /></span>) : turn.productSnapshot?.length ? turn.productSnapshot.map(p => <span key={p.id}>{productDescription(p)}<br /></span>) : '사진 설명 없음'} · 비율: {turn.ratio}</p></details><div className="cs-inline-results">{turn.versionIds.map((id) => { const version = state.versions.find((item) => item.id === id); return version && (version.resultId ? <StudioImagePreview key={id} asset={state.assets[version.resultId]} title={`${photoLabel(state.assets[version.resultId])} · ${version.title}`} disabled={busy} selected={state.selectedId === id} onSelect={() => { setState((prev) => ({ ...prev, selectedId: id })); setContinueSelected(true) }} /> : <button key={id} disabled={busy} aria-label={version.title + ' 선택'} onClick={() => { setState((prev) => ({ ...prev, selectedId: id })); setContinueSelected(true) }}><span className="cs-mini-placeholder"><Images size={22} /><small>이미지 미생성</small></span><strong>{version.title}</strong></button>) })}</div>{selected && turn.versionIds.includes(selected.id) ? resultActions(selected) : null}{batchActions(turn.id)}<small className="cs-help">{turn.modelId ? "마음에 드는 컷을 고르면 이 대화에서 이어서 수정할 수 있습니다. 원단·로고·끈 연결·비율을 원본과 비교해 주세요." : "결과 자리만 표시했습니다. 고른 컷에 테스트 사진을 올릴 수 있어요."}</small></div></div></section>)}
          {generating && <div className="cs-assistant-message cs-generation-turn"><span className="cs-mini-avatar"><Sparkles size={14} /></span><div><StudioGenerationProgress model={progress.startsWith('디렉터') ? directorLabel : imageModelLabel} progress={progress} /></div></div>}
          {currentDirector && !generating && <section className="cs-director-review" aria-label="디렉터 지시문 검토">
            <strong>디렉터의 연출 계획</strong>
            {director?.failure && <p role="alert">{director.failure}</p>}
            <p>{currentDirector.summary}</p>
            {currentDirector.question ? <p role="alert">{currentDirector.question}<br />아래 요청창에 답을 덧붙여 주세요.</p> : <>
              <details open={reviewFirst}><summary>상세 지시문 확인·수정</summary><textarea aria-label="디렉터 상세 지시문" rows={7} maxLength={8000} disabled={busy} value={currentDirector.prompt} onChange={(event) => setDirector({ key: directorKey, plan: { ...currentDirector, prompt: event.target.value } })} /><small>제품 보존 기준과 원래 요청은 이 지시문과 함께 전달됩니다.</small></details>
              <button type="button" className="cs-primary" disabled={busy || editSelectionEmpty || !currentDirector.prompt.trim() || checkingModels || availability.find((item) => item.modelId === modelId)?.available !== true} onClick={() => void generate(true)}>이 지시문으로 이미지 생성 <ArrowUp size={16} /></button>
            </>}
            <small>요청·사진·설정을 바꾸면 다시 분석합니다.</small>
          </section>}
          <div ref={latest} />
        </div>
      </main>
      </div>
      <div className="cs-dock cs-panel">{composer}</div>
      </div> : <div className="cs-empty-stage">
        <h2>어떤 연출컷을 만들어볼까요?</h2>
        <div className="cs-dock cs-panel is-centered">{composer}</div>
      </div>}
      {libraryOpen && <aside id="cs-library-panel" ref={libraryPanel} className="cs-library-drawer cs-panel" role="complementary" aria-labelledby="cs-library-title" tabIndex={-1}>
          <div className="cs-library-drawer-head">
            <div><span className="cs-eyebrow">PHOTOS</span><h2 id="cs-library-title">사진 보관함</h2></div>
            <button type="button" className="cs-library-drawer-close" aria-label="사진 보관함 닫기" onClick={() => setLibraryOpen(false)}><X size={16} /></button>
          </div>
          <div className="cs-library-drawer-body">
            <StudioLibrary state={state} selected={additionalImages} busy={busy} editingId={infoId} filter={photoFilter} onFilter={setPhotoFilter} onSelect={selectPhoto} onUpload={files => void upload(files, 'edit')} onMention={mentionPhoto} onEdit={id => setInfoId(current => current === id ? null : id)} onDelete={deletePhoto} />
            <div className="cs-storage-note"><Check size={14} /><span>{api ? '시험 생성 자료는 현재 화면에만 유지됩니다. 결과는 내려받아 보관하세요.' : '원본 사진과 작업 이력은 이 브라우저에 보관됩니다.'}</span></div>
          </div>
        </aside>}
      {infoId && state.assets[infoId] && <>
        <button type="button" className="cs-info-backdrop" aria-label="정보 패널 닫기" onClick={() => setInfoId(null)} />
        <StudioPhotoInfo state={state} assetId={infoId} busy={busy} onState={setState} onClose={() => setInfoId(null)} />
      </>}
      {dropping && <div className="cs-drop-overlay" role="status">이미지를 놓아 이번 요청에 첨부 · 큰 이미지는 고화질로 자동 최적화</div>}
    </div>
    <footer className="cs-footer">{api ? "시험 생성 결과는 자동 저장되지 않습니다. 새로고침하거나 작업을 닫기 전에 결과를 내려받아 주세요." : "현재 기기·브라우저에만 저장됩니다. 브라우저 데이터를 삭제하면 자료와 이력이 사라집니다."}</footer>
  </div>
}
