import { PendingStudioImageError } from '../../lib/design/studio-job-polling'
import type { StudioImageJob } from '../../../supabase/functions/_shared/styled-image-job'
import { StudioLibrary } from './StudioLibrary'
import { StudioPhotoInfo } from './StudioPhotoInfo'
import { addLibraryAssets, insertAtCaret, normalizeLibrary, photoLabel, photoNote, productDescription, selectedProducts, selectedPhotoNotes, missingPhotoMentions } from '../../lib/design/studio-library'
import { StudioImagePreview } from './StudioImagePreview'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronRight, ImagePlus, Images, Layers3, MessageCircle, Paperclip, Plus, Sparkles, WandSparkles, X } from 'lucide-react'
import { OUTPUT_RATIOS, PRODUCT_PHOTO_SLOTS, type FormState } from '../../lib/design/styled-cuts'
import { loadStudio, newStudio, readStudioAsset, saveStudio, type StudioAsset, type StudioPreviewTurn, type StudioState, type StudioVersion } from '../../lib/design/styled-studio'
import { useRenderWatch } from '../../lib/diagnostics/render-watch'
import './styled-studio.css'
import { DEFAULT_DIRECTOR_MODEL_ID, DEFAULT_IMAGE_SETTINGS, directorModelLabel, imageQualities, outputSize, preferredDirectorModelId, type ImageSettings, type DirectorPlan, STYLED_IMAGE_MODELS, type StyledDirectorAvailability, type StyledDirectorModelId, type StyledImageModelId, type StudioCatalog, type StudioImageApi, type StyledImageAvailability } from '../../../supabase/functions/_shared/styled-image-core'
import { prepareStudioGeneration, generationAssetIds } from '../../lib/design/studio-generation'
import { timeStudioWork } from '../../lib/design/studio-timing'
import { applyDirectorPlan } from '../../../supabase/functions/_shared/styled-director'
import { StudioGenerationProgress } from './StudioGenerationProgress'

