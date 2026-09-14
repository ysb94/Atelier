import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronRight, ImagePlus, Images, Layers3, MessageCircle, Paperclip, Plus, Sparkles, WandSparkles, X } from 'lucide-react'
import { OUTPUT_RATIOS, PRODUCT_PHOTO_SLOTS, type FormState } from '../../lib/design/styled-cuts'
import { loadStudio, newStudio, readStudioAsset, saveStudio, type StudioAsset, type StudioPreviewTurn, type StudioState, type StudioVersion } from '../../lib/design/styled-studio'
import { useRenderWatch } from '../../lib/diagnostics/render-watch'
import './styled-studio.css'

const ROLES = ['제품 사진', '제품 기준', '원단 디테일', '끈·구조', '크기 비교']
const ACTIONS = {
  create: { title: '새로운 연출 만들기', tool: 'Nano Banana Pro', description: '제품 사진과 레퍼런스로 새로운 장면을 구성하는 작업', keep: '원본 제품의 형태·색상·소재를 기준으로 연출' },
  background: { title: '배경 바꾸기', tool: 'Photoroom', description: '선택한 컷의 제품 모습을 활용해 배경을 바꾸는 작업', keep: '제품 모습과 구도 유지 · 요청한 배경만 변경' },
  angle: { title: '다른 구도 만들기', tool: 'Nano Banana Pro', description: '원본 제품을 함께 참고해 다른 방향의 연출을 만드는 작업', keep: '제품 정체성과 현재 배경 유지 · 구도 변경' },
  detail: { title: '부분 수정하기', tool: 'Adobe Firefly', description: '선택한 컷에서 요청한 부분을 수정하는 작업', keep: '선택한 컷 기준 · 요청한 부분 외의 연출 유지' },
}
const QUICK_REQUESTS = [
  { label: '레퍼런스처럼 만들어줘', text: '이 제품으로 레퍼런스처럼 연출컷을 만들어줘.' },
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

export function StyledStudio() {
  useRenderWatch('StyledStudio')
  const [state, setState] = useState<StudioState>(newStudio)
  const [ready, setReady] = useState(false)
  const [storageEnabled, setStorageEnabled] = useState(true)
  const [saveStatus, setSaveStatus] = useState('불러오는 중')
  const [request, setRequest] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [continueSelected, setContinueSelected] = useState(false)
  const [count, setCount] = useState('2')
  const [example, setExample] = useState(false)
  const alive = useRef(true)
  const saveQueue = useRef(Promise.resolve())
  const saveSequence = useRef(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const latest = useRef<HTMLDivElement>(null)

  useEffect(() => {
    alive.current = true
    let cancelled = false
    loadStudio().then((saved) => { if (!cancelled && saved) setState(saved) }).catch((error) => {
      console.warn('[styled-studio] 작업 복원 실패', { path: location.pathname, error })
      if (!cancelled) { setStorageEnabled(false); setNotice('저장된 작업을 불러오지 못했습니다. 기존 저장 내용은 덮어쓰지 않습니다.'); setSaveStatus('자동 저장 중지') }
    }).finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true; alive.current = false }
  }, [])
  useEffect(() => {
    if (!ready || !storageEnabled) return
    const sequence = ++saveSequence.current
    setSaveStatus('저장 중…')
    saveQueue.current = saveQueue.current.then(() => saveStudio(state)).then(() => {
      if (alive.current && sequence === saveSequence.current) setSaveStatus('이 브라우저에 저장됨')
    }).catch((error) => {
      console.warn('[styled-studio] 작업 저장 실패', { path: location.pathname, error })
      if (alive.current) { setSaveStatus('저장 실패'); setNotice('작업을 저장하지 못했습니다. 새로고침 전 사진과 결과를 따로 보관해 주세요.') }
    })
  }, [state, ready, storageEnabled])

  const ui = conversation(state)
  const products = productIds(state)
  const references = referenceIds(state)
  const selected = state.versions.find((item) => item.id === state.selectedId)
  const selectedImage = selected?.resultId ? state.assets[selected.resultId] : undefined
  const parent = continueSelected ? selected : undefined
  const invalidNumbers = (['sizeWidth', 'sizeHeight', 'sizeDepth'] as const).some((key) => state.form[key].trim() && (!Number.isFinite(Number(state.form[key])) || Number(state.form[key]) <= 0))
  function field<K extends keyof FormState>(key: K, value: FormState[K]) { setState((prev) => ({ ...prev, form: { ...prev.form, [key]: value } })) }
  async function upload(files: FileList | null, target: 'product' | 'reference' | 'result', versionId?: string) {
    if (!files?.length) return
    const picked = Array.from(files)
    setBusy(true); setNotice('')
    try {
      const assets: StudioAsset[] = []
      for (const file of target === 'product' ? picked : picked.slice(0, 1)) assets.push(await readStudioAsset(file))
      if (!alive.current) return
      setState((prev) => {
        const next = { ...prev, assets: { ...prev.assets, ...Object.fromEntries(assets.map((asset) => [asset.id, asset])) } }
        if (target === 'product') next.conversationUi = { ...conversation(prev), sampleIds: [...conversation(prev).sampleIds, ...assets.map((asset) => asset.id)] }
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
  function picker(label: string, target: 'product' | 'reference' | 'result', versionId?: string) {
    return <label className="cs-upload"><ImagePlus size={22} /><strong>{label}</strong><small>{target === 'product' ? '여러 장 한 번에 · JPG, PNG, WEBP' : 'JPG, PNG, WEBP · 한 장 25MB 이하'}</small><input aria-label={label} disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" multiple={target === 'product'} onChange={(event) => { void upload(event.target.files, target, versionId); event.target.value = '' }} /></label>
  }
  function removeProduct(id: string) {
    setState((prev) => ({ ...prev, product: Object.fromEntries(Object.entries(prev.product).filter(([, value]) => value !== id)), conversationUi: { ...conversation(prev), sampleIds: conversation(prev).sampleIds.filter((value) => value !== id) } }))
  }
  function suggest(text: string) { setRequest(text); input.current?.focus() }
  function preview() {
    if (!request.trim() || !products.length || (!references.length && !parent) || invalidNumbers || busy) return
    // Deterministic UI example, NOT a model/router. No network, image analysis or prompt execution.
    const action: StudioPreviewTurn['action'] = !parent ? 'create' : /부분|끈만|원단|소재|로고|그림자/.test(request) ? 'detail' : /배경만|배경을.*(바꿔|변경|교체)/.test(request) ? 'background' : /구도로|각도로|옆에서|다른 구도|방향/.test(request) ? 'angle' : 'detail'
    const anchor = products.find((id) => roleOf(state, id) === '제품 기준') ?? products[0]
    const detailRole = /원단|소재/.test(request) ? '원단 디테일' : '끈·구조'
    const supporting = products.filter((id) => action === 'create' || action === 'angle' || (action === 'detail' && roleOf(state, id) === detailRole))
    const assetIds = [...new Set([anchor, ...supporting, ...(action === 'create' || action === 'background' ? references : []), ...(parent?.resultId ? [parent.resultId] : [])])]
    const turnId = crypto.randomUUID()
    const versionIds = Array.from({ length: parent ? 1 : Number(count) }, () => crypto.randomUUID())
    const turn: StudioPreviewTurn = { id: turnId, request: request.trim(), action, assetIds, versionIds, parentId: parent?.id, productName: state.form.productName, material: state.form.fabricMaterial, dimensions: [state.form.sizeWidth, state.form.sizeHeight, state.form.sizeDepth].map((value) => value || '미입력').join(' × '), ratio: state.form.outputRatio }
    const versions: StudioVersion[] = versionIds.map((id, index) => ({ id, title: parent ? '수정 ' + (ui.turns.filter((item) => item.parentId).length + 1) : '시안 ' + (state.versions.filter((item) => !item.parentId).length + index + 1), parentId: parent?.id, created: new Date().toISOString(), request: request.trim(), prompt: '', assetIds, favorite: false, previewOnly: true }))
    setState((prev) => ({ ...prev, conversationUi: { ...conversation(prev), turns: [...conversation(prev).turns, turn] }, versions: [...prev.versions, ...versions], selectedId: versionIds[0] }))
    setRequest(''); setContinueSelected(false)
    requestAnimationFrame(() => latest.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  if (!ready) return <div className="conversation-studio"><p role="status">저장된 작업을 불러오고 있습니다…</p></div>
  return <div className="conversation-studio">
    <header className="cs-header"><div className="cs-brand"><span className="cs-logo"><Layers3 size={23} /></span><div><span className="cs-eyebrow">ATELIER CREATIVE</span><h1>연출컷 스튜디오</h1></div></div><div className="cs-header-right"><span className="cs-save" role="status">● {saveStatus}</span><span className="cs-badge">UI 미리보기</span></div></header>
    <div className="cs-prototype"><span><strong>지금은 화면 체험 중이에요.</strong> 사진 분석·자동 도구 선택·이미지 생성은 연결되지 않았습니다.</span><button onClick={() => setExample((value) => !value)} aria-expanded={example}>{example ? '예시 닫기' : '작업 예시 보기'} <ChevronRight size={14} /></button></div>
    {example && <section className="cs-example"><strong>연결 후에는 이렇게 대화해요</strong><div>{['제품 사진 여러 장 + 레퍼런스 한 장 등록', '“이 제품으로 레퍼런스처럼 만들어줘” → 새로운 연출', '결과 선택 → “끈만 자연스럽게” → 부분 수정', '“이 상태에서 배경만 흰색으로” → 배경 변경'].map((text, index) => <p key={text}><b>{index + 1}</b>{text}</p>)}</div><small>필요한 자료와 작업 도구를 챙기는 흐름의 예시입니다. 실제 결과는 생성하지 않습니다.</small></section>}
    {notice && <div className="cs-notice" role="status">{notice}<button aria-label="알림 닫기" onClick={() => setNotice('')}><X size={16} /></button></div>}
    <div className="cs-workspace">
      <aside className="cs-sources cs-panel">
        <div className="cs-section-head"><div><span className="cs-eyebrow">01 / MATERIALS</span><h2>제품과 참고 자료</h2></div><Paperclip size={18} /></div>
        <p className="cs-description">한 번 등록하고, 대화로 이어가세요.</p>
        <label className="cs-field">제품명<input placeholder="예: 소프트 니트 숄더백" value={state.form.productName} onChange={(event) => field('productName', event.target.value)} /></label>
        <section className="cs-source-section"><div className="cs-section-label"><h3>제품 사진</h3><span>{products.length}장</span></div><p className="cs-help">같은 제품의 전체 모습과 디테일을 올려 주세요.</p>
          {picker('제품 사진 추가', 'product')}
          {!!products.length && <div className="cs-photo-grid">{products.map((id) => <div className="cs-photo" key={id}><img src={state.assets[id].data} alt={state.assets[id].name} /><button className="cs-remove" aria-label={state.assets[id].name + ' 제거'} onClick={() => removeProduct(id)}><X size={12} /></button><span title={state.assets[id].name}>{state.assets[id].name}</span><select aria-label={state.assets[id].name + ' 역할'} value={roleOf(state, id)} onChange={(event) => setState((prev) => ({ ...prev, conversationUi: { ...conversation(prev), roles: { ...conversation(prev).roles, [id]: event.target.value } } }))}>{[...new Set([...ROLES, roleOf(state, id)])].map((role) => <option key={role}>{role}</option>)}</select></div>)}</div>}
          {!!products.length && <p className="cs-help">현재는 사진을 분석하지 않아요. 역할 표시는 직접 바꿔볼 수 있습니다.</p>}
        </section>
        <section className="cs-source-section"><div className="cs-section-label"><h3>연출 레퍼런스</h3><span>원하는 분위기</span></div><p className="cs-help">따라 만들고 싶은 사진 한 장이면 시작할 수 있어요.</p>
          {references.map((id) => <div className="cs-reference" key={id}><img src={state.assets[id].data} alt={state.assets[id].name} /><span>{state.assets[id].name}</span><button className="cs-remove" aria-label={state.assets[id].name + ' 제거'} onClick={() => setState((prev) => ({ ...prev, references: Object.fromEntries(Object.entries(prev.references).map(([key, ids]) => [key, ids.filter((value) => value !== id)])) }))}><X size={14} /></button></div>)}
          {picker(references.length ? '레퍼런스 바꾸기' : '레퍼런스 추가', 'reference')}
        </section>
        <details className="cs-details"><summary>제품 정보 더하기 <small>선택</small></summary><label className="cs-field">원단 재질<input value={state.form.fabricMaterial} onChange={(event) => field('fabricMaterial', event.target.value)} placeholder="예: 부드러운 니트" /></label><span className="cs-field">실제 크기 <small>mm</small></span><div className="cs-dimensions">{(['sizeWidth', 'sizeHeight', 'sizeDepth'] as const).map((key, index) => <input key={key} type="number" min="0.01" step="any" aria-label={['가로', '세로', '폭'][index]} placeholder={['가로', '세로', '폭'][index]} value={state.form[key]} onChange={(event) => field(key, event.target.value)} />)}</div>{invalidNumbers && <p role="alert" className="cs-help">크기는 0보다 큰 숫자로 입력하거나 비워 주세요.</p>}</details>
        <div className="cs-storage-note"><Check size={14} /><span>원본 사진과 작업 이력은 이 브라우저에 보관됩니다.</span></div>
      </aside>

      <main className="cs-chat cs-panel">
        <div className="cs-chat-header"><div className="cs-assistant-avatar"><Sparkles size={19} /></div><div><h2>스튜디오 AI</h2><p>원하는 장면을 말하면, 작업에 맞는 도구로</p></div><span className="cs-badge">연결 전</span></div>
        <details className="cs-tool-details"><summary><span>요청 이해 <ChevronRight size={12} /> 자료 선택 <ChevronRight size={12} /> 도구 연결</span><small>작동 방식 보기</small></summary><p>담당 AI가 요청과 사진을 해석하고, 필요한 작업 도구를 선택하는 구성입니다.</p><div className="cs-tool-grid">{(['background', 'create', 'detail'] as const).map((key) => <div key={key}><strong>{ACTIONS[key].tool}</strong><span>{ACTIONS[key].title}</span><small>미연결</small></div>)}</div><p className="cs-help">아래 체험에서는 요청의 일부 단어와 사진 역할로 정해진 예시를 표시합니다. 실제 AI 판단이나 전송이 아닙니다.</p></details>
        <div className="cs-messages">
          {!ui.turns.length && <div className="cs-welcome"><span className="cs-welcome-icon"><WandSparkles size={28} strokeWidth={1.4} /></span><span className="cs-eyebrow">YOUR NEXT PRODUCT STORY</span><h2>사진은 준비됐나요?<br />이제 원하는 장면을 말해 주세요.</h2><p>제품 사진 여러 장과 레퍼런스 한 장.<br />어떤 AI를 쓸지 고민하지 않고 시작하는 작업 공간입니다.</p><button className="cs-starter" onClick={() => suggest(QUICK_REQUESTS[0].text)}><MessageCircle size={18} /><span>“이 제품으로 레퍼런스처럼 만들어줘.”</span><ArrowUp size={16} /></button><div className="cs-welcome-flow"><span>사진 등록</span><ChevronRight size={13} /><span>요청하기</span><ChevronRight size={13} /><span>고르고 수정하기</span></div></div>}
          {ui.turns.map((turn) => <section className="cs-turn" key={turn.id}><div className="cs-user-message">{turn.parentId && <small>↳ {state.versions.find((item) => item.id === turn.parentId)?.title ?? '선택한 컷'}에서 이어서</small>}<p>{turn.request}</p></div><div className="cs-assistant-message"><span className="cs-mini-avatar"><Sparkles size={14} /></span><div><div className="cs-reply-title"><strong>{ACTIONS[turn.action].title}</strong><span>응답 예시</span></div><p>{ACTIONS[turn.action].description}이에요. 연결 후에는 이곳에서 결과를 받고 이어서 수정할 수 있습니다.</p><div className="cs-keep"><Check size={13} />{ACTIONS[turn.action].keep}</div><details className="cs-packet"><summary><Paperclip size={13} /> 참고자료 {turn.assetIds.length}장 · {ACTIONS[turn.action].tool}<ChevronRight size={13} /></summary><p className="cs-help">전달 구성 예시 · 실제로 전송되지 않았습니다.</p><div className="cs-packet-photos">{turn.assetIds.map((id) => state.assets[id] && <figure key={id}><img src={state.assets[id].data} alt="" /><figcaption>{state.assets[id].name}</figcaption></figure>)}</div><p className="cs-help">제품: {turn.productName || '미입력'} · 소재: {turn.material || '미입력'}<br />크기: {turn.dimensions} mm · 비율: {turn.ratio}</p></details><div className="cs-inline-results">{turn.versionIds.map((id) => { const version = state.versions.find((item) => item.id === id); return version && <button key={id} className={state.selectedId === id ? 'is-selected' : ''} aria-label={version.title + ' 선택'} onClick={() => { setState((prev) => ({ ...prev, selectedId: id })); setContinueSelected(true) }}>{version.resultId ? <img src={state.assets[version.resultId].data} alt={version.title + ' 결과'} /> : <span className="cs-mini-placeholder"><Images size={22} /><small>이미지 미생성</small></span>}<strong>{version.title}</strong></button> })}</div><small className="cs-help">결과 자리만 표시했습니다. 오른쪽에서 테스트용 결과 사진을 등록할 수 있어요.</small></div></div></section>)}
          <div ref={latest} />
        </div>
        <div className="cs-composer-wrap">{parent && <div className="cs-context"><span><Layers3 size={14} />{parent.title}에서 이어서 <small>{parent.resultId ? '등록한 결과 기준' : '결과 없는 흐름 예시'}</small></span><button aria-label="선택한 컷에서 이어가기 해제" onClick={() => setContinueSelected(false)}><X size={14} /></button></div>}<div className="cs-quick-prompts">{QUICK_REQUESTS.map((item) => <button key={item.label} onClick={() => suggest(item.text)}>{item.label}</button>)}</div><div className="cs-composer"><textarea ref={input} aria-label="AI에게 요청" rows={3} value={request} onChange={(event) => setRequest(event.target.value)} placeholder={parent ? '이 컷에서 바꾸고 싶은 부분을 말해 주세요.' : '이 제품으로 레퍼런스처럼 연출컷을 만들어줘.'} /><div className="cs-composer-bottom"><div><label>비율<select aria-label="화면 비율" value={state.form.outputRatio} onChange={(event) => field('outputRatio', event.target.value as FormState['outputRatio'])}>{OUTPUT_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label><label>장 수<select aria-label="시안 수" value={parent ? '1' : count} disabled={!!parent} onChange={(event) => setCount(event.target.value)}>{['1', '2', '3', '4'].map((value) => <option key={value} value={value}>{value}장</option>)}</select></label></div><button className="cs-primary" disabled={!request.trim() || !products.length || (!references.length && !parent) || busy || invalidNumbers} onClick={preview}>요청 흐름 체험 <ArrowUp size={16} /></button></div></div><p className="cs-composer-note">{!products.length || (!references.length && !parent) ? '제품 사진과 레퍼런스를 등록하면 요청 흐름을 체험할 수 있어요.' : '화면 체험용입니다. AI 호출·이미지 생성·요금 발생이 없습니다.'}</p></div>
      </main>

      <aside className="cs-results cs-panel"><div className="cs-section-head"><div><span className="cs-eyebrow">02 / RESULTS</span><h2>결과와 이어가기</h2></div><span className="cs-count">{state.versions.length}</span></div>
        {!selected ? <div className="cs-results-empty"><div className="cs-blank-stack"><Images size={36} strokeWidth={1} /></div><h3>마음에 드는 컷에서<br />다음 작업을 이어가세요.</h3><p>연출 → 배경 변경 → 부분 수정<br />같은 대화 안에 차곡차곡.</p><span>생성 결과가 표시될 자리</span></div> : <div className="cs-selected"><div className="cs-section-label"><h3>{selected.title}</h3><span>{selectedImage ? '등록한 사진' : '결과 자리'}</span></div>{selectedImage ? <a className="cs-result-image" href={selectedImage.data} download={selectedImage.name}><img src={selectedImage.data} alt="선택한 결과" /><span>사진 내려받기 ↓</span></a> : <><div className="cs-result-empty"><Images size={32} /><strong>아직 생성된 이미지가 없어요</strong><span>UI에서 결과 자리를 확인하는 단계입니다.</span></div>{picker('테스트 결과 사진 등록', 'result', selected.id)}</>}
          <button className="cs-primary cs-full" onClick={() => { setContinueSelected(true); input.current?.focus() }}><MessageCircle size={15} />이 컷에서 대화 이어가기</button><button className="cs-favorite" aria-pressed={selected.favorite} onClick={() => setState((prev) => ({ ...prev, versions: prev.versions.map((item) => item.id === selected.id ? { ...item, favorite: !item.favorite } : item) }))}>{selected.favorite ? '★ 최종 후보에 담김' : '☆ 최종 후보로 담기'}</button>
          <details className="cs-details"><summary>원본과 비교하기</summary><div className="cs-compare">{products.slice(0, 4).map((id) => <img key={id} src={state.assets[id].data} alt={state.assets[id].name + ' 비교 원본'} />)}</div><p className="cs-help">원단 · 로고 · 끈 연결 · 제품 비율을 확인해 주세요.</p></details>
          {!!selected.prompt && <details className="cs-details"><summary>이전에 저장한 지시문</summary><textarea aria-label="이전에 저장한 지시문" readOnly rows={6} value={selected.prompt} /></details>}
        </div>}
        {!!state.versions.length && <div className="cs-history"><div className="cs-section-label"><h3>작업 이력</h3><button onClick={() => { setContinueSelected(false); setRequest(''); input.current?.focus() }}><Plus size={13} />새 연출</button></div>{[...state.versions].reverse().map((version) => <button className={'cs-history-item ' + (selected?.id === version.id ? 'is-selected' : '')} key={version.id} aria-label={version.title + ' 이력 선택'} onClick={() => { setState((prev) => ({ ...prev, selectedId: version.id })); setContinueSelected(true) }}><span className="cs-history-thumb">{version.resultId ? <img src={state.assets[version.resultId].data} alt="" /> : <Images size={17} />}</span><span><strong>{version.title}{version.favorite ? ' ★' : ''}</strong><small>{version.parentId ? '↳ ' + (state.versions.find((item) => item.id === version.parentId)?.title ?? '이전 컷') + '에서 수정' : '새로운 연출'}</small></span><ChevronRight size={13} /></button>)}</div>}
      </aside>
    </div><footer className="cs-footer">현재 기기·브라우저에만 저장됩니다. 브라우저 데이터를 삭제하면 자료와 이력이 사라집니다.</footer>
  </div>
}
