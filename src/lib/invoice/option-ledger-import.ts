import { normalizeStyleNo } from '@/lib/import/transform'
import type { ParsedSheet } from '@/lib/import/parse'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceOptionMapInput } from '@/lib/supabase/invoice-option-maps'
import type { InvoiceProductNameMapInput } from '@/lib/supabase/invoice-product-name-maps'
import type { InvoiceProductNameMap, StyleRef } from '@/lib/types'

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function safeFilePart(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'brand'
}

export async function downloadInvoiceOptionLedgerTemplate(brandName: string) {
  const XLSX = await import('xlsx')
  const headers = [
    '원본 품목명',
    '원본 내품명',
    '쇼핑몰명',
    '자체상품코드',
    '본품 M번호',
    '본품 공식명',
    '구성품 M번호',
    '구성품 역할',
    '구성품 수량',
    '메모',
  ]
  const guideRows = [
    ['항목명', '필수', '설명'],
    ['원본 품목명', 'Y', '사방넷 품목명과 같아야 함'],
    ['원본 내품명', 'N', '옵션. 비우면 품목명만으로 매칭'],
    ['쇼핑몰명', 'N', '비우면 모든 쇼핑몰'],
    ['자체상품코드', 'N', '참고용. 단독 정답이 아님'],
    ['본품 M번호', 'Y*', '데이터 시트 품번. 없으면 본품 공식명으로 찾음'],
    ['본품 공식명', 'Y*', 'M번호가 없을 때만 사용. 데이터 시트 상품명과 완전 일치'],
    [
      '구성품 M번호',
      'N',
      '기본포함·필수·유료추가 M번호. 여러 개면 같은 원본 조합을 여러 행으로',
    ],
    [
      '구성품 역할',
      'N',
      '포함 / 필수 / 추가. 비우면 포함. 본품 행에는 비움',
    ],
    ['구성품 수량', 'N', '주문 1행당 수량. 비우면 1'],
    [
      '변경전 / 변경후',
      '-',
      '예전 VLOOKUP 2열도 읽음. 변경후가 공식명 1개와 같으면 본품만 등록',
    ],
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    headers,
    [
      '8 pocket cross bag_black',
      'Shoulder strap=Ocean blue',
      '',
      '',
      'M1000',
      '8포켓 크로스백 블랙',
      'M2000',
      '포함',
      '1',
      '',
    ],
  ])
  uploadSheet['!cols'] = headers.map(() => ({ wch: 22 }))
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  guideSheet['!cols'] = [{ wch: 18 }, { wch: 6 }, { wch: 64 }]
  XLSX.utils.book_append_sheet(workbook, uploadSheet, '변환원장')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')
  XLSX.writeFile(
    workbook,
    `${safeFilePart(brandName)}_품목옵션원장_${todayStamp()}.xlsx`,
  )
}

/**
 * 품목명 원장 전용 빈 양식. 조회 키와 본품 M번호 2열만 쓴다.
 * 공식 명칭은 M번호가 가리키는 현재 styles.name을 사용한다.
 */
