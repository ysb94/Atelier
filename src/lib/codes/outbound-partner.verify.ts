/**
 * 출고업체 압축 키·상태 판정·붙여넣기 파싱 검증.
 * 실행: npm run verify:outbound-partner
 */
import {
  activateFolderSelectValue,
  canActivateOutboundPartner,
  compactOutboundPartnerKey,
  isOutboundPartnerIncomplete,
  matchesOutboundPartnerSearch,
  normalizeOutboundPartnerName,
  outboundPartnerActivateGaps,
  countOutboundCompanies,
  groupOutboundPartnersInFolder,
  isCompanyAsUnit,
  outboundFolderCountLabel,
  outboundPartnerContactPreview,
  outboundPartnerRowSummary,
  outboundPartnerDisplayName,
  outboundPartnerOptionLabel,
  outboundPartnerStatus,
  outboundPartnerUnitLabel,
  parseActivateFolderValue,
  parseOutboundPartnerPaste,
  keepsHeadquartersOnFirstBranch,
  remainingActiveInGroup,
  shouldCollapseRemainingToCompany,
  outboundPartnerDeleteBlockedMessage,
  synthesizeOutboundPartnerName,
} from "./outbound-partner";
import {
  ALL_CHILD_TAB_ID,
  UNFILED_TAB_ID,
  buildOutboundBrowserTabs,
  collectOutboundUnitSections,
  findOutboundCompanyForUnit,
  flattenOutboundUnits,
  groupOutboundSearchSections,
  outboundChannelFromFolderPath,
  outboundFolderTabs,
  outboundSectionPathLabel,
  resolveOutboundTabId,
} from "./outbound-partner-browser";
import {
  buildFolderForest,
  canCreateChildFolder,
  descendantFolderIds,
  folderMoveOptions,
  folderPathLabel,
  wouldCreateFolderCycle,
} from "./outbound-folder";
import type { CodeUsageTarget, CodeUsageTargetFolder } from "@/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 압축 키: 띄어쓰기·괄호·대소문자 차이를 흡수한다.
assert(
  compactOutboundPartnerKey("무신사 제주") ===
    compactOutboundPartnerKey("무신사제주"),
  "띄어쓰기만 다른 업체명은 같은 키여야 한다",
);
assert(
  compactOutboundPartnerKey("29CM") === compactOutboundPartnerKey("29cm"),
  "영문 대소문자는 같은 키여야 한다",
);
assert(
  compactOutboundPartnerKey("２９ＣＭ") === compactOutboundPartnerKey("29CM"),
  "전각 문자는 NFKC로 접어야 한다",
);
assert(
  compactOutboundPartnerKey("29CM 풀필먼트") === "29cm풀필먼트",
  "DB 백필과 같은 결과를 내야 한다",
);
assert(
  compactOutboundPartnerKey("!!!") === "",
  "글자·숫자가 없으면 빈 키여야 한다",
);
assert(
  compactOutboundPartnerKey("무신사") !== compactOutboundPartnerKey("무신사몰"),
  "다른 업체명이 같은 키로 합쳐지면 안 된다",
);

assert(
  normalizeOutboundPartnerName("  무신사   제주  ") === "무신사 제주",
  "표시용 이름은 앞뒤·연속 공백만 접는다",
);

// 상태: active와 isOneTime 조합이 세 상태를 만든다.
function target(patch: Partial<CodeUsageTarget> = {}): CodeUsageTarget {
  return {
    id: "id-1",
    brandId: "brand-1",
    name: "무신사",
    normalizedName: "무신사",
    active: true,
    isOneTime: false,
    channelType: "online",
    shippingMethod: "parcel",
    folderId: null,
    note: "",
    order: 0,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
    ...patch,
    groupId: patch.groupId === undefined ? "group-1" : patch.groupId,
    groupName: patch.groupName ?? "무신사",
    siteName: patch.siteName ?? "",
    normalizedSiteName: patch.normalizedSiteName ?? "",
    contactName: patch.contactName ?? "",
    contactPhone: patch.contactPhone ?? "",
    contactEmail: patch.contactEmail ?? "",
    address: patch.address ?? "",
  };
}

