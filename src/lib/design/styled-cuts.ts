export const PRODUCT_PHOTO_MIN = 8
export const PRODUCT_PHOTO_MAX = 10

export type ImageSlot = {
  id: string
  file: File
  url: string
}

export const PRODUCT_PHOTO_SLOTS = [
  { key: 'front', label: '정면', required: true, guide: '제품 앞면과 카메라 렌즈가 나란하도록 정면에서 찍어 주세요. 제품 전체가 잘리지 않고 수평·수직이 반듯하게 보이게 하세요.' },
  { key: 'diagonal', label: '45도 사선', required: true, guide: '제품 앞면과 옆면이 함께 보이도록 제품을 약 45도 돌려 찍어 주세요. 모양과 깊이를 확인할 수 있게 제품 전체를 담아 주세요.' },
  { key: 'side', label: '측면', required: true, guide: '제품의 옆면이 카메라를 향하도록 찍어 주세요. 폭과 두께, 손잡이·스트랩·부속이 가려지지 않게 정리해 주세요.' },
  { key: 'back', label: '후면', required: true, guide: '제품을 뒤로 돌려 뒷면 전체를 반듯하게 찍어 주세요. 뒷면 포켓·봉제선·장식과 끈 연결 부분이 잘 보이게 하세요.' },
  { key: 'top', label: '상단', required: true, guide: '제품 위쪽의 입구·지퍼·손잡이 연결 구조가 보이도록 약간 위에서 찍어 주세요. 제품이 찌그러지거나 앞뒤가 가려지지 않게 하세요.' },
  { key: 'bottom', label: '하단', required: true, guide: '제품 밑면이 보이도록 안전하게 눕히거나 들어서 찍어 주세요. 바닥 모양·봉제선·받침 장식이 선명하고 제품 전체 방향을 알 수 있게 담아 주세요.' },
  { key: 'logo', label: '로고/라벨 디테일', required: true, guide: '로고나 라벨의 글자·모양·색상과 제품에서의 위치가 선명하게 보이도록 가까이 찍어 주세요. 빛 반사와 흔들림을 피하고 주변 부분도 조금 포함하세요.' },
  { key: 'material', label: '소재 디테일', required: true, guide: '원단의 짜임·결·무늬·광택이 보이도록 가까이 찍어 주세요. 자연스러운 밝기에서 초점을 정확히 맞추고 필터나 과한 보정은 사용하지 마세요.' },
  { key: 'open', label: '열린 상태/구조', required: false, guide: '지퍼·덮개·잠금장치를 자연스럽게 열고 내부와 여닫는 구조가 보이게 찍어 주세요. 제품을 억지로 벌리거나 원래 모양을 찌그러뜨리지 마세요.' },
  { key: 'scale', label: '크기 참고컷', required: false, guide: '제품을 메고 있는 착용컷이나 자와 함께 찍은 사진을 올려 주세요. 착용컷은 가능하면 전신과 제품 전체가 보이고 왜곡이 적은 사진이 좋아요. 실제 착용자 키를 알면 아래에 적어 주세요. 사람과 착용 자세는 결과에 넣지 않고 크기만 참고해요.' },
] as const

export const REFERENCE_PHOTO_GUIDE = '만들고 싶은 연출과 가장 비슷한 사진을 골라 주세요. 원하는 배경·제품 배치·카메라 각도·조명·소품·분위기가 한눈에 잘 보이는 선명한 사진이 좋습니다.'

