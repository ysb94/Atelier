import type { DirectorPlan, ImageSettings } from '../../../supabase/functions/_shared/styled-image-core'
import { buildStyledCutsPrompt, createInitialForm, type FormState, type ImageSlot, type ProductPhotoKey, type ExplorationKey } from './styled-cuts'
import { normalizeStudioUpload } from './studio-image-processing'

export type StudioProduct = { id: string; name: string; width: string; height: string; depth: string; unit: 'cm' | 'mm'; material: string; basis: string; state: string }
export type StudioAsset = { id: string; name: string; type: string; data: string; photoNo?: number; productIds?: string[]; note?: string }
export type StudioWorkflow = 'preserve' | 'explore'
// Records without modelId are legacy UI rehearsals, not generated results.
export type StudioPreviewTurn = {
  productSnapshot?: StudioProduct[]
  imageRoles?: string[]
  id: string; request: string; action: 'create' | 'background' | 'angle' | 'detail'
  assetIds: string[]; versionIds: string[]; parentId?: string
  productName: string; material: string; dimensions: string; ratio: string
  director?: DirectorPlan; settings?: ImageSettings
  modelId?: string; status?: 'generating' | 'complete' | 'failed' | 'paused'; error?: string
}
export type StudioVersion = {
  productSnapshot?: StudioProduct[]
  id: string; title: string; parentId?: string; created: string; request: string
  prompt: string; assetIds: string[]; resultId?: string; favorite: boolean
  workflow?: StudioWorkflow
  previewOnly?: boolean
  director?: DirectorPlan; settings?: ImageSettings
  modelId?: string
  inputRoles?: Record<string, string>
  productInfo?: string
}
export type StudioState = {
  nextPhotoNumber?: number
  products?: Record<string, StudioProduct>
  editInputs?: Record<string, Record<string, string>>
  schema: 1; form: FormState; assets: Record<string, StudioAsset>
  product: Partial<Record<ProductPhotoKey, string>>
  references: Partial<Record<ExplorationKey, string[]>>
  versions: StudioVersion[]; selectedId: string | null
  conversationUi?: { sampleIds: string[]; roles: Record<string, string>; turns: StudioPreviewTurn[] }
}
export function newStudio(): StudioState {
  return { schema: 1, form: { ...createInitialForm(), referenceMode: 'explore' }, assets: {}, product: {}, references: {}, versions: [], selectedId: null }
}
export function studioInputs(state: StudioState) {
  const refs = Object.values(state.references).flat()
  return [...new Set([...Object.values(state.product), ...refs].filter((id): id is string => !!id))]
}
function imageSlot(asset: StudioAsset): ImageSlot {
  return { id: asset.id, url: asset.data, file: new File([], asset.name, { type: asset.type }) }
}
export function studioPrompt(state: StudioState) {
  const products = Object.fromEntries(Object.entries(state.product).filter(([, id]) => id && state.assets[id]).map(([key, id]) => [key, imageSlot(state.assets[id!])]))
  const refs = Object.fromEntries(Object.entries(state.references).map(([key, ids]) => [key, ids.filter((id) => state.assets[id]).map((id) => imageSlot(state.assets[id]))]))
  return buildStyledCutsPrompt(state.form, products, null, {}, refs)
}
export function createStudioDrafts(state: StudioState): StudioState {
  const prompt = studioPrompt(state)
  if (!prompt) return state
  const batch = state.versions.filter((item) => !item.parentId).length
  const versions = Array.from({ length: Number(state.form.variationCount) }, (_, index): StudioVersion => ({
    id: crypto.randomUUID(), title: `시안 ${batch + index + 1}`, created: new Date().toISOString(), request: state.form.referenceChanges || '참고 후보에서 자유롭게 연출',
    prompt, assetIds: studioInputs(state), favorite: false,
  }))
  return { ...state, versions: [...state.versions, ...versions], selectedId: versions[0].id }
}
export function reviseStudio(state: StudioState, request: string): StudioState {
  const parent = state.versions.find((item) => item.id === state.selectedId)
  if (!parent?.resultId || !request.trim()) return state
  const result = state.assets[parent.resultId]
  const version: StudioVersion = {
    id: crypto.randomUUID(), title: `${parent.title.split(' · ')[0]} · 수정 ${state.versions.filter((item) => item.parentId).length + 1}`,
    parentId: parent.id, created: new Date().toISOString(), request: request.trim(), favorite: false, workflow: parent.workflow ?? 'explore',
    assetIds: [...new Set([...parent.assetIds, parent.resultId])],
    prompt: `이번 요청: 선택한 결과 이미지 1장 수정\n편집 대상: ${result.name}\n수정할 내용: ${request.trim()}\n아래 이전 작업에는 여러 시안 생성 요청이 있어도 이번에는 편집 대상 하나를 수정한 독립 이미지 1장만 출력하세요. 콜라주·분할 화면은 사용하지 마세요.\n편집 대상의 나머지 배경·구도·연출은 유지하세요. 원본 제품 사진을 함께 확인해 제품 정체성·소재·로고·실제 크기는 보존하세요. 이전 생성 이미지에서 제품이 달라졌다면 원본 제품 사진을 우선하세요.\n\n이전 작업의 자료와 지시 (이번 수정과 충돌하는 연출 지시는 이번 요청 우선):\n${parent.prompt}`,
  }
  return { ...state, versions: [...state.versions, version], selectedId: version.id }
}

// Original files stay on this device; no network or account storage is involved.
export async function readStudioAsset(file: File): Promise<StudioAsset> {
  const processed = await normalizeStudioUpload(file)
  return { id: crypto.randomUUID(), name: file.name, type: processed.type, data: processed.data }
}

const DB_NAME = 'atelier-styled-studio-v1'
async function openStudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('workspace')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('다른 창에서 저장소를 사용하고 있습니다.'))
  })
}
export async function loadStudio(): Promise<StudioState | null> {
  const db = await openStudioDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('workspace').objectStore('workspace').get('current')
      request.onsuccess = () => {
        const value = request.result
        if (value && (value.schema !== 1 || !Array.isArray(value.versions) || !value.assets || !value.form || !value.product || !value.references)) reject(new Error('저장된 작업 형식을 확인할 수 없습니다.'))
        else resolve(value ?? null)
      }
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
export async function saveStudio(state: StudioState) {
  const db = await openStudioDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite')
      const started = performance.now()
      tx.objectStore('workspace').put(state, 'current')
      const elapsedMs = performance.now() - started
      if (elapsedMs >= 200) console[elapsedMs >= 1000 ? 'warn' : 'info']('[styled-studio] 저장 자료 복사 지연', { path: location.pathname, elapsedMs, photos: Object.keys(state.assets).length })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('저장이 중단되었습니다.'))
    })
  } finally { db.close() }
}