assert(
  outboundPartnerStatus(target()) === "ongoing",
  "활성·상시 업체는 거래중이다",
);
assert(
  outboundPartnerStatus(target({ isOneTime: true })) === "one_time",
  "활성·단발성 업체는 단발성이다",
);
assert(
  outboundPartnerStatus(target({ active: false })) === "archived",
  "비활성 업체는 archived다",
);
assert(
  outboundPartnerStatus(target({ active: false, isOneTime: true })) ===
    "archived",
  "비활성이 단발성보다 앞선다",
);

assert(
  !canActivateOutboundPartner({
    name: "29CM",
    folderId: undefined,
    note: "선구매",
  }),
  "위치를 고르지 않으면 다시 켤 수 없다",
);
assert(
  !canActivateOutboundPartner({
    name: "29CM",
    folderId: null,
    note: "",
  }),
  "특징이 비면 다시 켤 수 없다",
);
assert(
  canActivateOutboundPartner({
    name: "29CM",
    folderId: null,
    note: "선구매",
  }),
  "이름·위치·특징이 있으면 미분류로도 다시 켤 수 있다",
);
assert(
  outboundPartnerActivateGaps({
    name: "",
    folderId: undefined,
    note: "",
  }).join("|") === "업체명|둘 위치|이 업체의 특징",
  "빠진 칸을 모두 알려 준다",
);
assert(
  parseActivateFolderValue("__unfiled") === null,
  "미분류 선택은 null이다",
);
assert(
  parseActivateFolderValue("") === undefined,
  "빈 값은 아직 고르지 않은 것이다",
);
assert(
  activateFolderSelectValue(undefined) === "",
  "아직 고르지 않으면 선택 칸이 비어 있다",
);

assert(
  !isOutboundPartnerIncomplete(target({ channelType: "unset" })),
  "해외처럼 채널이 비어도 업체 그룹이 있으면 정리 필요가 아니다",
);
assert(
  isOutboundPartnerIncomplete(target({ groupId: null, groupName: "" })),
  "업체 그룹이 비면 정리 필요다",
);
assert(
  !isOutboundPartnerIncomplete(target({ shippingMethod: "unset" })),
  "출고 방식 미지정은 정리 필요가 아니다",
);
assert(
  outboundPartnerDisplayName(
    target({ groupName: "신라면세점", siteName: "제주점" }),
  ) === "신라면세점 · 제주점",
  "업체 그룹과 지점을 공용 표시명으로 조합해야 한다",
);
assert(
  outboundPartnerOptionLabel(
    target({ groupName: "에이랜드", siteName: "", channelType: "online" }),
  ) === "에이랜드 · 온라인",
  "선택 목록은 채널까지 한 줄에 표시해야 한다",
);
assert(
  outboundPartnerUnitLabel(
    target({ groupId: "group-1", groupName: "신라면세점", siteName: "제주점" }),
  ) === "제주점",
  "지점 행은 지점명만 보여 준다",
);
assert(
  outboundPartnerUnitLabel(
    target({
      groupId: "group-1",
      groupName: "신세계면세",
      name: "신세계면세점",
      siteName: "",
    }),
  ) === "신세계면세점",
  "지점 없는 줄은 업체 헤더와 다른 이름을 유지한다",
);
assert(
  synthesizeOutboundPartnerName({
    groupName: "에이랜드",
    siteName: "강남점",
    channelType: "offline",
  }) === "에이랜드 강남점 오프라인",
  "신규 지점 식별명은 업체·지점·채널을 이어 만든다",
);
assert(
  outboundPartnerContactPreview(
    target({ contactName: "김담당", contactPhone: "010-0000-0000" }),
  ) === "김담당 · 010-0000-0000",
  "담당자와 전화를 한 줄 미리보기로 붙인다",
);
assert(
  outboundPartnerRowSummary({
    aliasCount: 0,
    barcodeCount: 0,
    contact: "",
    note: "",
  }) === "",
  "적을 내용이 없으면 두 번째 줄을 비운다",
);
assert(
  outboundPartnerRowSummary({
    aliasCount: 2,
    barcodeCount: 0,
    contact: "김담당",
    note: "위탁\n두 번째 줄",
  }) === "별칭 2개 · 김담당 · 위탁",
  "0건은 빼고 메모는 첫 줄만 적는다",
);
assert(
  outboundFolderCountLabel(15, 15) === "15곳",
  "업체 수와 출고 단위 수가 같으면 한 번만 센다",
);
assert(
  outboundFolderCountLabel(8, 11) === "8개 업체 · 11곳",
  "지점으로 갈라지면 업체 수를 함께 보여 준다",
);