export const REFERENCE_ROLE_SLOTS = [
  { key: 'composition', label: '구도', guide: '제품이 놓인 위치, 카메라가 보는 방향, 주변 여백이 마음에 드는 사진을 골라 주세요. 배경이나 제품 디자인은 달라도 괜찮아요.', scope: '카메라 각도·제품 위치·여백·화면 잘림만 참고하세요. 배경·조명·소품·제품 디자인은 가져오지 마세요.' },
  { key: 'background', label: '배경', guide: '원하는 바닥·벽·장소·배경 색상이 잘 보이는 사진을 골라 주세요. 사진 속 제품과 제품 위치는 따라 하지 않아요.', scope: '바닥·벽·장소·배경 색상만 참고하세요. 제품 위치·카메라 구도·소품·제품 디자인은 가져오지 마세요.' },
  { key: 'lighting', label: '조명·분위기', guide: '밝고 화사한 느낌, 부드러운 그림자처럼 원하는 빛과 분위기가 보이는 사진을 골라 주세요. 제품 색상은 원본대로 유지해요.', scope: '빛의 방향·밝기·부드러움·그림자·분위기만 참고하세요. 배경·구도·소품은 가져오지 말고 제품의 실제 색상과 소재 표현을 보존하세요.' },
  { key: 'props', label: '소품', guide: '함께 놓고 싶은 책·꽃·컵 등의 소품이 보이는 사진을 골라 주세요. 소품의 위치는 우리 제품 크기와 선택한 구도에 맞춰 조정해요.', scope: '소품 종류와 대략적인 배치만 참고하세요. 배경·조명·제품 디자인은 가져오지 말고 소품 위치와 간격은 선택한 구도 및 제품 실제 크기에 맞추세요.' },
] as const
export type ReferenceRoleKey = (typeof REFERENCE_ROLE_SLOTS)[number]['key']
export type ReferencePhotoMap = Partial<Record<ReferenceRoleKey, ImageSlot>>
export const EXPLORATION_SLOTS = [
  REFERENCE_ROLE_SLOTS[0],
  REFERENCE_ROLE_SLOTS[1],
  { key: 'pose', label: '제품을 놓는 모습', guide: '제품을 소파나 바닥에 실제로 놓고 원하는 모습을 찍어 주세요. 끈도 손을 떼고 자연스럽게 내려놓으세요. 눕힌 모습·기댄 모습 등 여러 장을 올려도 좋아요. 다른 제품 사진은 놓는 방향과 끈 배치만 참고해요.', scope: '제품이 놓인 방향·기댐·바닥 접촉과 끈의 자연스러운 배치만 참고하세요. 참고 제품의 실루엣·디자인·끈 길이·연결 구조는 복사하지 마세요. 실제 제품의 소재 유연성과 구조가 허용하는 자세만 적용하세요.' },
] as const
export type ExplorationKey = (typeof EXPLORATION_SLOTS)[number]['key']
export type ExplorationPhotoMap = Partial<Record<ExplorationKey, ImageSlot[]>>
export const VARIATION_COUNTS = ['2', '3', '4'] as const
export type ReferenceMode = 'single' | 'split' | 'explore'

export function revokeExplorationPhotos(photos: ExplorationPhotoMap) {
  for (const group of Object.values(photos)) for (const photo of group ?? []) URL.revokeObjectURL(photo.url)
}

export function activeReferencePhotos(mode: ReferenceMode, single: ImageSlot | null, split: ReferencePhotoMap, exploration: ExplorationPhotoMap = {}) {
  if (mode === 'explore') return EXPLORATION_SLOTS.flatMap((slot) => (exploration[slot.key] ?? []).map((photo, index) => ({ key: `${slot.key}-${index}`, label: `${slot.label} 후보 ${index + 1}`, photo, scope: slot.scope })))
  if (mode === 'single') return single ? [{ key: 'reference', label: '연출용', photo: single, scope: '배경·구도·각도·조명·소품·분위기만 참고하세요. 이 사진 속 제품을 제작 대상으로 사용하지 마세요.' }] : []
  return REFERENCE_ROLE_SLOTS.flatMap((slot) => {
    const photo = split[slot.key]
    return photo ? [{ key: slot.key, label: `${slot.label} 전용`, photo, scope: slot.scope }] : []
  })
}

export function revokeReferencePhotos(photos: ReferencePhotoMap) {
  for (const photo of Object.values(photos)) if (photo) URL.revokeObjectURL(photo.url)
}

export type ProductPhotoKey = (typeof PRODUCT_PHOTO_SLOTS)[number]['key']
export type ProductPhotoMap = Partial<Record<ProductPhotoKey, ImageSlot>>

export function emptyProductPhotos(): ProductPhotoMap {
  return {}
}

export function productPhotoCount(photos: ProductPhotoMap) {
  return PRODUCT_PHOTO_SLOTS.filter((slot) => photos[slot.key]).length
}

export function revokeProductPhotos(photos: ProductPhotoMap) {
  for (const slot of PRODUCT_PHOTO_SLOTS) {
    const photo = photos[slot.key]
    if (photo) URL.revokeObjectURL(photo.url)
  }
}

export const OUTPUT_RATIOS = ['1:1', '4:5', '3:4', '2:3', '9:16', '16:9'] as const

