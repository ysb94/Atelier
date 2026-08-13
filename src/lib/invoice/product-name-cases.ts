/**
 * `이름 변경 단계.xlsx` 29건. 개인정보 열은 넣지 않는다.
 * expectedOfficialName은 Sheet3 값이며 현재 styles.name과 같다.
 */
export type ProductNameCase = {
  productName: string
  itemName: string
  mallName: string
  ownProductCode: string
  expectedOfficialName: string
}

export const PRODUCT_NAME_CASES: ProductNameCase[] = [
  {
    productName: 'Rabbit eco bag_Cob pink flower',
    itemName: 'FREE',
    mallName: '무신사',
    ownProductCode: 'RABBITECOPF',
    expectedOfficialName: '래빗에코백 핑크 플라워',
  },
  {
    productName: '[단독] 마스마룰즈 래빗에코백 32타입',
    itemName: 'Color: 트로피칼',
    mallName: '스마트스토어',
    ownProductCode: '',
    expectedOfficialName: '래빗에코백 트로피컬',
  },
  {
    productName: 'Cotton black',
    itemName: 'Shoulder strap 추가: Cotton black',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '숄더스트랩 - 코튼블랙',
  },
  {
    productName: 'mini ver. Ribbon pocket backpack_Light gray',
    itemName: 'KEYRING 추가=선택안함',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '미니 리본포켓백팩 라이트그레이',
  },
  {
    productName: '마스마룰즈 8포켓 크로스백 4컬러',
    itemName: 'Bag: 8pocket _ 블랙 / shoulder strap: Ocean blue',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '미니 보부백 블랙',
  },
  {
    productName: '8 pocket cross bag_black',
    itemName: 'Shoulder strap=Red, Shoulder strap 추가=Ocean blue 추가',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '미니 보부백 블랙',
  },
  {
    productName: '[단독] 마스마룰즈 래빗에코백 32타입',
    itemName: 'Color: 그린 리프',
    mallName: '스마트스토어',
    ownProductCode: '',
    expectedOfficialName: '래빗에코백 그린 리프',
  },
  {
    productName: '마스마룰즈 미니 하프문 크로스백_8컬러',
    itemName: 'Bag: 차콜',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '미니 하프문 차콜',
  },
  {
    productName: 'mini ver. Ribbon pocket backpack_Black',
    itemName: 'KEYRING 추가=선택안함',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '미니 리본포켓백팩 블랙',
  },
  {
    productName: '마스마룰즈 차밍 나일론 숄더백 5컬러',
    itemName: 'Colors: CMMLSDB_블랙',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '차밍 나일론 숄더백 블랙',
  },
  {
    productName: '마스마룰즈 나일론 로프 스트링 미니 크로스백_2컬러',
    itemName: 'Bag: STRMNCB _Black',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '로프 미니 크로스백 블랙',
  },
  {
    productName: 'Rabbit eco bag_Mono ripple',
    itemName: '',
    mallName: '29CM',
    ownProductCode: '',
    expectedOfficialName: '래빗에코백 모노 리플',
  },
  {
    productName: 'Two pocket daily backpack_Gray',
    itemName: 'KEYRING 추가=선택안함',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '투포켓 데일리백팩 그레이',
  },
  {
    productName: 'Snack eco crossbag_Twilight black',
    itemName: '',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스낵 크로스백 트와일라잇 블랙',
  },
  {
    productName: 'Strap pouch _ 와플 스트라이프 그린',
    itemName: 'FREE : 선택안함,선택안함',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스파 와플 그린',
  },
  {
    productName: 'Strap pouch _ 와플 스트라이프 네이비',
    itemName: 'ONE COLOR',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스파 와플 네이비',
  },
  {
    productName: 'Strap pouch _ 와플 스트라이프 블랙',
    itemName: 'Tassel 1=Yellow (,3300), Tassel 2=Black (,3300)',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스파 와플 블랙',
  },
  {
    productName: '마스마룰즈 베이직 파우치 모음전 VER.1',
    itemName: 'BP_에그',
    mallName: '신세계몰(신)',
    ownProductCode: '',
    expectedOfficialName: '베파 에그',
  },
  {
    productName: '마스마룰즈 베이직 파우치 모음전 VER.1',
    itemName: 'BP_체리',
    mallName: '신세계몰(신)',
    ownProductCode: '',
    expectedOfficialName: '베파 체리',
  },
  {
    productName: 'Strap pouch _ 큣레오파드 크림',
    itemName: 'FREE : Khaki(,3300),선택안함',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스파 큣레오파드 크림',
  },
  {
    productName: 'Strap pouch _ 리본 퀼트 블랙',
    itemName: 'FREE',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스파 리본 퀼트 블랙',
  },
  {
    productName: 'Strap pouch _ 뽐뽐 아이보리',
    itemName: '선택안함',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스파 뽐뽐 아이보리',
  },
  {
    productName: 'Mini strap pouch _ 엠보플라워 레드',
    itemName: '의 옵션',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '미니스 엠보플라워 레드',
  },
  {
    productName: '마스마룰즈 스트랩파우치 모음전',
    itemName: '파우치 선택: 스파 하트 레오파드 머스터드, 태슬: Black',
    mallName: '카카오톡선물하기',
    ownProductCode: '',
    expectedOfficialName: '스파 하트 레오파드 머스터드',
  },
  {
    productName: '마스마룰즈 스트랩파우치 모음전',
    itemName: '파우치 선택: 스파 하트 레오파드 모브블루, 태슬: Black',
    mallName: '카카오톡선물하기',
    ownProductCode: '',
    expectedOfficialName: '스파 하트 레오파드 모브블루',
  },
  {
    productName: 'String bag_Denim',
    itemName: '',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스트링백 데님',
  },
  {
    productName: 'String bag_Corduroy black',
    itemName: '',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '스트링백 코듀로이 블랙',
  },
  {
    productName: 'Black',
    itemName: 'Tassel 1: Black',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '태슬 - 블랙',
  },
  {
    productName: 'Mini cute herringbone black',
    itemName: '',
    mallName: '',
    ownProductCode: '',
    expectedOfficialName: '미니큣 헤링본 블랙',
  },
]