const legacyA = target({
  id: "legacy-a",
  name: "텐바이텐",
  groupId: null,
  groupName: "",
});
const legacyB = target({
  id: "legacy-b",
  name: "바인드",
  groupId: null,
  groupName: "",
});
const companyOnly = target({
  id: "unit-eland",
  groupId: "g-eland",
  groupName: "에이랜드",
  siteName: "",
});
const jeju = target({
  id: "unit-jeju",
  groupId: "g-shilla",
  groupName: "신라면세점",
  siteName: "제주점",
  normalizedSiteName: "제주점",
});
const t1 = target({
  id: "unit-t1",
  groupId: "g-shilla",
  groupName: "신라면세점",
  siteName: "인천공항 T1",
  normalizedSiteName: "인천공항t1",
});

const legacyNodes = groupOutboundPartnersInFolder([legacyA, legacyB]);
assert(legacyNodes.length === 2, "정리 전 행은 각각 업체 노드다");
assert(legacyNodes[0]?.mode === "legacy", "그룹이 없으면 legacy다");
assert(
  countOutboundCompanies([legacyA, legacyB, companyOnly]) === 3,
  "레거시 2곳과 업체 1곳을 따로 센다",
);

const companyNodes = groupOutboundPartnersInFolder([companyOnly]);
assert(
  companyNodes[0]?.mode === "company-as-unit",
  "지점 없는 업체는 그 행이 출고 단위다",
);
assert(
  isCompanyAsUnit(companyNodes[0]?.units ?? []),
  "지점 없는 업체 판별이 맞아야 한다",
);
assert(
  keepsHeadquartersOnFirstBranch(companyNodes[0]!),
  "첫 지점을 늘리면 기존 행은 본사로 남긴다",
);

const loneBranch = target({
  id: "unit-lotte",
  groupId: "g-lotte",
  groupName: "롯데면세점",
  siteName: "인천공항점",
  normalizedSiteName: "인천공항점",
});
const loneBranchNodes = groupOutboundPartnersInFolder([loneBranch]);
assert(
  loneBranchNodes[0]?.mode === "company-as-unit",
  "지점이 하나뿐이면 업체 그 자체로 본다",
);
assert(
  isCompanyAsUnit(loneBranchNodes[0]?.units ?? []),
  "지점 하나짜리 업체는 묶지 않는다",
);
assert(
  !keepsHeadquartersOnFirstBranch(loneBranchNodes[0]!),
  "이미 지점명이 있으면 그 줄은 본사로 바꾸지 않는다",
);
assert(
  remainingActiveInGroup([companyOnly, loneBranch], loneBranch).length === 0,
  "다른 업체 줄은 같은 그룹이 아니다",
);
assert(
  remainingActiveInGroup([jeju, t1], jeju).length === 1,
  "같은 업체 다른 지점은 남는 줄이다",
);
assert(
  shouldCollapseRemainingToCompany(1),
  "하나만 남으면 지점 없는 업체로 되돌린다",
);
assert(
  !shouldCollapseRemainingToCompany(2),
  "지점이 둘 이상 남으면 묶음을 유지한다",
);

const branched = groupOutboundPartnersInFolder([jeju, t1]);
assert(branched.length === 1, "같은 업체 지점은 한 노드로 묶인다");
assert(branched[0]?.mode === "branched", "지점이 있으면 branched다");
assert(branched[0]?.units.length === 2, "지점 두 곳이 자식이다");
assert(
  !keepsHeadquartersOnFirstBranch(branched[0]!),
  "이미 지점이 있으면 형제 지점만 추가한다",
);

