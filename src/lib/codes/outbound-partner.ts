import type {
  CodeUsageTarget,
  OutboundChannelType,
  OutboundPartnerStatus,
  OutboundShippingMethod,
} from "@/lib/types";

/**
 * 업체명 비교용 압축 키.
 * NFKC로 전각을 접고 소문자화한 뒤 한글·영문·숫자만 남긴다.
 * 원문 표기는 바꾸지 않으며 중복 판정과 검색에만 쓴다.
 * DB 백필(`20260828015800_outbound_partner_aliases.sql`)과 같은 규칙이다.
 */
export function compactOutboundPartnerKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

/** 표시용 원문 정리. 앞뒤·연속 공백만 접고 글자는 유지한다. */
export function normalizeOutboundPartnerName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export const OUTBOUND_CHANNEL_TYPES: readonly OutboundChannelType[] = [
  "unset",
  "online",
  "offline",
];

export const OUTBOUND_SHIPPING_METHODS: readonly OutboundShippingMethod[] = [
  "unset",
  "parcel",
  "fulfillment",
  "freight",
  "pickup",
];

export const OUTBOUND_CHANNEL_TYPE_LABEL: Record<OutboundChannelType, string> =
  {
    unset: "미지정",
    online: "온라인",
    offline: "오프라인",
  };

export const OUTBOUND_SHIPPING_METHOD_LABEL: Record<
  OutboundShippingMethod,
  string
> = {
  unset: "미지정",
  parcel: "택배",
  fulfillment: "풀필먼트",
  freight: "용차",
  pickup: "직접수령",
};

export const OUTBOUND_PARTNER_STATUS_LABEL: Record<
  OutboundPartnerStatus,
  string
> = {
  ongoing: "거래중",
  one_time: "단발성",
  archived: "비활성",
};

export function isOutboundChannelType(
  value: string,
): value is OutboundChannelType {
  return (OUTBOUND_CHANNEL_TYPES as readonly string[]).includes(value);
}

export function isOutboundShippingMethod(
  value: string,
): value is OutboundShippingMethod {
  return (OUTBOUND_SHIPPING_METHODS as readonly string[]).includes(value);
}

/** 비활성이 거래중·단발성보다 앞선다. 한 업체는 한 상태만 가진다. */
export function outboundPartnerStatus(
  target: Pick<CodeUsageTarget, "active" | "isOneTime">,
): OutboundPartnerStatus {
  if (!target.active) return "archived";
  return target.isOneTime ? "one_time" : "ongoing";
}

/** 다시 켤 때 위치를 아직 고르지 않은 상태. null은 미분류를 고른 것이다. */
export type OutboundPartnerActivateDraft = {
  name: string;
  folderId: string | null | undefined;
  note: string;
};

export function outboundPartnerActivateGaps(
  draft: OutboundPartnerActivateDraft,
): string[] {
  const gaps: string[] = [];
  if (!normalizeOutboundPartnerName(draft.name)) gaps.push("업체명");
  if (draft.folderId === undefined) gaps.push("둘 위치");
  if (!draft.note.trim()) gaps.push("이 업체의 특징");
  return gaps;
}

/** 비활성 업체를 다시 켜려면 이름·위치·특징을 모두 채워야 한다. */
export function canActivateOutboundPartner(
  draft: OutboundPartnerActivateDraft,
): boolean {
  return outboundPartnerActivateGaps(draft).length === 0;
}

export function activateFolderSelectValue(
  folderId: string | null | undefined,
): string {
  if (folderId === undefined) return "";
  return folderId ?? "__unfiled";
}

export function parseActivateFolderValue(
  value: string,
): string | null | undefined {
  if (value === "") return undefined;
  if (value === "__unfiled") return null;
  return value;
}

/** 업체 그룹이 없는 행. 채널은 폴더 탭에서 따르므로 여기 조건이 아니다. */
export function isOutboundPartnerIncomplete(
  target: Pick<CodeUsageTarget, "groupId">,
): boolean {
  return !target.groupId;
}

/** 모든 화면에서 동일하게 쓰는 업체·지점 표시명. */
export function outboundPartnerDisplayName(
  target: Pick<CodeUsageTarget, "name" | "groupName" | "siteName">,
): string {
  if (!target.groupName) return target.name;
  return target.siteName
    ? `${target.groupName} · ${target.siteName}`
    : target.groupName;
}

/** 선택 목록처럼 배지를 쓸 수 없는 곳의 채널 포함 한 줄 표기. */
export function outboundPartnerOptionLabel(
  target: Pick<
    CodeUsageTarget,
    "name" | "groupName" | "siteName" | "channelType"
  >,
): string {
  const name = outboundPartnerDisplayName(target);
  return target.channelType === "unset"
    ? name
    : `${name} · ${OUTBOUND_CHANNEL_TYPE_LABEL[target.channelType]}`;
}