export async function downloadInvoiceProductNameLedgerTemplate(
  brandName: string,
) {
  const XLSX = await import('xlsx')
  const headers = ['조회 키', '본품 M번호']
  const sampleRows = [
    ['[단독] 마스마룰즈 래빗에코백 32타입 Color: 트로피칼', 'M1000'],
    ['8 pocket cross bag_black Shoulder strap=Red', 'M2000'],
  ]
  const guideRows = [
    ['항목명', '필수', '설명'],
    [
      '조회 키',
      'Y',
      '아래 규칙으로 만든 변환 텍스트를 그대로 넣는다. 이 문자열과 글자가 맞으면 그 행이 정답이 된다',
    ],
    [
      '본품 M번호',
      'Y',
      '데이터 시트에 등록된 M번호. 업로드할 때 현재 공식 명칭을 자동으로 불러온다',
    ],
    [
      '1:1',
      '-',
      '한 조회 키는 본품 M번호 하나만 가리킬 수 있다. 둘이 붙으면 충돌로 표시한다. 다른 키가 같은 M번호를 가리키는 것은 괜찮다',
    ],
    [
      '대소문자·공백',
      '-',
      '앞뒤·연속 공백과 영문 대소문자, 전각·반각 차이는 무시하고 맞춘다',
    ],
    [
      '범위',
      '-',
      '이 원장은 품목명만 바꾼다. 내품명 변경과 출고구성은 내품명 원장에서 등록한다',
    ],
    [
      '기존 파일',
      '-',
      '예전 `변경전 / 변경후` 2열 원장도 계속 읽는다. 새 양식은 조회 키와 M번호를 사용한다',
    ],
  ]
  const formulaRows = [
    ['순서', '조회 키 만드는 방법', '예시'],
    ['1', '자체상품코드', 'CODE-1000'],
    ['2', '품목명 단독', '래빗에코백 32타입'],
    ['3', '품목명 + 한 칸 + 내품명 전체', '래빗에코백 32타입 Color: 트로피칼'],
    ['4', '품목명 + 한 칸 + 내품명 첫 / 앞부분', '크로스백 Bag: 8pocket _ 블랙'],
    ['5', '품목명 + 한 칸 + 내품명 첫 , 앞부분', '파우치 파우치 선택: 하트'],
    ['6', '품목명 + 한 칸 + Color: 값', '래빗에코백 32타입 Color: 트로피칼'],
    ['7', '품목명 + 한 칸 + 내품명 첫 : 앞부분', '크로스백 Bag'],
    [
      '8',
      '내품명 첫 / 앞부분만. 원장과 맞으면 앞부분을 지우고 뒷부분을 남긴다',
      '파우치 선택: [단독]BP_하트 체크 라벤더',
    ],
    [
      '9',
      '내품명 첫 , 앞부분만. 원장과 맞으면 앞부분을 지우고 뒷부분을 남긴다',
      '파우치 선택: [단독]BP_하트 체크 라벤더',
    ],
    [
      '10',
      '내품명 전체만. 원장과 맞으면 내품명을 비운다',
      'Color: 그랑 레오파드 아이보리_RB',
    ],
    [
      '제외',
      '옵션값 단독·SSG / 뒷부분은 오탐이 커서 자동 비교하지 않는다. 앞·뒤가 모두 있는 /·,만 8·9번에 쓴다',
      '',
    ],
    [
      '적용',
      '위 순서대로 원장을 찾고 먼저 맞은 M번호의 현재 상품명이 공식 명칭이 된다. 공백·특수기호·영문 대소문자·HTML 엔티티 차이는 무시한다',
      '',
    ],
  ]

  const workbook = XLSX.utils.book_new()
  const uploadSheet = XLSX.utils.aoa_to_sheet([headers, ...sampleRows])
  uploadSheet['!cols'] = [{ wch: 56 }, { wch: 32 }]
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
  guideSheet['!cols'] = [{ wch: 16 }, { wch: 6 }, { wch: 76 }]
  const formulaSheet = XLSX.utils.aoa_to_sheet(formulaRows)
  formulaSheet['!cols'] = [{ wch: 10 }, { wch: 56 }, { wch: 36 }]
  XLSX.utils.book_append_sheet(workbook, uploadSheet, '품목명원장')
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')
  XLSX.utils.book_append_sheet(workbook, formulaSheet, '조회키만드는법')
  XLSX.writeFile(
    workbook,
    `${safeFilePart(brandName)}_품목명원장_${todayStamp()}.xlsx`,
  )
}