const hqThenBranch = groupOutboundPartnersInFolder([
  jeju,
  target({
    id: "unit-shilla-hq",
    groupId: "g-shilla",
    groupName: "신라면세점",
    name: "신라면세점",
    siteName: "",
  }),
]);
assert(
  hqThenBranch[0]?.units[0]?.id === "unit-shilla-hq",
  "지점 없는 줄은 업체 묶음 맨 위에 둔다",
);
const inactiveAtBottom = groupOutboundPartnersInFolder([
  target({
    id: "inactive-kakao",
    name: "카카오선물하기",
    groupId: "g-kakao",
    groupName: "카카오선물하기",
    active: false,
  }),
  companyOnly,
  target({
    id: "inactive-ssg",
    name: "SSG",
    groupId: "g-ssg",
    groupName: "SSG",
    active: false,
  }),
]);
assert(
  inactiveAtBottom.map((node) => node.units[0]?.id).join("|") ===
    "unit-eland|inactive-kakao|inactive-ssg",
  "비활성 업체는 폴더 맨 아래로 내린다",
);
const inactiveUnitLast = groupOutboundPartnersInFolder([
  target({
    id: "unit-inactive-branch",
    groupId: "g-shilla",
    groupName: "신라면세점",
    siteName: "면세점",
    active: false,
  }),
  jeju,
]);
assert(
  inactiveUnitLast[0]?.units.map((unit) => unit.id).join("|") ===
    "unit-jeju|unit-inactive-branch",
  "비활성 지점은 같은 업체 맨 아래에 둔다",
);
assert(
  outboundPartnerUnitLabel(hqThenBranch[0]!.units[0]!) === "신라면세점",
  "맨 위 줄은 그 줄의 이름을 쓴다",
);
assert(
  outboundPartnerDeleteBlockedMessage([]) === null,
  "연결이 없으면 삭제할 수 있다",
);
assert(
  outboundPartnerDeleteBlockedMessage(["거래처 바코드", "바코드 출고 등록"]) ===
    "거래처 바코드, 바코드 출고 등록이(가) 있어 삭제할 수 없습니다. 비활성화하세요.",
  "연결이 있으면 삭제 대신 비활성화를 안내한다",
);

// 검색: 정식명과 별칭 모두 걸린다.
assert(
  matchesOutboundPartnerSearch("무신사", target(), []),
  "정식명으로 검색되어야 한다",
);
assert(
  matchesOutboundPartnerSearch("mss", target(), ["MSS"]),
  "별칭으로도 검색되어야 한다",
);
assert(
  matchesOutboundPartnerSearch("주 무신사", target(), ["(주)무신사"]),
  "별칭 검색도 띄어쓰기를 무시한다",
);
assert(
  matchesOutboundPartnerSearch(
    "제주",
    target({
      groupName: "신라면세점",
      siteName: "제주점",
      normalizedSiteName: "제주점",
    }),
    [],
  ),
  "지점 이름으로 검색되어야 한다",
);
assert(
  !matchesOutboundPartnerSearch("29cm", target(), ["MSS"]),
  "관계없는 검색어는 걸리지 않는다",
);
assert(
  matchesOutboundPartnerSearch("   ", target(), []),
  "빈 검색어는 모두 통과시킨다",
);

// 붙여넣기: 한 줄 = 업체 하나, 첫 구분자 뒤는 별칭이다.
const basic = parseOutboundPartnerPaste(
  ["무신사 / MSS, (주)무신사", "29CM", "", "면세점\t듀프리"].join("\n"),
);
assert(basic.rows.length === 3, "빈 줄은 건너뛰고 3곳을 읽어야 한다");
assert(basic.rows[0]?.name === "무신사", "첫 업체명은 무신사다");
assert(
  basic.rows[0]?.aliases.join("|") === "MSS|(주)무신사",
  "슬래시 뒤 쉼표 목록을 별칭으로 읽는다",
);
assert(basic.rows[1]?.aliases.length === 0, "별칭이 없으면 빈 배열이다");
assert(
  basic.rows[2]?.name === "면세점" && basic.rows[2]?.aliases[0] === "듀프리",
  "엑셀 탭 구분도 이름과 별칭으로 나눈다",
);
assert(basic.issues.length === 0, "정상 목록에는 문제가 없다");

const dupInPaste = parseOutboundPartnerPaste(["무신사", "무 신사"].join("\n"));
assert(dupInPaste.rows.length === 1, "붙여넣기 안 중복은 한 번만 등록한다");
assert(
  dupInPaste.issues[0]?.reason === "duplicate_in_paste",
  "중복 줄은 사유와 함께 남긴다",
);