/** 업체 노드 아래 지점 행에 쓰는 짧은 이름. 헤더 업체명과 별개다. */
export function outboundPartnerUnitLabel(
  target: Pick<CodeUsageTarget, "name" | "groupId" | "siteName">,
): string {
  if (!target.groupId) return target.name;
  return normalizeOutboundPartnerName(target.siteName) || target.name;
}

export function synthesizeOutboundPartnerName(input: {
  groupName: string;
  siteName?: string;
  channelType: OutboundChannelType;
}): string {
  const channelLabel =
    input.channelType === "unset"
      ? ""
      : OUTBOUND_CHANNEL_TYPE_LABEL[input.channelType];
  return [input.groupName, input.siteName?.trim(), channelLabel]
    .filter(Boolean)
    .join(" ");
}

export type OutboundCompanyMode = "legacy" | "company-as-unit" | "branched";

export type OutboundCompanyInFolder = {
  key: string;
  folderId: string | null;
  groupId: string | null;
  groupName: string;
  units: CodeUsageTarget[];
  mode: OutboundCompanyMode;
};

export function isCompanyAsUnit(
  units: readonly Pick<CodeUsageTarget, "groupId">[],
): boolean {
  return units.length === 1 && Boolean(units[0]?.groupId);
}

/**
 * 지점 없는 업체에 지점을 늘릴 때 기존 행은 본사로 남긴다.
 * 이미 지점명이 있는 한 줄이면 그 이름을 유지하고 새 행만 만든다.
 */
export function keepsHeadquartersOnFirstBranch(
  company: Pick<OutboundCompanyInFolder, "mode" | "units">,
): boolean {
  if (company.mode !== "company-as-unit") return false;
  return !normalizeOutboundPartnerName(company.units[0]?.siteName ?? "");
}

/** 같은 업체에서 이 줄을 빼면 남는 활성 출고 단위. */
export function remainingActiveInGroup(
  targets: readonly Pick<CodeUsageTarget, "id" | "groupId" | "active">[],
  unit: Pick<CodeUsageTarget, "id" | "groupId">,
): Pick<CodeUsageTarget, "id" | "groupId" | "active">[] {
  if (!unit.groupId) return [];
  return targets.filter(
    (item) =>
      item.active && item.groupId === unit.groupId && item.id !== unit.id,
  );
}

/** 하나만 남으면 지점 없는 업체로 되돌린다. */
export function shouldCollapseRemainingToCompany(
  remainingActiveCount: number,
): boolean {
  return remainingActiveCount === 1;
}

/** 바코드·출고·송장 연결이 있으면 삭제 대신 비활성화한다. */
export function outboundPartnerDeleteBlockedMessage(
  links: readonly string[],
): string | null {
  if (links.length === 0) return null;
  return `${links.join(", ")}이(가) 있어 삭제할 수 없습니다. 비활성화하세요.`;
}

export function sortOutboundCompanyUnits<
  T extends Pick<CodeUsageTarget, "name" | "siteName" | "active">,
>(units: readonly T[]): T[] {
  return [...units].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    const leftHq = !normalizeOutboundPartnerName(left.siteName);
    const rightHq = !normalizeOutboundPartnerName(right.siteName);
    if (leftHq !== rightHq) return leftHq ? -1 : 1;
    return (left.siteName || left.name).localeCompare(
      right.siteName || right.name,
      "ko",
    );
  });
}

function isCompanyInactive(
  units: readonly Pick<CodeUsageTarget, "active">[],
): boolean {
  return units.length > 0 && units.every((unit) => !unit.active);
}

/** 비활성 업체는 폴더 맨 아래에 둔다. */
export function sortOutboundCompaniesInFolder<
  T extends { units: readonly Pick<CodeUsageTarget, "active">[] },
>(companies: readonly T[]): T[] {
  return [...companies].sort((left, right) => {
    const leftInactive = isCompanyInactive(left.units);
    const rightInactive = isCompanyInactive(right.units);
    if (leftInactive !== rightInactive) return leftInactive ? 1 : -1;
    return 0;
  });
}

/** 한 폴더(또는 미분류) 안의 출고 단위를 업체 노드로 묶는다. */
export function groupOutboundPartnersInFolder(
  targets: readonly CodeUsageTarget[],
): OutboundCompanyInFolder[] {
  const buckets = new Map<string, CodeUsageTarget[]>();
  const order: string[] = [];

  targets.forEach((target) => {
    const key = target.groupId ?? `legacy:${target.id}`;
    const list = buckets.get(key);
    if (list) list.push(target);
    else {
      buckets.set(key, [target]);
      order.push(key);
    }
  });

  return sortOutboundCompaniesInFolder(
    order.map((key) => {
      const units = sortOutboundCompanyUnits(buckets.get(key) ?? []);
      const first = units[0];
      const groupId = first?.groupId ?? null;
      const groupName = first?.groupName || first?.name || "";
      const mode: OutboundCompanyMode = !groupId
        ? "legacy"
        : isCompanyAsUnit(units)
          ? "company-as-unit"
          : "branched";
      return {
        key,
        folderId: first?.folderId ?? null,
        groupId,
        groupName,
        units,
        mode,
      };
    }),
  );
}