/** Supabase에 실제 저장된 품목명 기준 전체를 확인·재업로드 가능한 XLSX로 내린다. */
export async function downloadInvoiceProductNameLedgerList(
  brandName: string,
  maps: InvoiceProductNameMap[],
) {
  const XLSX = await import('xlsx')
  const headers = [
    '조회 키',
    '본품 M번호',
    '본품 공식명',
    '쇼핑몰명',
    '원본 품목명',
    '원본 내품명',
    '자체상품코드',
    '활성 상태',
    '메모',
    '수정일',
  ]
  const rows = maps.map((map) => [
    map.lookupKey,
    map.style.styleNo,
    map.style.name,
    map.mallName,
    map.productName,
    map.itemNameContext,
    map.ownProductCode,
    map.isActive ? '사용' : '중지',
    map.note,
    map.updatedAt,
  ])
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  sheet['!cols'] = [
    { wch: 64 },
    { wch: 16 },
    { wch: 32 },
    { wch: 20 },
    { wch: 52 },
    { wch: 40 },
    { wch: 22 },
    { wch: 12 },
    { wch: 32 },
    { wch: 26 },
  ]
  sheet['!autofilter'] = { ref: `A1:J${Math.max(rows.length + 1, 1)}` }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '현재품목명원장')
  XLSX.writeFile(
    workbook,
    `${safeFilePart(brandName)}_품목명원장_현재목록_${todayStamp()}.xlsx`,
  )
}

export type InvoiceOptionLedgerStatus =
  | 'ready'
  | 'duplicate'
  | 'conflict'
  | 'unmatched'
  | 'error'

export type PreparedInvoiceOptionLedgerRow = {
  lineNo: number
  productName: string
  itemName: string
  mallName: string
  ownProductCode: string
  mainStyle: StyleRef | null
  extraStyles: {
    style: StyleRef
    role: 'included' | 'required' | 'paid_add'
    quantity: number
  }[]
  note: string
  status: InvoiceOptionLedgerStatus
  message: string
  input: InvoiceOptionMapInput | null
}

export type InvoiceOptionStyleLookup = {
  byStyleNo: Map<string, StyleRef>
  byName: Map<string, StyleRef[]>
}

function headerIndex(headers: string[], aliases: string[]): number {
  const compact = headers.map((header) =>
    header.replace(/\s+/g, '').toLocaleLowerCase('ko-KR'),
  )
  for (const alias of aliases) {
    const key = alias.replace(/\s+/g, '').toLocaleLowerCase('ko-KR')
    const index = compact.indexOf(key)
    if (index >= 0) return index
  }
  return -1
}

export type InvoiceOptionLedgerStyleCandidates = {
  styleNos: string[]
  names: string[]
}

/**
 * 상품 마스터 대조에 실제로 필요한 열만 뽑는다.
 * 품목명·내품명·쇼핑몰 같은 원본 문자열을 상품 검색 조건에 넣으면
 * 대용량 원장에서 PostgREST 요청 URL이 지나치게 커진다.
 */
export function collectInvoiceOptionLedgerStyleCandidates(
  rows: string[][],
): InvoiceOptionLedgerStyleCandidates {
  if (rows.length === 0) return { styleNos: [], names: [] }

  const headers = rows[0] ?? []
  const mainNoIdx = headerIndex(headers, ['본품 M번호', 'M번호'])
  const mainNameIdx = headerIndex(headers, [
    '본품 공식명',
    '공식 상품명',
    '변경후',
    '공식명',
  ])
  const extraNoIdx = headerIndex(headers, ['구성품 M번호'])
  const styleNos = new Set<string>()
  const names = new Set<string>()

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const mainNo = String(
      mainNoIdx >= 0 ? row[mainNoIdx] ?? '' : '',
    ).trim()
    const mainName = String(
      mainNameIdx >= 0 ? row[mainNameIdx] ?? '' : '',
    ).trim()
    const extraNo = String(
      extraNoIdx >= 0 ? row[extraNoIdx] ?? '' : '',
    ).trim()

    if (mainNo) styleNos.add(mainNo)
    if (extraNo) styleNos.add(extraNo)
    // M번호가 있으면 resolveStyle이 M번호를 우선하므로 이름 조회는 불필요하다.
    if (!mainNo && mainName) names.add(mainName)
  }

  return { styleNos: [...styleNos], names: [...names] }
}