const dupExisting = parseOutboundPartnerPaste("29CM", ["29cm"]);
assert(dupExisting.rows.length === 0, "이미 등록된 업체는 건너뛴다");
assert(
  dupExisting.issues[0]?.reason === "duplicate_existing",
  "기존 중복도 사유를 남긴다",
);

const emptyName = parseOutboundPartnerPaste("!!! / 별칭");
assert(emptyName.rows.length === 0, "읽을 수 없는 업체명은 등록하지 않는다");
assert(
  emptyName.issues[0]?.reason === "empty_name",
  "업체명을 읽지 못한 줄은 사유를 남긴다",
);

const selfAlias = parseOutboundPartnerPaste("무신사 / 무 신사, MSS");
assert(
  selfAlias.rows[0]?.aliases.join("|") === "MSS",
  "정식명과 같은 별칭은 넣지 않는다",
);

const dupAlias = parseOutboundPartnerPaste("무신사 / MSS, m s s");
assert(
  dupAlias.rows[0]?.aliases.length === 1,
  "같은 키의 별칭은 한 번만 남긴다",
);

function folder(
  patch: Partial<CodeUsageTargetFolder> &
    Pick<CodeUsageTargetFolder, "id" | "name" | "parentId">,
): CodeUsageTargetFolder {
  return {
    brandId: "brand-1",
    normalizedName: patch.name.replace(/\s+/g, ""),
    order: 0,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
    ...patch,
  };
}

const online = folder({ id: "f-online", name: "온라인", parentId: null });
const direct = folder({
  id: "f-direct",
  name: "직접배송",
  parentId: "f-online",
});
const sabang = folder({ id: "f-sabang", name: "사방넷", parentId: "f-direct" });
const extra = folder({ id: "f-extra", name: "추가", parentId: "f-sabang" });
const tree = [online, direct, sabang, extra];

const forest = buildFolderForest(tree);
assert(
  forest.length === 1 && forest[0]?.name === "온라인",
  "루트는 온라인 하나다",
);
assert(
  forest[0]?.children[0]?.children[0]?.name === "사방넷",
  "온라인 > 직접배송 > 사방넷 순이어야 한다",
);
assert(
  folderPathLabel(tree, "f-sabang") === "온라인 / 직접배송 / 사방넷",
  "경로 표시는 슬래시로 잇는다",
);
assert(folderPathLabel(tree, null) === "미분류", "폴더가 없으면 미분류다");
assert(
  outboundChannelFromFolderPath(tree, "f-sabang") === "online",
  "하위 폴더는 루트 온라인 탭의 채널을 따른다",
);
const searchGrouped = groupOutboundSearchSections({
  folders: tree,
  hits: [
    target({ id: "s-1", name: "무신사", folderId: "f-sabang" }),
    target({ id: "s-2", name: "무신사", folderId: "f-extra" }),
  ],
});
assert(searchGrouped.length === 2, "검색은 같은 이름을 폴더로 갈라 보여 준다");
assert(
  searchGrouped[0]?.pathLabel === "온라인 / 직접배송 / 사방넷",
  "검색 묶음은 전체 경로를 제목으로 쓴다",
);
assert(
  searchGrouped[1]?.pathLabel === "온라인 / 직접배송 / 사방넷 / 추가",
  "더 깊은 폴더는 뒤에 온다",
);
assert(
  outboundChannelFromFolderPath(
    [folder({ id: "f-off", name: "오프라인", parentId: null })],
    "f-off",
  ) === "offline",
  "오프라인 탭은 오프라인 채널이다",
);
assert(
  outboundChannelFromFolderPath(tree, null) === "unset",
  "미분류는 채널을 비운다",
);
assert(
  wouldCreateFolderCycle(tree, "f-online", "f-sabang"),
  "하위로 옮기면 순환이다",
);
assert(
  !wouldCreateFolderCycle(tree, "f-sabang", null),
  "루트로 올리는 것은 순환이 아니다",
);
assert(
  descendantFolderIds(tree, "f-online").size === 3,
  "온라인 아래 폴더는 세 개다",
);
assert(
  canCreateChildFolder(tree, "f-sabang"),
  "3단 아래에는 한 단 더 만들 수 있다",
);
assert(!canCreateChildFolder(tree, "f-extra"), "4단 아래에는 더 만들지 못한다");
assert(
  folderMoveOptions(tree).some(
    (option) => option.label === "온라인 / 직접배송 / 사방넷",
  ),
  "이동 목록은 경로로 보여 준다",
);

