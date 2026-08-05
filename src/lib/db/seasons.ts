import {
  LEGACY_SEASON_STATUS_MAP,
  formatSeasonLabel,
  type Season,
  type SeasonInput,
} from '@/lib/types'
import {
  META_STORE,
  SEASONS_STORE,
  idbRequest,
  openDb,
  withStore,
} from '@/lib/db/client'
import { SEED_SEASONS } from '@/lib/db/seed-catalog'

const SEED_FLAG_KEY = 'seasons_seeded_v1'

let seedPromise: Promise<void> | null = null

async function ensureSeeded() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const meta = await withStore(META_STORE, 'readonly', (store) =>
        idbRequest<{ key: string; value: boolean } | undefined>(
          store.get(SEED_FLAG_KEY),
        ),
      )
      if (meta?.value) return

      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([SEASONS_STORE, META_STORE], 'readwrite')
        const seasonsStore = tx.objectStore(SEASONS_STORE)
        const metaStore = tx.objectStore(META_STORE)
        for (const season of SEED_SEASONS) {
          seasonsStore.put(normalizeSeason(season))
        }
        metaStore.put({ key: SEED_FLAG_KEY, value: true })
        tx.oncomplete = () => resolve()
        tx.onerror = () =>
          reject(tx.error ?? new Error('Season seed failed'))
      })
    })().catch((error) => {
      seedPromise = null
      throw error
    })
  }
  return seedPromise
}