function parseRole(
  value: string,
): 'included' | 'required' | 'paid_add' | null {
  const key = value.replace(/\s+/g, '').toLocaleLowerCase('ko-KR')
  if (!key || key === '포함' || key === '기본포함' || key === 'included') {
    return 'included'
  }
  if (key === '필수' || key === '필수옵션' || key === 'required') {
    return 'required'
  }
  if (
    key === '추가' ||
    key === '유료추가' ||
    key === 'paid' ||
    key === 'paid_add'
  ) {
    return 'paid_add'
  }
  if (key === '본품' || key === 'main') return null
  return 'included'
}

function resolveStyle(
  styleNo: string,
  officialName: string,
  lookup: InvoiceOptionStyleLookup,
): { style: StyleRef | null; error: string | null } {
  if (styleNo) {
    const byNorm = lookup.byStyleNo.get(normalizeStyleNo(styleNo))
    if (byNorm) return { style: byNorm, error: null }
    const byLower = lookup.byStyleNo.get(
      styleNo.trim().toLocaleLowerCase('ko-KR'),
    )
    if (byLower) return { style: byLower, error: null }
    return { style: null, error: `M번호를 찾을 수 없습니다: ${styleNo}` }
  }
  if (!officialName) return { style: null, error: null }
  const matches =
    lookup.byName.get(officialName.trim().toLocaleLowerCase('ko-KR')) ?? []
  if (matches.length === 1) return { style: matches[0]!, error: null }
  if (matches.length === 0) {
    return {
      style: null,
      error: `상품명을 찾을 수 없습니다: ${officialName}`,
    }
  }
  return {
    style: null,
    error: '상품명이 여러 상품과 겹칩니다. M번호를 넣으세요',
  }
}

function comboKey(productName: string, itemName: string, mallName: string) {
  return [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
    normalizeInvoiceText(itemName),
  ].join('\u0000')
}

type DraftGroup = {
  lineNos: number[]
  productName: string
  itemName: string
  mallName: string
  ownProductCode: string
  note: string
  mains: { style: StyleRef | null; label: string; error: string | null }[]
  extras: {
    style: StyleRef
    role: 'included' | 'required' | 'paid_add'
    quantity: number
  }[]
}

/**
 * 누적 VLOOKUP·변환 원장을 읽어 등록 가능한 조합과 충돌을 가른다.
 * 2열(변경전/변경후)과 10열 양식을 모두 받는다.
 */