const cardsByFolder = new Map<string | null, CodeUsageTarget[]>([
  ["f-online", [companyOnly]],
  ["f-sabang", [legacyA]],
  ["f-extra", [jeju]],
  [null, [legacyB]],
]);
const cardsIn = (id: string | null) => cardsByFolder.get(id) ?? [];

const browserTabs = buildOutboundBrowserTabs({
  forest,
  folders: tree,
  cardsIn,
  unfiled: cardsIn(null),
});
assert(browserTabs[0]?.id === "f-online", "첫 탭은 루트 폴더다");
assert(browserTabs[0]?.unitCount === 3, "루트 탭은 하위 출고 단위까지 센다");
assert(browserTabs[0]?.companyCount === 3, "루트 탭은 하위 업체까지 센다");
assert(
  browserTabs.some((tab) => tab.id === UNFILED_TAB_ID && tab.unitCount === 1),
  "미분류 탭은 항상 있다",
);
assert(
  browserTabs.every((tab) => tab.label !== "비활성"),
  "비활성은 별도 탭이 아니라 해당 폴더에 남긴다",
);

const childTabs = outboundFolderTabs(forest[0]!, tree, cardsIn);
assert(childTabs[0]?.id === ALL_CHILD_TAB_ID, "자식이 있으면 전체 탭이 먼저다");
assert(
  childTabs.some((tab) => tab.label === "직접배송"),
  "2단 탭은 바로 아래 폴더만 보여 준다",
);
assert(
  !childTabs.some((tab) => tab.label === "사방넷"),
  "3단 폴더는 탭이 아니라 목록 소제목이다",
);
assert(
  outboundFolderTabs(
    { ...extra, children: [], depth: 4 },
    tree,
    cardsIn,
  ).length === 0,
  "자식이 없으면 2단 탭을 숨긴다",
);

assert(
  resolveOutboundTabId(browserTabs, "gone") === "f-online",
  "없는 탭을 고르면 첫 탭으로 돌아간다",
);
assert(
  resolveOutboundTabId(browserTabs, UNFILED_TAB_ID) === UNFILED_TAB_ID,
  "있는 탭은 그대로 둔다",
);
assert(resolveOutboundTabId([], "x") === null, "탭이 없으면 null이다");

const allSections = collectOutboundUnitSections({
  folders: tree,
  folderId: "f-online",
  cardsIn,
  includeDescendants: true,
});
assert(allSections[0]?.companies[0]?.units[0]?.id === "unit-eland", "선택 폴더 직접 업체가 먼저다");
assert(
  allSections.some((section) => section.pathLabel === "직접배송 / 사방넷"),
  "3단 이하는 상대 경로 소제목이다",
);
assert(
  allSections.some((section) => section.pathLabel === "직접배송 / 사방넷 / 추가"),
  "4단도 탭이 아니라 소제목이다",
);
assert(
  collectOutboundUnitSections({
    folders: tree,
    folderId: "f-online",
    cardsIn,
    includeDescendants: false,
  }).length === 1,
  "전체 탭이 아니면 자손을 펼치지 않을 수 있다",
);

assert(
  outboundSectionPathLabel(tree, "f-online", "f-sabang") ===
    "직접배송 / 사방넷",
  "소제목은 선택한 탭 아래만 적는다",
);

const found = findOutboundCompanyForUnit(allSections, "legacy-a");
assert(found?.mode === "legacy", "섹션에서 출고 단위의 업체를 찾는다");
assert(
  flattenOutboundUnits(allSections).map((unit) => unit.id).join("|") ===
    "unit-eland|legacy-a|unit-jeju",
  "보이는 섹션의 출고 단위를 평평하게 펼친다",
);

console.log("outbound-partner: 모든 검증을 통과했습니다.");