export const USAGE_PURPOSES = [
  '상세페이지',
  '광고',
  'SNS',
  '배너',
  '기타',
] as const

export const REFERENCE_EXCLUDE_ITEMS = [
  '원래 제품 디자인',
  '타 브랜드 로고',
  '타 제품 색상/장식/하드웨어',
  '워터마크/문구',
] as const

export const FIXED_PROMPT = `Use product identity images for identity and structure. Use the explicitly labeled scale photo only for scale; never copy its wearer, pose, or scene.
Use each reference image only for its explicitly assigned role in the file list. Never borrow other scene elements from a role-specific reference.
The generated product must remain the exact same product shown in the product images.
Preserve:
- overall shape and proportions
- real-world scale
- original product color; lighting must not make the product appear to be a different color variant
- material, surface texture, pattern, and finish without artificial smoothing
- logo and label text, shape, size, orientation, and position; do not invent or rewrite lettering
- strap and handle length, width, attachment points, and structure
- closure, zipper, pocket, and hardware shape, count, placement, and finish
- visible seams, stitching, edges, and construction details
Do not redesign the product. Do not add, remove, relocate, or change any product feature. Requests to highlight a detail only affect framing, camera angle, lighting, and focus; they never authorize changing or enlarging that feature.
Do not copy the reference product's design, color, logo, hardware, or silhouette.
Place the provided product into one coherent scene assembled from the assigned reference roles. Never copy a reference product's identity.
Follow the selected reference mode: preserve staging in single/split mode; in exploration mode freely vary staging within the assigned reference roles. Scene changes never override product preservation or realistic physical behavior.
Maintain realistic physical behavior: correct gravity, realistic folds and deformation, proper surface contact, believable scale relative to props, natural contact shadows, no floating objects, and no object intersections.
Exclude people, body parts, mannequins, and human reflections from every output. Wearer photos are scale evidence only.
Straps must keep their actual length and attachment points and rest naturally under gravity, with realistic bends and contact shadows. No invisible hands or supports, unsupported suspension, or unnaturally upright soft straps.
Use unbranded replacements for any branded props in the reference.
Do not copy watermarks, captions, or graphic overlays from the reference, and do not add them to the output. Preserve the real product's own logos and labels.
Keep the product clearly readable and in focus, with natural exposure and believable reflections. Do not let props, glare, or heavy shadows obscure the details requested for emphasis.
Do not invent unseen interiors, hidden details, or measurements. Show only details supported by the supplied product photos, and use supplied dimensions when available.
When no detail is requested for emphasis, choose a balanced view that clearly shows the product as a whole while following the reference scene. When a requested detail cannot be shown faithfully with the supplied photos, preserve the product and do not fabricate it.
Priority order:
1. Product identity and structure
2. Realistic scale and physical behavior
3. Reference composition, lighting, and props
Create a realistic high-quality commercial product styling photograph.`

export type FormState = {
  productName: string
  productType: string
  fabricMaterial: string
  sizeWidth: string
  sizeHeight: string
  sizeDepth: string
  outputRatio: (typeof OUTPUT_RATIOS)[number]
  usagePurpose: (typeof USAGE_PURPOSES)[number]
  usageOther: string
  highlightDetails: string
  referenceMode: ReferenceMode
  variationCount: (typeof VARIATION_COUNTS)[number]
  modelHeightCm: string
  referenceChanges: string
  referenceExclude: Record<(typeof REFERENCE_EXCLUDE_ITEMS)[number], boolean>
}

export function emptyExclude() {
  return Object.fromEntries(
    REFERENCE_EXCLUDE_ITEMS.map((item) => [item, true]),
  ) as FormState['referenceExclude']
}