export function prepareInvoiceOptionLedgerRows(
  rows: string[][],
  lookup: InvoiceOptionStyleLookup,
): PreparedInvoiceOptionLedgerRow[] {
  if (rows.length === 0) return []
  const headers = rows[0] ?? []
  const productIdx = headerIndex(headers, [
    '원본 품목명',
    '품목명',
    '변경전',
    '상품명',
  ])
  const itemIdx = headerIndex(headers, ['원본 내품명', '내품명', '옵션명'])
  const mallIdx = headerIndex(headers, ['쇼핑몰명', '쇼핑몰'])
  const codeIdx = headerIndex(headers, ['자체상품코드', '자체품번코드'])
  const mainNoIdx = headerIndex(headers, ['본품 M번호', 'M번호'])
  const mainNameIdx = headerIndex(headers, [
    '본품 공식명',
    '공식 상품명',
    '변경후',
    '공식명',
  ])
  const extraNoIdx = headerIndex(headers, ['구성품 M번호'])
  const extraRoleIdx = headerIndex(headers, ['구성품 역할'])
  const extraQtyIdx = headerIndex(headers, ['구성품 수량'])
  const noteIdx = headerIndex(headers, ['메모'])

  const isLegacyTwoCol =
    productIdx >= 0 &&
    mainNameIdx >= 0 &&
    extraNoIdx < 0 &&
    (headers.length <= 3 || itemIdx < 0)

  const groups = new Map<string, DraftGroup>()
  const prepared: PreparedInvoiceOptionLedgerRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const lineNo = i + 1
    if (row.every((value) => !String(value).trim())) continue

    const productName = String(
      productIdx >= 0 ? row[productIdx] : row[0] ?? '',
    ).trim()
    const itemName = String(itemIdx >= 0 ? row[itemIdx] ?? '' : '').trim()
    const mallName = String(mallIdx >= 0 ? row[mallIdx] ?? '' : '').trim()
    const ownProductCode = String(
      codeIdx >= 0 ? row[codeIdx] ?? '' : '',
    ).trim()
    const mainNo = String(mainNoIdx >= 0 ? row[mainNoIdx] ?? '' : '').trim()
    const mainName = String(
      mainNameIdx >= 0
        ? row[mainNameIdx] ?? ''
        : isLegacyTwoCol
          ? row[1] ?? ''
          : '',
    ).trim()
    const extraNo = String(extraNoIdx >= 0 ? row[extraNoIdx] ?? '' : '').trim()
    const extraRole = parseRole(
      String(extraRoleIdx >= 0 ? row[extraRoleIdx] ?? '' : ''),
    )
    const extraQtyRaw = Number(
      String(extraQtyIdx >= 0 ? row[extraQtyIdx] ?? '1' : '1').replace(
        /,/g,
        '',
      ),
    )
    const note = String(noteIdx >= 0 ? row[noteIdx] ?? '' : '').trim()

    if (!productName) {
      prepared.push({
        lineNo,
        productName: '',
        itemName,
        mallName,
        ownProductCode,
        mainStyle: null,
        extraStyles: [],
        note,
        status: 'error',
        message: '원본 품목명이 없습니다.',
        input: null,
      })
      continue
    }

    const key = comboKey(productName, itemName, mallName)
    const group = groups.get(key) ?? {
      lineNos: [],
      productName,
      itemName,
      mallName,
      ownProductCode,
      note,
      mains: [],
      extras: [],
    }
    group.lineNos.push(lineNo)
    if (!group.ownProductCode && ownProductCode) {
      group.ownProductCode = ownProductCode
    }
    if (!group.note && note) group.note = note

    if (mainNo || mainName) {
      const resolved = resolveStyle(mainNo, mainName, lookup)
      group.mains.push({
        style: resolved.style,
        label: resolved.style
          ? `${resolved.style.styleNo} · ${resolved.style.name}`
          : mainNo || mainName,
        error: resolved.error,
      })
    }

    if (extraNo && extraRole) {
      const resolved = resolveStyle(extraNo, '', lookup)
      if (resolved.style) {
        group.extras.push({
          style: resolved.style,
          role: extraRole,
          quantity: Number.isFinite(extraQtyRaw) && extraQtyRaw >= 1
            ? Math.floor(extraQtyRaw)
            : 1,
        })
      } else {
        prepared.push({
          lineNo,
          productName,
          itemName,
          mallName,
          ownProductCode,
          mainStyle: null,
          extraStyles: [],
          note,
          status: 'unmatched',
          message: resolved.error || `구성품 M번호를 찾을 수 없습니다: ${extraNo}`,
          input: null,
        })
      }
    }

    groups.set(key, group)
  }

  for (const group of groups.values()) {
    const lineNo = group.lineNos[0] ?? 1
    const mainErrors = group.mains.filter((item) => item.error)
    if (mainErrors.length > 0) {
      prepared.push({
        lineNo,
        productName: group.productName,
        itemName: group.itemName,
        mallName: group.mallName,
        ownProductCode: group.ownProductCode,
        mainStyle: null,
        extraStyles: group.extras,
        note: group.note,
        status: 'unmatched',
        message: mainErrors[0]?.error || '본품을 찾지 못했습니다.',
        input: null,
      })
      continue
    }

    const mainIds = [
      ...new Set(
        group.mains
          .map((item) => item.style?.styleId)
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    if (mainIds.length > 1) {
      prepared.push({
        lineNo,
        productName: group.productName,
        itemName: group.itemName,
        mallName: group.mallName,
        ownProductCode: group.ownProductCode,
        mainStyle: null,
        extraStyles: group.extras,
        note: group.note,
        status: 'conflict',
        message: `같은 조합이 서로 다른 본품으로 연결됩니다 (${group.mains
          .map((item) => item.label)
          .join(' / ')})`,
        input: null,
      })
      continue
    }

    const mainStyle = group.mains.find((item) => item.style)?.style ?? null
    if (!mainStyle) {
      prepared.push({
        lineNo,
        productName: group.productName,
        itemName: group.itemName,
        mallName: group.mallName,
        ownProductCode: group.ownProductCode,
        mainStyle: null,
        extraStyles: group.extras,
        note: group.note,
        status: 'unmatched',
        message: '본품 M번호 또는 공식명을 찾지 못했습니다.',
        input: null,
      })
      continue
    }

    const input: InvoiceOptionMapInput = {
      mallName: group.mallName,
      productName: group.productName,
      itemName: group.itemName,
      ownProductCode: group.ownProductCode,
      note: group.note,
      components: [
        { styleId: mainStyle.styleId, role: 'main', quantity: 1 },
        ...group.extras.map((item) => ({
          styleId: item.style.styleId,
          role: item.role,
          quantity: item.quantity,
        })),
      ],
    }

    prepared.push({
      lineNo,
      productName: group.productName,
      itemName: group.itemName,
      mallName: group.mallName,
      ownProductCode: group.ownProductCode,
      mainStyle,
      extraStyles: group.extras,
      note: group.note,
      status: group.lineNos.length > 1 ? 'duplicate' : 'ready',
      message:
        group.lineNos.length > 1
          ? `${group.lineNos.length}행이 같은 조합이라 하나로 합칩니다.`
          : `본품 ${mainStyle.styleNo} · ${mainStyle.name}${
              group.extras.length > 0
                ? ` · 구성 ${group.extras.length}개`
                : ''
            }`,
      input,
    })
  }

  prepared.sort((left, right) => left.lineNo - right.lineNo)
  return prepared
}

export type PreparedInvoiceProductNameLedgerRow = {
  lineNo: number
  productName: string
  /** 조회 키 원장에서만 채운다. 채워지면 이 문자열 하나로 매칭한다. */
  lookupKey: string
  itemNameContext: string
  mallName: string
  ownProductCode: string
  officialName: string
  mainStyle: StyleRef | null
  note: string
  status: InvoiceOptionLedgerStatus
  message: string
  input: InvoiceProductNameMapInput | null
}

function compactHeader(value: string) {
  return value.replace(/\s+/g, '').toLocaleLowerCase('ko-KR')
}

export function isNameChangeCasebook(sheets: ParsedSheet[]) {
  const hasSource = sheets.some((sheet) =>
    /사방넷|입력값/.test(compactHeader(sheet.name)),
  )
  const hasExpected = sheets.some(
    (sheet) => compactHeader(sheet.name) === 'sheet3',
  )
  return hasSource && hasExpected
}

export function collectInvoiceProductNameLedgerStyleCandidates(
  rows: string[][],
  expectedNames: string[] = [],
): InvoiceOptionLedgerStyleCandidates {
  if (rows.length === 0 && expectedNames.length === 0) {
    return { styleNos: [], names: [] }
  }
  const headers = rows[0] ?? []
  const mainNoIdx = headerIndex(headers, ['본품 M번호', 'M번호'])
  const mainNameIdx = headerIndex(headers, [
    '본품 공식명',
    '공식 상품명',
    '공식 명칭',
    '변경후',
    '공식명',
    '최종 품목명',
  ])
  const styleNos = new Set<string>()
  const names = new Set<string>(expectedNames.map((value) => value.trim()).filter(Boolean))

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const mainNo = String(mainNoIdx >= 0 ? row[mainNoIdx] ?? '' : '').trim()
    const mainName = String(
      mainNameIdx >= 0 ? row[mainNameIdx] ?? '' : '',
    ).trim()
    if (mainNo) styleNos.add(mainNo)
    if (!mainNo && mainName) names.add(mainName)
  }

  return { styleNos: [...styleNos], names: [...names] }
}