export function countOutboundCompanies(
  targets: readonly CodeUsageTarget[],
): number {
  return groupOutboundPartnersInFolder(targets).length;
}

export function outboundPartnerContactPreview(
  target: Pick<CodeUsageTarget, "contactName" | "contactPhone">,
): string {
  return [target.contactName.trim(), target.contactPhone.trim()]
    .filter(Boolean)
    .join(" · ");
}

/** 목록 두 번째 줄. 0건은 적지 않아 줄을 짧게 유지한다. */
export function outboundPartnerRowSummary(input: {
  aliasCount: number;
  barcodeCount: number;
  contact: string;
  note: string;
}): string {
  const noteLine =
    input.note
      .trim()
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "";
  return [
    input.aliasCount > 0 ? `별칭 ${input.aliasCount}개` : "",
    input.barcodeCount > 0 ? `바코드 ${input.barcodeCount}건` : "",
    input.contact.trim(),
    noteLine,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 업체 수와 출고 단위 수가 같으면 한 번만 센다. */
export function outboundFolderCountLabel(
  companyCount: number,
  unitCount: number,
): string {
  return companyCount === unitCount
    ? `${unitCount}곳`
    : `${companyCount}개 업체 · ${unitCount}곳`;
}

export type ParsedOutboundPartnerLine = {
  lineNumber: number;
  name: string;
  normalizedName: string;
  aliases: string[];
};

export type OutboundPartnerPasteIssue = {
  lineNumber: number;
  text: string;
  reason: "duplicate_in_paste" | "duplicate_existing" | "empty_name";
};

export type OutboundPartnerPasteResult = {
  rows: ParsedOutboundPartnerLine[];
  issues: OutboundPartnerPasteIssue[];
};

/**
 * 한 줄 = 업체 하나.
 * `무신사` 또는 `무신사 / MSS, (주)무신사`처럼 첫 구분자 뒤를 별칭으로 읽는다.
 * 엑셀에서 복사한 탭 구분도 같은 방식으로 처리한다.
 */
export function parseOutboundPartnerPaste(
  text: string,
  existingKeys: readonly string[] = [],
): OutboundPartnerPasteResult {
  const taken = new Set(existingKeys);
  const seen = new Set<string>();
  const rows: ParsedOutboundPartnerLine[] = [];
  const issues: OutboundPartnerPasteIssue[] = [];

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;

    const separator = line.search(/[\t/|]/);
    const namePart = separator === -1 ? line : line.slice(0, separator);
    const aliasPart = separator === -1 ? "" : line.slice(separator + 1);

    const name = normalizeOutboundPartnerName(namePart);
    const normalizedName = compactOutboundPartnerKey(name);
    if (!normalizedName) {
      issues.push({ lineNumber, text: line, reason: "empty_name" });
      return;
    }
    if (taken.has(normalizedName)) {
      issues.push({ lineNumber, text: line, reason: "duplicate_existing" });
      return;
    }
    if (seen.has(normalizedName)) {
      issues.push({ lineNumber, text: line, reason: "duplicate_in_paste" });
      return;
    }
    seen.add(normalizedName);

    const aliasSeen = new Set<string>([normalizedName]);
    const aliases: string[] = [];
    aliasPart
      .split(/[,;\t|]/)
      .map((part) => normalizeOutboundPartnerName(part))
      .filter(Boolean)
      .forEach((alias) => {
        const key = compactOutboundPartnerKey(alias);
        if (!key || aliasSeen.has(key)) return;
        aliasSeen.add(key);
        aliases.push(alias);
      });

    rows.push({ lineNumber, name, normalizedName, aliases });
  });

  return { rows, issues };
}

/** 검색어가 업체 그룹·지점·기존 식별명·별칭에 걸리는지 본다. */
export function matchesOutboundPartnerSearch(
  keyword: string,
  target: Pick<
    CodeUsageTarget,
    | "name"
    | "normalizedName"
    | "groupName"
    | "siteName"
    | "normalizedSiteName"
    | "channelType"
  >,
  aliases: readonly string[],
): boolean {
  const key = compactOutboundPartnerKey(keyword);
  if (!key) return true;
  const haystack = [
    target.normalizedName || compactOutboundPartnerKey(target.name),
    compactOutboundPartnerKey(target.groupName),
    target.normalizedSiteName || compactOutboundPartnerKey(target.siteName),
    compactOutboundPartnerKey(OUTBOUND_CHANNEL_TYPE_LABEL[target.channelType]),
    ...aliases.map(compactOutboundPartnerKey),
  ];
  return haystack.some((value) => value.includes(key));
}
