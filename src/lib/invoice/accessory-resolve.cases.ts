import type { StyleRef } from '@/lib/types'

export type AccessoryResolveCase = {
  id: string
  itemName: string
  productLookupKey: string
  mainStyleNo: string | null
  expectStyleNos: string[]
  expectUnknown: boolean
}

export const ACCESSORY_STYLE_FIXTURES: StyleRef[] = [
  { styleId: 's-m0982', styleNo: 'M0982', name: '태슬 - 블랙' },
  { styleId: 's-m0983', styleNo: 'M0983', name: '태슬 - 레드' },
  { styleId: 's-m0984', styleNo: 'M0984', name: '태슬 - 그레이' },
  { styleId: 's-m0990', styleNo: 'M0990', name: '태슬 - 화이트' },
  { styleId: 's-m0992', styleNo: 'M0992', name: '태슬 - 핑크' },
  { styleId: 's-m0993', styleNo: 'M0993', name: '태슬 - 옐로우' },
  { styleId: 's-m0352', styleNo: 'M0352', name: '숄더스트랩 - 코튼블랙' },
  { styleId: 's-m0350', styleNo: 'M0350', name: '숄더스트랩 - 그린' },
  { styleId: 's-m0344', styleNo: 'M0344', name: '숄더스트랩 - 레드' },
  { styleId: 's-m0351', styleNo: 'M0351', name: '숄더스트랩 - 그레이' },
  { styleId: 's-m0998', styleNo: 'M0998', name: '진주리본키링' },
  { styleId: 's-m0997', styleNo: 'M0997', name: 'BB키링' },
  { styleId: 's-m0732', styleNo: 'M0732', name: '타이니 드롭 하트 키링' },
  { styleId: 's-m0048', styleNo: 'M0048', name: '래빗에코백' },
  { styleId: 's-m0088', styleNo: 'M0088', name: '8 pocket cross bag black' },
  { styleId: 's-m2276', styleNo: 'M2276', name: '스트랩파우치 스티치코튼 블랙' },
]

/**
 * 612행 실측과 확인된 오설정 4행을 바로잡은 회귀 사례.
 */
export const ACCESSORY_RESOLVE_CASES: AccessoryResolveCase[] = [
  {
    id: 'tassel-label',
    itemName: '태슬: Red',
    productLookupKey: 'Strap pouch 하트 레오파드',
    mainStyleNo: 'M2276',
    expectStyleNos: ['M0983'],
    expectUnknown: false,
  },
  {
    id: 'tassel-double-same',
    itemName: 'Tassel 1=Pink, Tassel 2=Pink',
    productLookupKey: 'Strap pouch_Stitched ribbon quilt',
    mainStyleNo: 'M2276',
    expectStyleNos: ['M0992', 'M0992'],
    expectUnknown: false,
  },
  {
    id: 'tassel-pair-bracket',
    itemName: '[Tassel 1:Tassel 2]Black:White',
    productLookupKey: 'Strap pouch_Stitched ribbon quilt Black',
    mainStyleNo: 'M2276',
    expectStyleNos: ['M0982', 'M0990'],
    expectUnknown: false,
  },
  {
    id: 'keyring-other-main',
    itemName: 'KEYRING 추가=PEARL RIBBON KEYRING',
    productLookupKey: '래빗에코백 단독',
    mainStyleNo: 'M0048',
    expectStyleNos: ['M0998'],
    expectUnknown: false,
  },
  {
    id: 'keyring-same-as-main',
    itemName: 'KEYRING 추가: PEARL RIBBON KEYRING',
    productLookupKey: 'PEARL RIBBON KEYRING',
    mainStyleNo: 'M0998',
    expectStyleNos: [],
    expectUnknown: false,
  },
  {
    id: 'bb-same-as-main',
    itemName: 'Keyring: BB KEYRING',
    productLookupKey: 'BB KEYRING',
    mainStyleNo: 'M0997',
    expectStyleNos: [],
    expectUnknown: false,
  },
  {
    id: 'tiny-drop-same',
    itemName: '키링 추가: 타이니 드롭 하트 키링',
    productLookupKey: '타이니 드롭 하트 키링',
    mainStyleNo: 'M0732',
    expectStyleNos: [],
    expectUnknown: false,
  },
  {
    id: 'tassel-yellow-repeat',
    itemName: 'Yellow',
    productLookupKey: '마스마룰즈 Tassel 모음 Yellow',
    mainStyleNo: 'M0993',
    expectStyleNos: [],
    expectUnknown: false,
  },
  {
    id: 'red-keyring-token',
    itemName: '파우치 선택: SP누빔 + 레드 키링',
    productLookupKey: 'Strap pouch nubbim',
    mainStyleNo: 'M2276',
    expectStyleNos: ['M0983'],
    expectUnknown: false,
  },
  {
    id: 'free-red-default',
    itemName: 'FREE : Red(+3300)',
    productLookupKey: 'Mini strap pouch_Black flower',
    mainStyleNo: 'M2276',
    expectStyleNos: ['M0983'],
    expectUnknown: false,
  },
  {
    id: 'strap-extra-same-color',
    itemName: 'Cotton black : Cotton black 추가(+10000)',
    productLookupKey: '8 pocket cross bag_black',
    mainStyleNo: 'M0088',
    expectStyleNos: ['M0352', 'M0352'],
    expectUnknown: false,
  },
  {
    id: 'strap-two-colors',
    itemName: 'Cotton black : Green 추가(+10000)',
    productLookupKey: '8 pocket cross bag_black',
    mainStyleNo: 'M0088',
    expectStyleNos: ['M0352', 'M0350'],
    expectUnknown: false,
  },
  {
    id: 'color-size-delete',
    itemName: '[COLOR]BLACK [TOP SIZE]ONE SIZE (F)',
    productLookupKey: '[SET] Textured Waffle Collar Half Set-Up_Black',
    mainStyleNo: 'M0873',
    expectStyleNos: [],
    expectUnknown: false,
  },
  {
    id: 'unknown-keeps',
    itemName: '스텔라 글러브 홀더 키링',
    productLookupKey: '드롭 숄더백 블랙',
    mainStyleNo: 'M0048',
    expectStyleNos: [],
    expectUnknown: true,
  },
  {
    id: 'pouch-and-tassel',
    itemName: '파우치 선택: SP_스티치코튼 블랙, 태슬: Red',
    productLookupKey: '래빗에코백',
    mainStyleNo: 'M2276',
    expectStyleNos: ['M0983'],
    expectUnknown: false,
  },
]
