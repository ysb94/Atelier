import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { outboundChannelFromFolderPath } from "@/lib/codes/outbound-partner-browser";
import {
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
  type OutboundCompanyMode,
} from "@/lib/codes/outbound-partner";
import {
  CodeUsageTargetStoreError,
  createOutboundPartnerGroup,
  updateCodeUsageTarget,
  updateOutboundPartnerGroup,
} from "@/lib/api";
import type {
  CodeUsageTarget,
  CodeUsageTargetFolder,
  OutboundPartnerGroup,
} from "@/lib/types";
export type AliasOwner = {
  targetId: string;
  targetName: string;
  kind: "name" | "alias";
};

export function OutboundPartnerContactFields({
  contactName,
  contactPhone,
  contactEmail,
  address,
  note,
  pending,
  onContactName,
  onContactPhone,
  onContactEmail,
  onAddress,
  onNote,
}: {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  note: string;
  pending: boolean;
  onContactName: (value: string) => void;
  onContactPhone: (value: string) => void;
  onContactEmail: (value: string) => void;
  onAddress: (value: string) => void;
  onNote: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            담당자
          </span>
          <Input
            value={contactName}
            placeholder="이 출고 단위 담당자"
            disabled={pending}
            onChange={(event) => onContactName(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            전화번호
          </span>
          <Input
            value={contactPhone}
            placeholder="업무 전화"
            disabled={pending}
            onChange={(event) => onContactPhone(event.target.value)}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          이메일
        </span>
        <Input
          type="email"
          value={contactEmail}
          placeholder="업무 이메일"
          disabled={pending}
          onChange={(event) => onContactEmail(event.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">주소</span>
        <Textarea
          rows={2}
          value={address}
          placeholder="출고·납품 주소. 고객 수령 주소가 아닙니다."
          disabled={pending}
          onChange={(event) => onAddress(event.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          운영 메모
        </span>
        <Textarea
          rows={3}
          value={note}
          placeholder="주문 통로, 선구매인지 위탁인지, 포장 주의처럼 이 줄만의 이야기를 적습니다."
          disabled={pending}
          onChange={(event) => onNote(event.target.value)}
        />
      </label>
    </div>
  );
}

/**
 * 펼친 카드에서만 마운트한다.
 * 업체·지점 계층은 트리에 두고, 여기에는 그 출고 단위의 연락처와 운영 정보만 적는다.
 */
export function OutboundPartnerEditForm({
  target,
  aliases,
  folders,
  groups,
  companyMode = "legacy",
  ownerByKey,
  onClose,
  onChanged,
}: {
  target: CodeUsageTarget;
  aliases: readonly string[];
  folders: readonly CodeUsageTargetFolder[];
  groups: readonly OutboundPartnerGroup[];
  companyMode?: OutboundCompanyMode;
  ownerByKey: Map<string, AliasOwner>;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [name, setName] = useState(target.name);
  const [groupName, setGroupName] = useState(
    companyMode === "branched" &&
      !normalizeOutboundPartnerName(target.siteName)
      ? target.name
      : target.groupName || target.name,
  );
  const [siteName, setSiteName] = useState(target.siteName);
  const [contactName, setContactName] = useState(target.contactName);
  const [contactPhone, setContactPhone] = useState(target.contactPhone);
  const [contactEmail, setContactEmail] = useState(target.contactEmail);
  const [address, setAddress] = useState(target.address);
  const [note, setNote] = useState(target.note);
  const [aliasList, setAliasList] = useState<string[]>([...aliases]);
  const [aliasInput, setAliasInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [organizeMode, setOrganizeMode] = useState<"company" | "branch" | null>(
    null,
  );
  const [organizeGroupName, setOrganizeGroupName] = useState(target.name);
  const [organizeGroupId, setOrganizeGroupId] = useState(groups[0]?.id ?? "");
  const [organizeSiteName, setOrganizeSiteName] = useState("");

  const legacy = !target.groupId;
  const namedBranch = Boolean(
    target.groupId && normalizeOutboundPartnerName(target.siteName),
  );
  const branched = companyMode === "branched";
  const editGroupName = !legacy && !branched;

  const aliasWarning = useMemo(() => {
    const value = normalizeOutboundPartnerName(aliasInput);
    if (!value) return null;
    const key = compactOutboundPartnerKey(value);
    if (!key) return "글자나 숫자가 있어야 합니다.";
    if (key === compactOutboundPartnerKey(name)) {
      return "정식명과 같습니다. 별칭으로 넣지 않아도 검색됩니다.";
    }
    if (aliasList.some((alias) => compactOutboundPartnerKey(alias) === key)) {
      return "이미 추가한 별칭입니다.";
    }
    const owner = ownerByKey.get(key);
    if (owner && owner.targetId !== target.id) {
      return owner.kind === "name"
        ? `"${owner.targetName}"의 정식명입니다.`
        : `"${owner.targetName}"에 이미 등록된 별칭입니다.`;
    }
    return null;
  }, [aliasInput, aliasList, name, ownerByKey, target.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editGroupName && target.groupId) {
        await updateOutboundPartnerGroup(target.groupId, groupName);
      }
      return updateCodeUsageTarget(target.id, {
        name: legacy || (branched && !namedBranch) ? groupName : name,
        folderId: target.folderId,
        channelType: outboundChannelFromFolderPath(folders, target.folderId),
        isOneTime: target.isOneTime,
        siteName: namedBranch ? siteName : target.siteName,
        contactName,
        contactPhone,
        contactEmail,
        address,
        note,
        aliases: aliasList,
      });
    },
    onSuccess: async () => {
      setError(null);
      await onChanged();
      onClose();
    },
    onError: (err) =>
      setError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : "업체를 저장하지 못했습니다.",
      ),
  });

  const organizeMutation = useMutation({
    mutationFn: async () => {
      const channelType = outboundChannelFromFolderPath(
        folders,
        target.folderId,
      );
      if (organizeMode === "company") {
        const group = await createOutboundPartnerGroup(
          target.brandId,
          organizeGroupName,
        );
        return updateCodeUsageTarget(target.id, {
          groupId: group.id,
          siteName: "",
          channelType,
        });
      }
      if (!organizeGroupId) {
        throw new CodeUsageTargetStoreError("넣을 업체를 고르세요.", "invalid");
      }
      if (!normalizeOutboundPartnerName(organizeSiteName)) {
        throw new CodeUsageTargetStoreError(
          "지점 이름을 입력하세요.",
          "invalid",
        );
      }
      return updateCodeUsageTarget(target.id, {
        groupId: organizeGroupId,
        siteName: organizeSiteName,
        channelType,
      });
    },
    onSuccess: async () => {
      setError(null);
      setOrganizeMode(null);
      await onChanged();
    },
    onError: (err) =>
      setError(
        err instanceof CodeUsageTargetStoreError
          ? err.message
          : "출고 단위를 정리하지 못했습니다.",
      ),
  });

  const pending = saveMutation.isPending || organizeMutation.isPending;
  const canSave =
    (namedBranch
      ? Boolean(normalizeOutboundPartnerName(siteName))
      : Boolean(normalizeOutboundPartnerName(groupName))) && !pending;
  const canAddAlias = Boolean(
    normalizeOutboundPartnerName(aliasInput) && !aliasWarning,
  );
  const canOrganizeCompany = Boolean(organizeGroupName.trim());
  const canOrganizeBranch = Boolean(
    organizeGroupId && normalizeOutboundPartnerName(organizeSiteName),
  );

  function addAlias() {
    const value = normalizeOutboundPartnerName(aliasInput);
    if (!value || aliasWarning) return;
    setAliasList((prev) => [...prev, value]);
    setAliasInput("");
  }

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-border bg-muted/30 p-3">
      {legacy ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
          <div>
            <p className="text-sm font-medium">이 행 정리</p>
            <p className="text-xs text-muted-foreground">
              기존 식별명과 바코드 연결은 그대로 둡니다. 온라인/오프라인은 위
              폴더 탭을 따릅니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={organizeMode === "company" ? "default" : "outline"}
              size="sm"
              disabled={pending}
              onClick={() =>
                setOrganizeMode((prev) =>
                  prev === "company" ? null : "company",
                )
              }
            >
              새 업체로 정리
            </Button>
            <Button
              type="button"
              variant={organizeMode === "branch" ? "default" : "outline"}
              size="sm"
              disabled={pending || groups.length === 0}
              onClick={() =>
                setOrganizeMode((prev) => (prev === "branch" ? null : "branch"))
              }
            >
              기존 업체의 지점으로 넣기
            </Button>
          </div>
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              먼저 새 업체로 정리한 곳이 있어야 지점으로 넣을 수 있습니다.
            </p>
          ) : null}
          {organizeMode === "company" ? (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">업체명</span>
                <Input
                  value={organizeGroupName}
                  disabled={pending}
                  onChange={(event) => setOrganizeGroupName(event.target.value)}
                />
              </label>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!canOrganizeCompany || pending}
                  onClick={() => organizeMutation.mutate()}
                >
                  업체로 정리
                </Button>
              </div>
            </div>
          ) : null}
          {organizeMode === "branch" ? (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">업체</span>
                <Select
                  className="w-full"
                  value={organizeGroupId}
                  disabled={pending}
                  onChange={(event) => setOrganizeGroupId(event.target.value)}
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">지점명</span>
                <Input
                  value={organizeSiteName}
                  placeholder="예: 제주점"
                  disabled={pending}
                  onChange={(event) => setOrganizeSiteName(event.target.value)}
                />
              </label>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!canOrganizeBranch || pending}
                  onClick={() => organizeMutation.mutate()}
                >
                  지점으로 넣기
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {namedBranch ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            지점명
          </span>
          <Input
            value={siteName}
            disabled={pending}
            onChange={(event) => setSiteName(event.target.value)}
          />
        </label>
      ) : (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {branched ? "이름" : "업체명"}
          </span>
          <Input
            value={groupName}
            disabled={pending}
            onChange={(event) => {
              const value = event.target.value;
              setGroupName(value);
              if (legacy || branched) setName(value);
            }}
          />
        </label>
      )}

      <OutboundPartnerContactFields
        contactName={contactName}
        contactPhone={contactPhone}
        contactEmail={contactEmail}
        address={address}
        note={note}
        pending={pending}
        onContactName={setContactName}
        onContactPhone={setContactPhone}
        onContactEmail={setContactEmail}
        onAddress={setAddress}
        onNote={setNote}
      />

      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">별칭</span>
        {aliasList.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {aliasList.map((alias) => (
              <li key={alias}>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs">
                  {alias}
                  <button
                    type="button"
                    aria-label={`${alias} 별칭 삭제`}
                    className="text-muted-foreground hover:text-danger"
                    disabled={pending}
                    onClick={() =>
                      setAliasList((prev) =>
                        prev.filter((item) => item !== alias),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            부서나 발주 사이트마다 다르게 부르는 이름을 넣으면 그 이름으로도
            검색됩니다.
          </p>
        )}
        <div className="flex gap-2">
          <Input
            className="h-8"
            value={aliasInput}
            placeholder="별칭을 적고 Enter"
            disabled={pending}
            onChange={(event) => setAliasInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addAlias();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="별칭 추가"
            disabled={!canAddAlias || pending}
            onClick={addAlias}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        {aliasWarning ? (
          <p className="text-xs text-warning">{aliasWarning}</p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onClose}
        >
          취소
        </Button>
        <Button
          type="button"
          disabled={!canSave}
          onClick={() => saveMutation.mutate()}
        >
          <Check className="size-4" />
          저장
        </Button>
      </div>
    </div>
  );
}
