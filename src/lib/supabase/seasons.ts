import {
  formatSeasonLabel,
  type Season,
  type SeasonInput,
} from '@/lib/types'
import {
  buildSeasonCode,
  ensureUniqueSeasonCode,
  extractYearFromTiming,
  normalizeSeasonStatus,
} from '@/lib/seasons/codes'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, code, name, release_timing, year, status, created_at, updated_at'

type SeasonRow = {
  id: string
  brand_id: string
  code: string
  name: string
  release_timing: string
  year: number
  status: string
  created_at: string
  updated_at: string
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

function toSeason(row: SeasonRow): Season {
  return {
    id: row.id,
    brandId: row.brand_id,
    code: row.code,
    name: row.name,
    releaseTiming: row.release_timing,
    year: row.year,
    status: normalizeSeasonStatus(row.status),
  }
}

export async function listSeasons(brandId: string): Promise<Season[]> {
  const { data, error } = await getSupabase()
    .from('seasons')
    .select(COLUMNS)
    .eq('brand_id', brandId)

  if (error) {
    throw new SeasonStoreError(
      errorMessage(error, '출시 기획을 불러오지 못했습니다.'),
      'invalid',
    )
  }

  return (data as SeasonRow[])
    .map(toSeason)
    .sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      return formatSeasonLabel(a).localeCompare(formatSeasonLabel(b), 'ko')
    })
}

export async function getSeasonById(id: string): Promise<Season | undefined> {
  const { data, error } = await getSupabase()
    .from('seasons')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new SeasonStoreError(
      errorMessage(error, '출시 기획을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return data ? toSeason(data as SeasonRow) : undefined
}

export async function createSeason(
  brandId: string,
  input: SeasonInput,
): Promise<Season> {
  const name = input.name.trim()
  const releaseTiming = input.releaseTiming.trim()
  if (!name) {
    throw new SeasonStoreError('기획 이름을 입력하세요.', 'invalid')
  }

  const existing = await listSeasons(brandId)
  const code = ensureUniqueSeasonCode(
    buildSeasonCode(name, releaseTiming),
    existing,
  )
  const year = extractYearFromTiming(releaseTiming)

  const { data, error } = await getSupabase()
    .from('seasons')
    .insert({
      brand_id: brandId,
      code,
      name,
      release_timing: releaseTiming,
      year,
      status: input.status ?? 'active',
    })
    .select(COLUMNS)
    .single()

  if (error) {
    throw new SeasonStoreError(
      isUniqueViolation(error)
        ? '같은 코드의 출시 기획이 있습니다.'
        : errorMessage(error, '출시 기획을 만들지 못했습니다.'),
      isUniqueViolation(error) ? 'duplicate' : 'invalid',
    )
  }

  return toSeason(data as SeasonRow)
}

/** 보관용 기획의 고정 코드. 이 코드로만 찾으므로 이름은 바꿔도 된다. */
export const UNASSIGNED_SEASON_CODE = 'UNASSIGNED'
export const UNASSIGNED_SEASON_NAME = '기획 미지정'

/**
 * 출시 기획을 정하지 않은 상품을 담는 보관용 기획을 보장한다.
 * styles.season_id가 NOT NULL이라 기존 상품을 먼저 올릴 곳이 필요하다.
 * 나중에 실제 기획으로 옮기면 이 기획은 비워진다.
 */
export async function ensureUnassignedSeason(brandId: string): Promise<Season> {
  const supabase = getSupabase()

  const { data: found, error: findError } = await supabase
    .from('seasons')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .eq('code', UNASSIGNED_SEASON_CODE)
    .maybeSingle()

  if (findError) {
    throw new SeasonStoreError(
      errorMessage(findError, '출시 기획을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (found) return toSeason(found as SeasonRow)

  const { data, error } = await supabase
    .from('seasons')
    .insert({
      brand_id: brandId,
      code: UNASSIGNED_SEASON_CODE,
      name: UNASSIGNED_SEASON_NAME,
      release_timing: '',
      year: new Date().getFullYear(),
      status: 'active',
    })
    .select(COLUMNS)
    .single()

  if (error) {
    // 동시에 두 곳에서 만들면 뒤늦은 쪽은 다시 읽는다.
    if (isUniqueViolation(error)) {
      const { data: retry } = await supabase
        .from('seasons')
        .select(COLUMNS)
        .eq('brand_id', brandId)
        .eq('code', UNASSIGNED_SEASON_CODE)
        .maybeSingle()
      if (retry) return toSeason(retry as SeasonRow)
    }
    throw new SeasonStoreError(
      errorMessage(error, '보관용 출시 기획을 만들지 못했습니다.'),
      'invalid',
    )
  }

  return toSeason(data as SeasonRow)
}

export async function updateSeason(
  id: string,
  input: SeasonInput,
): Promise<Season> {
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
  const code = ensureUniqueSeasonCode(
    buildSeasonCode(name, releaseTiming),
    siblings,
    id,
  )
  const year = extractYearFromTiming(releaseTiming, existing.year)

  const { data, error } = await getSupabase()
    .from('seasons')
    .update({
      code,
      name,
      release_timing: releaseTiming,
      year,
      status: input.status ?? existing.status,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new SeasonStoreError(
      errorMessage(error, '출시 기획을 저장하지 못했습니다.'),
      'invalid',
    )
  }

  return toSeason(data as SeasonRow)
}

export async function deleteSeason(
  id: string,
  options?: { styleCount?: number; draftCount?: number },
): Promise<void> {
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

  const { error } = await getSupabase().from('seasons').delete().eq('id', id)
  if (error) {
    throw new SeasonStoreError(
      errorMessage(error, '출시 기획을 삭제하지 못했습니다.'),
      'invalid',
    )
  }
}