const ACTIONS = {
  create: { title: '새로운 연출 만들기', tool: 'Nano Banana Pro', description: '제품 사진과 레퍼런스로 새로운 장면을 구성하는 작업', keep: '체크한 사진과 이번 요청을 기준으로 작업' },
  background: { title: '배경 바꾸기', tool: 'Photoroom', description: '선택한 컷의 제품 모습을 활용해 배경을 바꾸는 작업', keep: '제품 모습과 구도 유지 · 요청한 배경만 변경' },
  angle: { title: '다른 구도 만들기', tool: 'Nano Banana Pro', description: '원본 제품을 함께 참고해 다른 방향의 연출을 만드는 작업', keep: '제품 정체성과 현재 배경 유지 · 구도 변경' },
  detail: { title: '부분 수정하기', tool: 'Adobe Firefly', description: '선택한 컷에서 요청한 부분을 수정하는 작업', keep: '선택한 컷 기준 · 요청한 부분 외의 연출 유지' },
}
const QUICK_REQUESTS = [
  { label: '가방을 펼쳐줘', text: '사진 1의 가방을 조금 더 펼쳐줘.' },
  { label: '배경만 바꿔줘', text: '제품과 구도는 유지하고, 배경만 밝은 소파로 바꿔줘.' },
  { label: '다른 구도도 보여줘', text: '배경은 유지하고, 제품을 조금 옆에서 본 구도로 만들어줘.' },
  { label: '끈만 자연스럽게', text: '나머지는 유지하고, 끈만 바닥에 자연스럽게 놓이도록 수정해줘.' },
]
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
  const [example, setExample] = useState(false)
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
  const [director, setDirector] = useState<{ key: string; plan: DirectorPlan; failure?: string; imageStarted?: boolean; pendingJob?: StudioImageJob; pendingTurnId?: string; pendingPrompt?: string } | null>(null)
  const generationLock = useRef(false)
  const alive = useRef(true)
  const saveQueue = useRef(Promise.resolve())
  const saveSequence = useRef(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const latest = useRef<HTMLDivElement>(null)
  const caret = useRef(0)

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
  const editSelectionEmpty = !Object.keys(additionalImages ?? {}).length
  const directorKey = JSON.stringify([request.trim(), modelId, directorModelId, settings, state.form.outputRatio, parent?.id, Object.keys(additionalImages ?? {}).map(id => [id, state.assets[id]?.photoNo, photoNote(state.assets[id]), state.assets[id]?.productIds]), selectedProducts(state, Object.keys(additionalImages ?? {}))])
  const invalidNumbers = selectedProducts(state, Object.keys(additionalImages ?? {})).some(p => [p.width, p.height, p.depth].some(v => v.trim() && (!Number.isFinite(Number(v)) || Number(v) <= 0)))
  const imageModelLabel = STYLED_IMAGE_MODELS.find((model) => model.id === modelId)?.label ?? modelId
  const directorOptions = directors.some((item) => item.modelId === directorModelId)
    ? directors
    : [{ modelId: directorModelId, label: directorModelLabel(directorModelId), available: true, message: '' }, ...directors]
  const directorLabel = directorOptions.find((item) => item.modelId === directorModelId)?.label ?? directorModelLabel(directorModelId)
  const currentDirector = director?.key === directorKey ? director.plan : undefined
  const isGemini = modelId === 'gemini-3-pro-image'
  function field<K extends keyof FormState>(key: K, value: FormState[K]) { setState((prev) => ({ ...prev, form: { ...prev.form, [key]: value } })) }
  async function upload(files: FileList | null, target: 'product' | 'reference' | 'result' | 'edit', versionId?: string) {
    if (!files?.length) return
    const picked = Array.from(files)
    setBusy(true); setNotice('')
    try {
      const assets: StudioAsset[] = []
      for (const file of target === 'product' || target === 'edit' ? picked : picked.slice(0, 1)) assets.push(await readStudioAsset(file))
      if (!alive.current) return
      setState((prev) => {
        const next = addLibraryAssets(prev, assets)
        if (target === 'product') next.conversationUi = { ...conversation(prev), sampleIds: [...conversation(prev).sampleIds, ...assets.map((asset) => asset.id)] }
        // Edit uploads become candidates only; sending requires an explicit checkbox selection.
        if (target === 'reference') next.references = { composition: [assets[0].id] }
        if (target === 'result') next.versions = prev.versions.map((item) => item.id === versionId && !item.resultId ? { ...item, resultId: assets[0].id } : item)
        return next
      })
      if (target === 'result') setContinueSelected(true)
    } catch (error) {
      console.warn('[styled-studio] 사진 등록 실패', { path: location.pathname, target, error })
      if (alive.current) setNotice(error instanceof Error ? error.message : '사진을 등록하지 못했습니다.')
    } finally { if (alive.current) setBusy(false) }
  }
  function picker(label: string, target: 'product' | 'reference' | 'result' | 'edit', versionId?: string) {
    return <label className="cs-upload"><ImagePlus size={22} /><strong>{label}</strong><small>{target === 'product' ? '여러 장 한 번에 · JPG, PNG, WEBP' : 'JPG, PNG, WEBP · 한 장 25MB 이하'}</small><input aria-label={label} disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" multiple={target === 'product' || target === 'edit'} onChange={(event) => { void upload(event.target.files, target, versionId); event.target.value = '' }} /></label>
  }
  function selectPhoto(id: string, checked: boolean) {
    setState(prev => { const next = { ...prev.editInputs?.[selectionKey] }; if (checked) { if (Object.keys(next).length >= 14) return prev; next[id] = '이번 요청에서 용도 해석' } else delete next[id]; return { ...prev, editInputs: { ...prev.editInputs, [selectionKey]: next } } })
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
  function suggest(text: string) { if (busy || generationLock.current) return; setRequest(text); caret.current = text.length; input.current?.focus() }
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
  async function generate(approved = false) {
    if (!api || busy || generationLock.current) return
    if (invalidNumbers || editSelectionEmpty || !request.trim()) {
      setNotice(invalidNumbers ? '연결된 제품의 크기를 양수로 입력하거나 비워 주세요.' : editSelectionEmpty ? '이번 요청에 사용할 이미지를 체크해 주세요.' : '요청 내용을 입력해 주세요.')
      return
    }
    generationLock.current = true
    setBusy(true); setProgress('참고자료 준비 중…'); setNotice('')
    const started = performance.now()
    const pendingJob = director?.key === directorKey ? director.pendingJob : undefined
    const turnId = pendingJob && director?.pendingTurnId ? director.pendingTurnId : crypto.randomUUID()
    let completed = 0
    let turnAdded = false
    let stage: 'prepare' | 'direct' | 'generate' = 'prepare'
    let activePrompt = ''
    try {
      const preparedInput = { state, modelId, directorModelId, request, products, references, roles: Object.fromEntries(products.map((id) => [id, roleOf(state, id)])), parent, additionalImages }
      const base = timeStudioWork('요청 구성·사진 검증', () => ({ ...prepareStudioGeneration(preparedInput), settings }))
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
      setDirector({ key: directorKey, plan, imageStarted: true })
      const assetIds = generationAssetIds(preparedInput)
      const total = pendingJob || parent ? 1 : Number(count)
      const action = parent ? 'detail' : 'create'
      const turn: StudioPreviewTurn = { id: turnId, productSnapshot, imageRoles: prepared.images.map((image) => image.role), request: request.trim(), action, assetIds, versionIds: [], parentId: parent?.id, productName: state.form.productName, material: state.form.fabricMaterial, dimensions: [state.form.sizeWidth, state.form.sizeHeight, state.form.sizeDepth].map((value) => value || '미입력').join(' × '), ratio: prepared.ratio, modelId, settings, director: plan, status: 'generating' }
      setState((prev) => ({ ...prev, conversationUi: { ...conversation(prev), turns: pendingJob && conversation(prev).turns.some(item => item.id === turnId) ? conversation(prev).turns.map(item => item.id === turnId ? { ...item, status: 'generating', error: undefined } : item) : [...conversation(prev).turns, turn] } }))
      turnAdded = true
      requestAnimationFrame(() => latest.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
      if (pendingJob && !api.resume) throw new PendingStudioImageError('기존 작업을 확인하는 연결이 필요합니다. 이미지를 새로 요청하지 않았습니다.', pendingJob)
      for (let index = 0; index < total; index++) {
        if (!alive.current) break
        setProgress(`${index + 1}/${total}장 생성 중…`)
        const prompt = pendingJob && director?.pendingPrompt ? director.pendingPrompt : total > 1 ? `${prepared.prompt}\n\n이번 시안은 ${total}장 중 ${index + 1}번입니다. 같은 제품 정체성을 유지하면서 배치와 구도에 자연스러운 변화를 주세요. 출력은 한 장입니다.` : prepared.prompt
        activePrompt = prompt
        console.info(pendingJob ? '[styled-image] 기존 작업 결과 확인' : '[styled-image] 생성 요청', { path: location.pathname, input: '이미지 생성', modelId, index: index + 1, total })
        const onProgress = (message: string) => { if (alive.current) setProgress(`${index + 1}/${total}장 · ${message}`) }
        const result = pendingJob && api.resume ? await api.resume(pendingJob, onProgress) : await api.generate({ ...prepared, prompt }, onProgress)
        if (!alive.current) break
        const resultId = crypto.randomUUID()
        const versionId = crypto.randomUUID()
        const mime = result.data.slice(5, result.data.indexOf(';'))
        const asset: StudioAsset = { id: resultId, name: `${modelId}-${Date.now()}-${index + 1}.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`, type: mime, data: result.data, productIds: outputProductIds }
        const version: StudioVersion = { id: versionId, productSnapshot, title: parent ? `수정 ${state.versions.filter((item) => item.parentId).length + index + 1}` : `시안 ${state.versions.filter((item) => !item.parentId).length + index + 1}`, created: new Date().toISOString(), request: request.trim(), prompt, assetIds, resultId, parentId: parent?.id, favorite: false, modelId: result.modelId, settings, director: plan, inputRoles: Object.fromEntries(assetIds.map((id, itemIndex) => [id, prepared.images[itemIndex].role])), productInfo: selectedPhotoNotes(state, assetIds).join(' / ') }
        setState((prev) => ({ ...addLibraryAssets(prev, [asset]), versions: [...prev.versions, version], selectedId: versionId, conversationUi: { ...conversation(prev), turns: conversation(prev).turns.map((item) => item.id === turnId ? { ...item, versionIds: [...item.versionIds, versionId] } : item) } }))
        completed++
      }
      if (alive.current) {
        setState((prev) => ({ ...prev, conversationUi: { ...conversation(prev), turns: conversation(prev).turns.map((item) => item.id === turnId ? { ...item, status: 'complete' } : item) } }))
        setRequest(''); setContinueSelected(true); setDirector(null)
        setNotice(`${completed}장을 생성했습니다. 보관할 결과는 내려받아 주세요.`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '이미지 생성에 실패했습니다.'
      console.warn('[styled-image] 생성 실패', { path: location.pathname, input: '이미지 생성', modelId, completed, stage, error })
      if (alive.current) {
        setDirector(prev => prev?.key === directorKey ? { ...prev, failure: message, imageStarted: stage === 'generate', pendingJob: error instanceof PendingStudioImageError ? error.job : undefined, pendingTurnId: turnId, pendingPrompt: activePrompt } : prev)
        setNotice(`${completed ? `${completed}장은 완료되어 결과에 남아 있습니다. ` : ''}${message}`)
        if (turnAdded) setState((prev) => ({ ...prev, conversationUi: { ...conversation(prev), turns: conversation(prev).turns.map((item) => item.id === turnId ? { ...item, status: 'failed', error: message } : item) } }))
      }
    } finally {
      console.info('[styled-image] 생성 작업 종료', { path: location.pathname, input: '이미지 생성', modelId, completed, elapsedMs: Math.round(performance.now() - started) })
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

  if (!ready) return <div className="conversation-studio cs-docked"><p role="status">저장된 작업을 불러오고 있습니다…</p></div>
  return <div className="conversation-studio cs-docked">
    <header className="cs-header"><div className="cs-brand"><span className="cs-logo"><Layers3 size={23} /></span><div><span className="cs-eyebrow">ATELIER CREATIVE</span><h1>연출컷 스튜디오</h1></div></div><div className="cs-header-right"><span className="cs-save" role="status">● {saveStatus}</span><span className={"cs-badge" + (generating ? " cs-badge-running" : "")}>{generating ? "● 이미지 생성 중" : api ? "API 시험 생성" : "UI 미리보기"}</span></div></header>
    <div className="cs-prototype"><span>{api ? <><strong>등록된 API로 생성합니다.</strong> 모델을 선택하고 요청하세요. 생성 시 해당 제공자의 API 요금이 발생합니다.</> : <><strong>지금은 화면 체험 중이에요.</strong> 사진 분석·자동 도구 선택·이미지 생성은 연결되지 않았습니다.</>}</span><button onClick={() => setExample((value) => !value)} aria-expanded={example}>{example ? '예시 닫기' : '작업 예시 보기'} <ChevronRight size={14} /></button></div>
    {example && <section className="cs-example"><strong>이렇게 대화해요</strong><div>{['사진을 자유롭게 올리고 사용할 사진 체크', '디렉터에게 “이 제품으로 레퍼런스처럼 만들어줘”', '시안을 고르고 “끈만 자연스럽게” → 부분 수정', '같은 대화에서 “배경만 흰색으로” → 배경 변경'].map((text, index) => <p key={text}><b>{index + 1}</b>{text}</p>)}</div><small>{api ? "자료를 올리고 디렉터와 대화하면서 시안을 고르고 이어갑니다." : "필요한 자료와 작업 도구를 챙기는 흐름의 예시입니다. 실제 결과는 생성하지 않습니다."}</small></section>}
    <div className="cs-workspace">
      <div className="cs-workspace-main">
      <aside className="cs-sources cs-panel" inert={generating} aria-disabled={generating}>
        <StudioLibrary state={state} selected={additionalImages} busy={busy} editingId={infoId} filter={photoFilter} onFilter={setPhotoFilter} onSelect={selectPhoto} onUpload={files => void upload(files, 'edit')} onMention={mentionPhoto} onEdit={id => setInfoId(current => current === id ? null : id)} />
        <div className="cs-storage-note"><Check size={14} /><span>{api ? "시험 생성 자료는 현재 화면에만 유지됩니다. 결과는 내려받아 보관하세요." : "원본 사진과 작업 이력은 이 브라우저에 보관됩니다."}</span></div>
      </aside>
      {api ? <div className={"cs-model-picker cs-panel" + (pickerOpen ? " is-open" : "")}>
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
      </div> : <details className="cs-tool-details cs-panel"><summary><span>요청 이해 <ChevronRight size={12} /> 자료 선택 <ChevronRight size={12} /> 도구 연결</span><small>작동 방식 보기</small></summary><p>담당 AI가 요청과 사진을 해석하고, 필요한 작업 도구를 선택하는 구성입니다.</p><div className="cs-tool-grid">{(['background', 'create', 'detail'] as const).map((key) => <div key={key}><strong>{ACTIONS[key].tool}</strong><span>{ACTIONS[key].title}</span><small>미연결</small></div>)}</div><p className="cs-help">아래 체험에서는 요청의 일부 단어와 사진 역할로 정해진 예시를 표시합니다. 실제 AI 판단이나 전송이 아닙니다.</p></details>}
      <div className="cs-chat-column">
      <main className="cs-chat cs-panel">
        {!!state.versions.length && <div className="cs-thread-bar" aria-label="작업 이력"><button type="button" disabled={busy} onClick={() => { setContinueSelected(false); setRequest(''); input.current?.focus() }}><Plus size={13} />새 연출</button>{[...state.versions].reverse().map((version) => <button type="button" disabled={busy} className={'cs-thread-thumb' + (selected?.id === version.id ? ' is-selected' : '')} key={version.id} aria-label={version.title + ' 선택'} aria-pressed={selected?.id === version.id} onClick={() => { setState((prev) => ({ ...prev, selectedId: version.id })); setContinueSelected(true) }}>{version.resultId ? <img src={state.assets[version.resultId].data} alt="" /> : <Images size={14} />}<span>{version.resultId ? photoLabel(state.assets[version.resultId]) + " · " : ""}{version.title}{version.favorite ? ' ★' : ''}</span></button>)}</div>}
        <div className="cs-messages">
          {!ui.turns.length && <div className="cs-welcome"><span className="cs-welcome-icon"><WandSparkles size={28} strokeWidth={1.4} /></span><span className="cs-eyebrow">DIRECTOR</span><h2>디렉터에게 원하는 장면을<br />말해 주세요.</h2><p>사진을 올리고 사용할 사진을 체크하면<br />분석한 뒤 시안을 이 대화에 보여 줍니다.</p><button className="cs-starter" onClick={() => suggest(QUICK_REQUESTS[0].text)}><MessageCircle size={18} /><span>“사진 1의 가방을 조금 더 펼쳐줘.”</span><ArrowUp size={16} /></button><div className="cs-welcome-flow"><span>자료 올리기</span><ChevronRight size={13} /><span>디렉터에게 말하기</span><ChevronRight size={13} /><span>시안에서 이어가기</span></div></div>}
          {ui.turns.map((turn) => <section className="cs-turn" key={turn.id}><div className="cs-user-message">{turn.parentId && <small>↳ {state.versions.find((item) => item.id === turn.parentId)?.title ?? '선택한 컷'}에서 이어서</small>}<p>{turn.request}</p>{turn.imageRoles && <div className="cs-sent-images" aria-label="이번 요청에 전달한 이미지">{turn.assetIds.map((id) => state.assets[id] && <figure key={id}><img src={state.assets[id].data} alt={photoLabel(state.assets[id])} /><figcaption>{photoLabel(state.assets[id])}</figcaption></figure>)}</div>}</div><div className="cs-assistant-message"><span className="cs-mini-avatar"><Sparkles size={14} /></span><div><div className="cs-reply-title"><strong>{ACTIONS[turn.action].title}</strong><span>{turn.modelId ? STYLED_IMAGE_MODELS.find((model) => model.id === turn.modelId)?.label ?? turn.modelId : "응답 예시"}</span></div><p>{turn.modelId ? turn.status === "generating" ? progress || "생성 중…" : turn.status === "failed" ? turn.error : "생성이 완료되었습니다. 결과를 선택해 이어서 수정할 수 있습니다." : ACTIONS[turn.action].description + "이에요. 연결 후에는 이곳에서 결과를 받고 이어서 수정할 수 있습니다."}</p>{turn.director && <div className="cs-director-summary"><strong>디렉터의 연출 계획</strong><p>{turn.director.summary}</p><details><summary>사용한 상세 지시문</summary><p className="cs-director-text">{turn.director.prompt}</p></details><small>{turn.settings?.resolution} · {turn.modelId === "gemini-3-pro-image" ? "JPEG" : turn.settings?.quality}</small></div>}<div className="cs-keep"><Check size={13} />{turn.parentId && turn.imageRoles ? turn.imageRoles.includes("편집 대상") ? "체크한 편집 대상과 참고 사진으로 작업" : "체크한 참고 사진과 이번 요청으로 작업" : ACTIONS[turn.action].keep}</div><details className="cs-packet"><summary><Paperclip size={13} /> 참고자료 {turn.assetIds.length}장 · {turn.modelId ? STYLED_IMAGE_MODELS.find((model) => model.id === turn.modelId)?.label : ACTIONS[turn.action].tool}<ChevronRight size={13} /></summary><p className="cs-help">{turn.modelId ? "생성 요청에 사용한 참고자료입니다." : "전달 구성 예시 · 실제로 전송되지 않았습니다."}</p><div className="cs-packet-photos">{turn.assetIds.map((id) => state.assets[id] && <figure key={id}><img src={state.assets[id].data} alt="" /><figcaption>{photoLabel(state.assets[id])}</figcaption></figure>)}</div><p className="cs-help">{turn.assetIds.some(id => photoNote(state.assets[id])) ? turn.assetIds.map(id => photoNote(state.assets[id]) && <span key={id}>{photoLabel(state.assets[id])}: {photoNote(state.assets[id])}<br /></span>) : turn.productSnapshot?.length ? turn.productSnapshot.map(p => <span key={p.id}>{productDescription(p)}<br /></span>) : '사진 설명 없음'} · 비율: {turn.ratio}</p></details><div className="cs-inline-results">{turn.versionIds.map((id) => { const version = state.versions.find((item) => item.id === id); return version && (version.resultId ? <StudioImagePreview key={id} asset={state.assets[version.resultId]} title={`${photoLabel(state.assets[version.resultId])} · ${version.title}`} disabled={busy} selected={state.selectedId === id} onSelect={() => { setState((prev) => ({ ...prev, selectedId: id })); setContinueSelected(true) }} /> : <button key={id} disabled={busy} aria-label={version.title + ' 선택'} onClick={() => { setState((prev) => ({ ...prev, selectedId: id })); setContinueSelected(true) }}><span className="cs-mini-placeholder"><Images size={22} /><small>이미지 미생성</small></span><strong>{version.title}</strong></button>) })}</div>{selected && turn.versionIds.includes(selected.id) ? resultActions(selected) : null}<small className="cs-help">{turn.modelId ? "마음에 드는 컷을 고르면 이 대화에서 이어서 수정할 수 있습니다. 원단·로고·끈 연결·비율을 원본과 비교해 주세요." : "결과 자리만 표시했습니다. 고른 컷에 테스트 사진을 올릴 수 있어요."}</small></div></div></section>)}
          {generating && <div className="cs-assistant-message cs-generation-turn"><span className="cs-mini-avatar"><Sparkles size={14} /></span><div><StudioGenerationProgress model={progress.startsWith('디렉터') ? directorLabel : imageModelLabel} progress={progress} /></div></div>}
          {currentDirector && !generating && <section className="cs-director-review"><strong>{director?.failure ? (director.imageStarted ? '이미지 생성 응답을 받지 못했습니다' : '생성 요청을 확인해 주세요') : '디렉터의 연출 계획'}</strong>{director?.failure && <div className="cs-generation-error" role="alert"><p>{director.failure}</p><small>{director.pendingJob ? '아래 버튼은 이미 접수된 작업의 결과만 확인합니다. 새 이미지를 생성하지 않습니다.' : director.imageStarted ? '디렉터 분석은 완료됐습니다. 아래 버튼은 이미지를 새로 요청하며 추가 요금이 발생할 수 있습니다.' : '아래 내용을 확인한 뒤 다시 요청해 주세요.'}</small></div>}<p>{currentDirector.summary}</p>{currentDirector.question ? <p role="alert">{currentDirector.question}<br />아래 요청창에 답을 덧붙여 주세요.</p> : <><details open={reviewFirst}><summary>상세 지시문 확인·수정</summary><textarea aria-label="디렉터 상세 지시문" rows={7} maxLength={8000} disabled={busy || !!director?.pendingJob} value={currentDirector.prompt} onChange={(event) => setDirector({ key: directorKey, plan: { ...currentDirector, prompt: event.target.value } })} /><small>제품 보존 기준과 원래 요청은 이 지시문과 함께 전달됩니다.</small></details><button className="cs-primary" disabled={busy || editSelectionEmpty || !currentDirector.prompt.trim() || (!director?.pendingJob && (checkingModels || availability.find((item) => item.modelId === modelId)?.available !== true))} onClick={() => void generate(true)}>{director?.pendingJob ? '진행 중인 이미지 결과 확인' : director?.failure && director.imageStarted ? '같은 지시문으로 새 이미지 요청' : '이 지시문으로 이미지 생성'} <ArrowUp size={16} /></button></>}<small>{director?.pendingJob ? '접수된 작업은 기존 지시문과 화질로 진행됩니다. 결과를 확인한 뒤 다음 수정을 요청해 주세요.' : '요청·사진·설정을 바꾸면 다시 분석합니다.'}</small></section>}
          {notice && !generating && !director?.failure && <div className="cs-request-notice" role="status">{notice}<button aria-label="알림 닫기" onClick={() => setNotice('')}><X size={16} /></button></div>}
          <div ref={latest} />
        </div>
      </main>
      </div>
      <div className="cs-dock cs-panel">
        <fieldset disabled={busy} className={"cs-composer-wrap cs-request-fieldset" + (generating ? " is-generating" : "")} aria-label="이미지 생성 요청" aria-busy={generating}>{parent && <div className="cs-context"><span><Layers3 size={14} />{parent.title}에서 이어서 <small>{parent.resultId ? '사용할 이미지를 직접 선택' : '결과 없는 흐름 예시'}</small></span><button aria-label="선택한 컷에서 이어가기 해제" onClick={() => setContinueSelected(false)}><X size={14} /></button></div>}<div className="cs-request-attachments"><strong>이번 요청 · {Object.keys(additionalImages ?? {}).length}장</strong>{Object.keys(additionalImages ?? {}).map(id => state.assets[id] && <button key={id} type="button" onClick={() => selectPhoto(id, false)}>{photoLabel(state.assets[id])} ×</button>)}</div>{missingPhotoMentions(state, request, Object.keys(additionalImages ?? {})).length > 0 && <p role="alert" className="cs-help">요청에 적은 {missingPhotoMentions(state, request, Object.keys(additionalImages ?? {})).map(n => '사진 ' + n).join(', ')}이 첨부되지 않았습니다. 위에서 체크하거나 번호를 수정해 주세요.</p>}<div className="cs-quick-prompts">{QUICK_REQUESTS.map((item) => <button key={item.label} onClick={() => suggest(item.text)}>{item.label}</button>)}</div><div className="cs-composer"><textarea ref={input} disabled={busy} aria-label="AI에게 요청" rows={2} value={request} onChange={(event) => { setRequest(event.target.value); caret.current = event.target.selectionStart ?? event.target.value.length }} onSelect={rememberCaret} onClick={rememberCaret} onKeyUp={rememberCaret} onBlur={rememberCaret} placeholder={parent ? '이 컷에서 바꾸고 싶은 부분을 말해 주세요.' : '이 제품으로 레퍼런스처럼 연출컷을 만들어줘.'} /><div className="cs-composer-bottom"><div><label>비율<select aria-label="화면 비율" disabled={busy} value={state.form.outputRatio} onChange={(event) => field('outputRatio', event.target.value as FormState['outputRatio'])}>{OUTPUT_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label><label>장 수<select aria-label="시안 수" value={parent ? '1' : count} disabled={busy || !!parent} onChange={(event) => setCount(event.target.value)}>{['1', '2', '3', '4'].map((value) => <option key={value} value={value}>{value}장</option>)}</select></label></div><button className="cs-primary" disabled={!request.trim() || editSelectionEmpty || busy || invalidNumbers || (!!api && (checkingModels || availability.find((item) => item.modelId === modelId)?.available !== true))} onClick={api ? () => void generate() : preview}>{api ? busy ? progress || "처리 중…" : reviewFirst ? "디렉터 지시문 만들기" : "이미지 생성" : "요청 흐름 체험"} <ArrowUp size={16} /></button></div></div><p className="cs-composer-note">{editSelectionEmpty ? '이번 요청에 사용할 이미지를 체크해 주세요.' : api ? '사진과 요청을 OpenAI 디렉터와 선택한 이미지 제공자에 전송합니다. 여러 장은 한 장씩 생성하며 실패 시 자동 재시도하지 않습니다.' : '화면 체험용입니다. AI 호출·이미지 생성·요금 발생이 없습니다.'}</p></fieldset>
      </div>
      </div>
      {infoId && state.assets[infoId] && <>
        <button type="button" className="cs-info-backdrop" aria-label="정보 패널 닫기" onClick={() => setInfoId(null)} />
        <StudioPhotoInfo state={state} assetId={infoId} busy={busy} onState={setState} onClose={() => setInfoId(null)} />
      </>}
    </div>
    <footer className="cs-footer">{api ? "시험 생성 결과는 자동 저장되지 않습니다. 새로고침하거나 작업을 닫기 전에 결과를 내려받아 주세요." : "현재 기기·브라우저에만 저장됩니다. 브라우저 데이터를 삭제하면 자료와 이력이 사라집니다."}</footer>
  </div>
}