function productNameComboKey(
  mallName: string,
  productName: string,
  itemNameContext: string,
) {
  return [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
    normalizeInvoiceText(itemNameContext),
  ].join('\u0000')
}

/**
 * 품목명 원장. 구성품 역할·수량·변환 내품명은 만들지 않는다.
 * 내품명·쇼핑몰 열이 없는 `변경전 → 변경후` 원장은 변경전을 조회 키로 저장한다.
 */
export function prepareInvoiceProductNameLedgerRows(
  rows: string[][],
  lookup: InvoiceOptionStyleLookup,
): PreparedInvoiceProductNameLedgerRow[] {
  if (rows.length === 0) return []
  const headers = rows[0] ?? []
  const productIdx = headerIndex(headers, [
    '원본 품목명',
    '품목명',
    '변경전',
    '상품명',
  ])
  const itemIdx = headerIndex(headers, [
    '원본 내품명',
    '내품명',
    '내품명 문맥',
    '옵션명',
  ])
  const mallIdx = headerIndex(headers, ['쇼핑몰명', '쇼핑몰'])
  const codeIdx = headerIndex(headers, ['자체상품코드', '자체품번코드'])
  const mainNoIdx = headerIndex(headers, ['본품 M번호', 'M번호'])
  const mainNameIdx = headerIndex(headers, [
    '본품 공식명',
    '공식 상품명',
    '공식 명칭',
    '변경후',
    '공식명',
    '최종 품목명',
  ])
  const lookupIdx = headerIndex(headers, [
    '조회 키',
    '조회키',
    '변환 키',
    '조회 문자열',
  ])
  const noteIdx = headerIndex(headers, ['메모'])
  // 조회 키 열이 없고 내품명·쇼핑몰 열도 없으면 첫 열이 조회 키인 2열 원장이다.
  const bareLookupSheet = lookupIdx < 0 && itemIdx < 0 && mallIdx < 0

  const seen = new Map<string, PreparedInvoiceProductNameLedgerRow>()
  const prepared: PreparedInvoiceProductNameLedgerRow[] = []

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const lineNo = i + 1
    if (row.every((value) => !String(value).trim())) continue

    const rawLookupKey = String(
      lookupIdx >= 0 ? row[lookupIdx] ?? '' : '',
    ).trim()
    const productName =
      rawLookupKey ||
      String(productIdx >= 0 ? row[productIdx] : row[0] ?? '').trim()
    // 한 파일에 두 방식이 섞여도 되도록 행마다 판단한다.
    const lookupMode = Boolean(rawLookupKey) || bareLookupSheet
    const lookupKey = lookupMode ? productName : ''
    const itemNameContext = String(
      itemIdx >= 0 ? row[itemIdx] ?? '' : '',
    ).trim()
    const mallName = String(mallIdx >= 0 ? row[mallIdx] ?? '' : '').trim()
    const ownProductCode = String(
      codeIdx >= 0 ? row[codeIdx] ?? '' : '',
    ).trim()
    const mainNo = String(mainNoIdx >= 0 ? row[mainNoIdx] ?? '' : '').trim()
    const officialName = String(
      mainNameIdx >= 0 ? row[mainNameIdx] ?? '' : '',
    ).trim()
    const note = String(noteIdx >= 0 ? row[noteIdx] ?? '' : '').trim()

    if (!productName) {
      prepared.push({
        lineNo,
        productName: '',
        lookupKey: '',
        itemNameContext,
        mallName,
        ownProductCode,
        officialName,
        mainStyle: null,
        note,
        status: 'error',
        message: lookupMode ? '조회 키가 없습니다.' : '원본 품목명이 없습니다.',
        input: null,
      })
      continue
    }

    const resolved = resolveStyle(mainNo, officialName, lookup)
    const key = lookupMode
      ? `lookup\u0000${normalizeInvoiceText(lookupKey)}`
      : productNameComboKey(mallName, productName, itemNameContext)
    const existing = seen.get(key)
    if (existing) {
      if (
        resolved.style &&
        existing.mainStyle &&
        resolved.style.styleId !== existing.mainStyle.styleId
      ) {
        existing.status = 'conflict'
        existing.message = lookupMode
          ? '같은 조회 키가 서로 다른 본품으로 연결됩니다.'
          : '같은 조합이 서로 다른 본품으로 연결됩니다.'
        existing.input = null
      } else {
        existing.status = 'duplicate'
        existing.message = lookupMode
          ? '같은 조회 키라 하나로 합칩니다.'
          : '같은 조합이라 하나로 합칩니다.'
      }
      continue
    }

    if (resolved.error || !resolved.style) {
      const item: PreparedInvoiceProductNameLedgerRow = {
        lineNo,
        productName,
        lookupKey,
        itemNameContext,
        mallName,
        ownProductCode,
        officialName,
        mainStyle: null,
        note,
        status: resolved.error ? 'unmatched' : 'unmatched',
        message: resolved.error || '본품 M번호 또는 공식명을 찾지 못했습니다.',
        input: null,
      }
      seen.set(key, item)
      prepared.push(item)
      continue
    }

    const item: PreparedInvoiceProductNameLedgerRow = {
      lineNo,
      productName,
      lookupKey,
      itemNameContext,
      mallName,
      ownProductCode,
      officialName: resolved.style.name,
      mainStyle: resolved.style,
      note,
      status: 'ready',
      message: `본품 ${resolved.style.styleNo} · ${resolved.style.name}`,
      input: {
        mallName,
        productName,
        itemNameContext,
        ownProductCode,
        lookupKey,
        styleId: resolved.style.styleId,
        note,
      },
    }
    seen.set(key, item)
    prepared.push(item)
  }

  return prepared
}