function newSeasonId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `season-${crypto.randomUUID()}`
  }
  return `season-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export class SeasonStoreError extends Error {
  readonly code: 'not_found' | 'invalid' | 'in_use' | 'duplicate'

  constructor(
    message: string,
    code: 'not_found' | 'invalid' | 'in_use' | 'duplicate',
  ) {
    super(message)
    this.name = 'SeasonStoreError'
    this.code = code
  }
}

/** 출시 예정 문구에서 연도를 찾는다. 26.03 → 2026, 2026년 → 2026 */
export function extractYearFromTiming(
  timing: string,
  fallback = new Date().getFullYear(),
): number {
  const text = timing.trim()
  const full = text.match(/(20\d{2})/)
  if (full) return Number(full[1])
  const short = text.match(/(?:^|[^\d])(\d{2})(?:[.\-/]|\s|$)/)
  if (short) {
    const yy = Number(short[1])
    if (Number.isFinite(yy)) return 2000 + yy
  }
  return fallback
}

/**
 * URL·가져오기 호환용 짧은 코드.
 * 사용자가 직접 정하지 않으며, 같은 브랜드 안에서만 유일하면 된다.
 */
export function buildSeasonCode(name: string, releaseTiming: string): string {
  const timing = releaseTiming.trim()
  const label = name.trim()
  const year = extractYearFromTiming(timing)
  const yy = String(year).slice(-2)

  const slug = [timing, label]
    .filter(Boolean)
    .join('-')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z가-힣._-]/g, '')
    .slice(0, 24)

  if (slug) {
    // 영문·숫자만 있으면 대문자로, 아니면 그대로
    const asciiOnly = /^[0-9A-Za-z._-]+$/.test(slug)
    return asciiOnly ? slug.toUpperCase() : slug
  }

  return `PG-${yy}${Date.now().toString(36).slice(-4).toUpperCase()}`
}

export function normalizeSeason(raw: Season | (Partial<Season> & { id: string; brandId: string })): Season {
  const name = (raw.name ?? '').trim() || (raw.code ?? '').trim() || '출시 기획'
  const code = (raw.code ?? '').trim() || buildSeasonCode(name, raw.releaseTiming ?? '')
  const releaseTiming =
    (raw.releaseTiming ?? '').trim() ||
    // 예전 시드(26SS + 2026 Spring/Summer)는 코드만 보이게
    (raw.code && raw.code !== name ? raw.code : '')
  const year =
    typeof raw.year === 'number' && Number.isFinite(raw.year)
      ? Math.trunc(raw.year)
      : extractYearFromTiming(releaseTiming)
  const status = LEGACY_SEASON_STATUS_MAP[raw.status ?? ''] ?? 'active'

  return {
    id: raw.id,
    brandId: raw.brandId,
    code,
    name,
    releaseTiming,
    year,
    status,
  }
}

function ensureUniqueCode(
  desired: string,
  siblings: Season[],
  excludeId?: string,
): string {
  const taken = new Set(
    siblings
      .filter((s) => s.id !== excludeId)
      .map((s) => s.code.toUpperCase()),
  )
  if (!taken.has(desired.toUpperCase())) return desired

  let n = 2
  while (taken.has(`${desired}-${n}`.toUpperCase())) n += 1
  return `${desired}-${n}`
}

export async function listSeasons(brandId: string): Promise<Season[]> {
  await ensureSeeded()
  const rows = await withStore(SEASONS_STORE, 'readonly', (store) => {
    const index = store.index('brandId')
    return idbRequest<Season[]>(index.getAll(brandId))
  })
  return [...rows]
    .map(normalizeSeason)
    .sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      const labelA = formatSeasonLabel(a)
      const labelB = formatSeasonLabel(b)
      return labelA.localeCompare(labelB, 'ko')
    })
}

export async function getSeasonById(id: string): Promise<Season | undefined> {
  await ensureSeeded()
  const row = await withStore(SEASONS_STORE, 'readonly', (store) =>
    idbRequest<Season | undefined>(store.get(id)),
  )
  return row ? normalizeSeason(row) : undefined
}

export async function createSeason(
  brandId: string,
  input: SeasonInput,
): Promise<Season> {
  await ensureSeeded()
  const name = input.name.trim()
  const releaseTiming = input.releaseTiming.trim()
  if (!name) {
    throw new SeasonStoreError('기획 이름을 입력하세요.', 'invalid')
  }

  const existing = await listSeasons(brandId)
  const baseCode = buildSeasonCode(name, releaseTiming)
  const code = ensureUniqueCode(baseCode, existing)
  const year = extractYearFromTiming(releaseTiming)

  const season: Season = {
    id: newSeasonId(),
    brandId,
    code,
    name,
    releaseTiming,
    year,
    status: input.status ?? 'active',
  }

  await withStore(SEASONS_STORE, 'readwrite', (store) => {
    store.add(season)
    return season
  })
  return season
}

export async function updateSeason(
  id: string,
  input: SeasonInput,
): Promise<Season> {
  await ensureSeeded()
  const existing = await getSeasonById(id)
  if (!existing) {
    throw new SeasonStoreError('출시 기획을 찾을 수 없습니다.', 'not_found')
  }

  const name = input.name.trim()
  const releaseTiming = input.releaseTiming.trim()
  if (!name) {
    throw new SeasonStoreError('기획 이름을 입력하세요.', 'invalid')
  }

  const siblings = await listSeasons(existing.brandId)
  // 이름·출시 예정이 바뀌면 호환 코드도 다시 맞춘다. 기존 URL 탭은 id가 아니라 code 기반이라
  // 바뀔 수 있지만, 기획팀이 쓰는 표시가 우선이다.
  const baseCode = buildSeasonCode(name, releaseTiming)
  const code = ensureUniqueCode(baseCode, siblings, id)
  const year = extractYearFromTiming(releaseTiming, existing.year)

  const next: Season = {
    ...existing,
    code,
    name,
    releaseTiming,
    year,
    status: input.status ?? existing.status,
  }

  await withStore(SEASONS_STORE, 'readwrite', (store) => {
    store.put(next)
    return next
  })
  return next
}

export async function deleteSeason(
  id: string,
  options?: { styleCount?: number; draftCount?: number },
): Promise<void> {
  await ensureSeeded()
  const existing = await getSeasonById(id)
  if (!existing) {
    throw new SeasonStoreError('출시 기획을 찾을 수 없습니다.', 'not_found')
  }
  if ((options?.styleCount ?? 0) > 0) {
    throw new SeasonStoreError(
      '이 출시 기획을 쓰는 상품이 있어 삭제할 수 없습니다.',
      'in_use',
    )
  }
  if ((options?.draftCount ?? 0) > 0) {
    throw new SeasonStoreError(
      '이 출시 기획을 쓰는 기획안이 있어 삭제할 수 없습니다.',
      'in_use',
    )
  }
  await withStore(SEASONS_STORE, 'readwrite', (store) => {
    store.delete(id)
  })
}