export function createInitialForm(): FormState {
  return {
    productName: '',
    productType: '',
    fabricMaterial: '',
    sizeWidth: '',
    sizeHeight: '',
    sizeDepth: '',
    outputRatio: '1:1',
    usagePurpose: '상세페이지',
    usageOther: '',
    highlightDetails: '',
    referenceMode: 'single',
    variationCount: '3',
    modelHeightCm: '',
    referenceChanges: '',
    referenceExclude: emptyExclude(),
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function createStyledPhoto(
  source: File,
  key: ProductPhotoKey | 'reference' | ReferenceRoleKey | ExplorationKey,
): ImageSlot {
  const extension = IMAGE_EXTENSIONS[source.type]
  if (!extension) throw new Error('JPG, PNG, WEBP 사진만 등록할 수 있습니다.')
  return {
    id: `${key}-${source.name}-${source.lastModified}`,
    file: source,
    url: URL.createObjectURL(source),
  }
}

export function missingRequiredPhotos(photos: ProductPhotoMap) {
  return PRODUCT_PHOTO_SLOTS.filter((slot) => slot.required && !photos[slot.key])
}

/** List only references active in the selected mode, using original filenames. */
export function buildStyledCutsPrompt(
  form: FormState,
  photos: ProductPhotoMap,
  reference: ImageSlot | null,
  splitReferences: ReferencePhotoMap = {},
  exploration: ExplorationPhotoMap = {},
): string {
  const attachments = PRODUCT_PHOTO_SLOTS.flatMap((slot) => {
    const photo = photos[slot.key]
    return photo ? [`- [제품 사진 · ${slot.label}] ${photo.file.name}: ${slot.key === 'scale' ? '크기 비교만을 위한 자료입니다. 사람·신체·착용 자세·배경은 결과에 가져오지 마세요.' : `제품의 ${slot.label} 모습입니다. 제품 정체성·형태·구조·색상·소재를 확인하는 자료로 사용하세요.`}`] : []
  })
  const references = activeReferencePhotos(form.referenceMode, reference, splitReferences, exploration)
  if (!attachments.length || !references.length) return ''
  attachments.push(...references.map(({ label, photo, scope }) => `- [참고 사진 · ${label}] ${photo.file.name}: ${scope}`))

  const productInfo = [
    form.productName.trim() && `제품명: ${form.productName.trim()}`,
    form.productType.trim() && `제품 종류: ${form.productType.trim()}`,
    form.fabricMaterial.trim() && `원단 재질: ${form.fabricMaterial.trim()}`,
    form.sizeWidth.trim() && `실제 가로: ${form.sizeWidth.trim()} mm`,
    form.sizeHeight.trim() && `실제 세로: ${form.sizeHeight.trim()} mm`,
    form.sizeDepth.trim() && `실제 폭: ${form.sizeDepth.trim()} mm`,
    `출력 비율: ${form.outputRatio}`,
    `사용 목적: ${form.usagePurpose === '기타' ? form.usageOther.trim() || '기타 (세부 목적 미지정)' : form.usagePurpose}`,
  ].filter(Boolean)
  const highlightDetails = form.highlightDetails.trim()
  const referenceChanges = form.referenceChanges.trim()
  const exclusions = REFERENCE_EXCLUDE_ITEMS.filter((item) => form.referenceExclude[item])

  return [
    form.referenceMode === 'explore' ? `첨부한 제품 사진과 참고 후보를 사용해 서로 다른 상업용 제품 연출 시안 ${form.variationCount}장을 각각 독립된 이미지로 만들어 주세요.` : '첨부한 제품 사진과 레퍼런스를 사용해 사실적인 상업용 제품 연출 사진 1장을 만들어 주세요.',
    `첨부 파일명과 역할\n${attachments.join('\n')}\n위 파일명과 역할을 정확히 연결하세요. 제품 사진은 모두 같은 제품을 보여주며, 참고 사진 속 제품 대신 이 제품을 배치하세요.`,
    `제품 정보 및 출력 조건\n${productInfo.map((line) => `- ${line}`).join('\n')}`,
    `사람 없는 제품 연출과 크기 참고\n- 모든 결과에 사람·신체 일부·마네킹·사람의 반사상이 나오지 않게 하세요. 착용 사진은 크기 비교에만 사용하고 착용 장면을 재현하지 마세요.\n- ${photos.scale && Number(form.modelHeightCm) > 0 ? `크기 참고컷의 착용자 키는 ${form.modelHeightCm.trim()} cm입니다. 사진의 원근·자세·잘림을 고려한 보조 크기 기준으로만 사용하세요. 키만으로 제품 치수를 정확히 계산했다고 가정하지 마세요.` : '착용자 키를 임의로 165 cm 등으로 가정하지 마세요. 확인되지 않은 치수는 만들지 마세요.'}\n- 입력된 실제 제품 치수를 최우선으로 사용하고, 크기 참고컷은 보조 단서로 사용하세요. 사람을 없앤 뒤에도 제품과 가구·소품의 크기 관계를 유지하세요.\n- 끈은 원래 길이·폭·연결 위치를 유지한 채 중력에 따라 놓으세요. 바닥이나 제품에 닿는 부분의 굽힘과 접촉 그림자를 표현하고, 보이지 않는 손이 들고 있는 듯 띄우거나 부드러운 끈을 뻣뻣하게 세우지 마세요.`,
    `원단·소재 표현
- 입력한 원단 재질을 소재 기준으로 사용하고, 소재 디테일 사진으로 실제 표면을 확인하세요. 이름만 보고 일반적인 다른 소재의 질감으로 대체하지 마세요.
- 사진에서 확인되는 직조·편직의 짜임, 결의 방향, 실의 굵기와 밀도, 보풀·기모, 가죽의 모공·엠보, 코팅의 표면과 무늬의 실제 크기를 유지하세요. 해당 소재에서 확인되는 특징만 반영하고 없는 결이나 무늬를 만들지 마세요.
- 원단의 두께·유연함·뻣뻣함과 그에 따른 접힘·주름·처짐을 사진에 맞추세요. 얇은 원단을 두꺼운 가죽처럼 만들거나 형태가 단단한 제품을 축 늘어지게 하지 마세요.
- 무광·반광·유광과 빛이 퍼지거나 반사되는 성질을 유지하세요. 레퍼런스 조명을 적용해도 천을 플라스틱처럼 매끈하게 만들거나 가죽·금속의 광택을 서로 바꾸지 마세요.
- 과도한 보정·노이즈 제거·선명화로 짜임을 지우거나 질감을 과장하지 마세요. 전체 제품 사진과 디테일 사진을 함께 사용해 색상·질감·무늬 크기를 일관되게 표현하세요.
- 재질을 입력하지 않은 경우 제품 사진에서 확인되는 표면만 보존하고, 섬유 성분·혼용률·정확한 두께를 추측하지 마세요. 입력한 재질과 사진의 표현이 충돌하면 임의로 재질을 바꾸지 말고 확인이 필요한 부분을 알려 주세요.`,
    `제품과 소품의 실제 크기 관계
- 입력된 제품의 가로·세로·폭(mm)을 실제 크기의 기준으로 사용하세요. 참고 사진 속 기존 제품의 크기나 화면에서 차지하는 면적을 우리 제품에 그대로 적용하지 마세요.
- 제품과 소품은 같은 공간에 놓인 실제 물체처럼 자연스러운 크기 관계를 유지하세요. 카메라와의 거리·원근·놓인 방향에 따른 보이는 크기 차이도 일관되게 반영하세요.
- 참고 구도를 맞추려고 제품이나 소품의 실제 크기를 비현실적으로 확대·축소하거나 비율을 늘이지 마세요. 특히 작은 제품을 참고 사진 속 큰 제품만큼 키우지 마세요.
- 제품의 실제 크기로는 참고 사진의 배치를 그대로 재현하기 어렵다면, 크기를 유지한 채 소품의 위치·간격과 카메라 거리·각도·화면 여백을 필요한 만큼 조정하세요. 이 크기 보존 규칙은 참고 배치를 따르라는 지시보다 우선합니다.
- 소품의 치수가 제공되지 않았다면 사진의 단서와 일상적으로 타당한 크기 범위를 참고하되, 정확한 치수를 아는 것으로 가정하지 마세요. 제품 치수도 입력되지 않았다면 첨부된 크기 참고컷 등 확인 가능한 단서를 사용하고, 없는 치수를 임의로 확정하지 마세요.
- 제품과 소품의 바닥 접촉·가림 관계·그림자·반사를 조정된 배치와 크기에 맞게 표현하세요.`,
    highlightDetails ? `특히 보여주고 싶은 부분\n${highlightDetails}\n제품 사진에서 확인되는 특징을 구도·각도·조명·초점으로 잘 보여 주세요. 강조를 위해 제품의 형태·크기·색상·구조를 바꾸거나 없는 특징을 추가하지 마세요.` : '',
    form.referenceMode === 'explore'
      ? `여러 시안을 자유롭게 구성하는 규칙
- 구도·배경·제품을 놓는 모습은 각각 후보 모음입니다. 시안마다 각 역할에서 어울리는 후보를 선택해 자유롭게 조합하세요. 모든 사진을 한 장면에 섞거나 모든 조합을 빠짐없이 만들 필요는 없습니다.
- 시안마다 카메라 각도·촬영 거리·여백·제품 방향·끈 배치에 의미 있는 차이를 주세요. 배경만 바꾼 거의 같은 컷을 반복하지 마세요. 번호별 구도를 미리 고정하지 않고 어울리는 조합을 선택하세요.
- 한 시안의 배경은 선택한 배경 후보를 중심으로 일관되게 구성하고 서로 다른 장소를 합성한 듯 섞지 마세요. 조명·그림자·원근과 소품 크기는 그 장면에 맞추세요.
- 제품 디자인·색상·원단 질감·실제 크기는 모든 시안에서 동일하게 유지하세요. 놓는 모습 후보는 실루엣을 바꾸라는 지시가 아닙니다. 보이지 않는 뒷면·내부를 새로 만들어야 하는 각도는 피하세요.
- 비워 둔 역할은 제공된 후보와 자연스럽게 어울리도록 보완하세요. 불필요한 소품은 추가하지 마세요.
- 각 결과는 ${form.outputRatio} 비율의 완결된 사진 한 장입니다. 콜라주·분할 화면·격자·연락판·컷 번호·문구 없이, 총 ${form.variationCount}개의 별도 이미지로 출력하세요. 생성 도구가 한 번에 한 이미지만 출력하면 그 이미지에는 독립 시안 하나만 담고 여러 컷을 욱여넣지 마세요.`
      : form.referenceMode === 'single'
      ? '참고 사진의 기본 연출\n참고 사진의 배경·배치·카메라 각도·조명·소품·분위기를 따라 연출하세요. 제품은 첨부한 제품 사진의 제품으로 교체하고, 제품 보존과 자연스러운 물리적 표현을 우선하세요.'
      : `여러 참고 사진을 합치는 규칙
- 파일별로 지정한 역할만 참고해 하나의 자연스러운 장면으로 구성하세요. 사진들을 콜라주처럼 나누거나 서로 다른 제품 디자인을 섞지 마세요.
- 구도는 구도 사진, 배경은 배경 사진, 빛은 조명·분위기 사진, 소품은 소품 사진에서만 가져오세요. 다른 역할의 사진으로 지정된 요소를 덮어쓰지 마세요.
- 우선순위는 제품 정체성·소재·실제 크기와 자연스러운 물리적 표현 → 구도 → 배경 → 조명·분위기 → 소품입니다. 충돌 시 각 역할을 유지하면서 위치·원근·그림자를 조율하세요. 낮은 우선순위라도 지정한 배경이나 조명 자체를 다른 사진에서 가져오지 마세요.
- ${REFERENCE_ROLE_SLOTS.filter((slot) => !splitReferences[slot.key]).map((slot) => slot.label).join(', ') || '없음'}: 전용 참고 사진이 없는 항목입니다. 없는 사진을 첨부했다고 가정하거나 다른 역할 사진의 요소를 몰래 복사하지 마세요. 사용자 요청이 있으면 적용하고, 없으면 지정된 요소와 어울리는 단순하고 자연스러운 연출로 보완하세요. 소품 참고와 소품 추가 요청이 모두 없으면 불필요한 소품을 추가하지 마세요.`,
    form.referenceMode === 'explore'
      ? `추가 연출 요청\n${referenceChanges || '별도 요청 없음. 후보 안에서 자연스럽고 다양한 연출을 제안하세요.'}\n추가 요청을 지키면서 구도와 배치를 자유롭게 달리하세요. 제품의 형태·색상·소재·로고·구조는 바꾸지 마세요.`
      : referenceChanges
      ? `참고 사진에서 바꾸고 싶은 점\n${referenceChanges}\n위에서 요청한 연출 요소만 변경하고 나머지는 참고 사진을 따르세요. 이 요청은 제품 자체의 형태·색상·소재·로고·구조를 바꾸는 허용이 아닙니다.`
      : '별도의 연출 변경 요청은 없습니다. 제품 보존 기본 원칙을 적용하면서 참고 사진의 연출을 따르세요.',
    exclusions.length ? `레퍼런스에서 가져오지 말 것 (추가 강조)\n${exclusions.map((line) => `- ${line}`).join('\n')}` : '',
    '제품 보존 기본 원칙\n아래 기본 원칙은 항상 적용합니다. 연출 조건과 충돌하면 제품의 정체성·구조와 실제 크기를 우선하고, 입력하지 않은 수치나 보이지 않는 제품 특징을 임의로 만들지 마세요.',
    FIXED_PROMPT,
  ].filter(Boolean).join('\n\n')
}