/**
 * `사방넷 입력값` + `Sheet3` 사례집. 행 번호로 짝짓고 수령인·전화·주소는 저장하지 않는다.
 */
export function prepareProductNameCasebookRows(
  sheets: ParsedSheet[],
  lookup: InvoiceOptionStyleLookup,
): PreparedInvoiceProductNameLedgerRow[] {
  const sourceSheet =
    sheets.find((sheet) => /사방넷|입력값/.test(compactHeader(sheet.name))) ??
    sheets[0]
  const expectedSheet = sheets.find(
    (sheet) => compactHeader(sheet.name) === 'sheet3',
  )
  if (!sourceSheet || !expectedSheet) return []

  const sourceHeaders = sourceSheet.rows[0] ?? []
  const productIdx = headerIndex(sourceHeaders, ['품목명', '원본 품목명'])
  const itemIdx = headerIndex(sourceHeaders, ['내품명', '원본 내품명'])
  const mallIdx = headerIndex(sourceHeaders, ['쇼핑몰명', '쇼핑몰'])
  const codeIdx = headerIndex(sourceHeaders, ['자체상품코드', '자체품번코드'])
  const expectedHeaders = expectedSheet.rows[0] ?? []
  const expectedIdx = headerIndex(expectedHeaders, [
    '본품 공식명',
    '공식 상품명',
    '최종 품목명',
    '품목명',
    '변경후',
  ])

  const paired: string[][] = [
    [
      '원본 품목명',
      '원본 내품명',
      '쇼핑몰명',
      '자체상품코드',
      '본품 공식명',
    ],
  ]

  const sourceRows = sourceSheet.rows.slice(1)
  const expectedRows = expectedSheet.rows.slice(1)
  const count = Math.max(sourceRows.length, expectedRows.length)
  for (let i = 0; i < count; i += 1) {
    const source = sourceRows[i] ?? []
    const expected = expectedRows[i] ?? []
    const productName = String(
      productIdx >= 0 ? source[productIdx] ?? '' : source[0] ?? '',
    ).trim()
    const officialName = String(
      expectedIdx >= 0 ? expected[expectedIdx] ?? '' : expected[0] ?? '',
    ).trim()
    if (!productName && !officialName) continue
    paired.push([
      productName,
      String(itemIdx >= 0 ? source[itemIdx] ?? '' : '').trim(),
      String(mallIdx >= 0 ? source[mallIdx] ?? '' : '').trim(),
      String(codeIdx >= 0 ? source[codeIdx] ?? '' : '').trim(),
      officialName,
    ])
  }

  return prepareInvoiceProductNameLedgerRows(paired, lookup)
}
