import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ClipboardPaste, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/input'
import { folderMoveOptions } from '@/lib/codes/outbound-folder'
import {
  compactOutboundPartnerKey,
  parseOutboundPartnerPaste,
  type OutboundPartnerPasteIssue,
} from '@/lib/codes/outbound-partner'
import { createCodeUsageTargetsBulk } from '@/lib/api'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'

const ISSUE_LABEL: Record<OutboundPartnerPasteIssue['reason'], string> = {
  duplicate_in_paste: '붙여넣은 목록 안에서 중복',
  duplicate_existing: '이미 등록된 업체',
  empty_name: '업체명을 읽을 수 없음',
}

export function OutboundPartnerPastePanel({
  brandId,
  targets,
  folders,
  onClose,
  onChanged,
}: {
  brandId: string
  targets: CodeUsageTarget[]
  folders: readonly CodeUsageTargetFolder[]
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [text, setText] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    createdCount: number
    failed: { name: string; message: string }[]
  } | null>(null)

  const existingKeys = useMemo(
    () =>
      targets.map(
        (target) =>
          target.normalizedName || compactOutboundPartnerKey(target.name),
      ),
    [targets],
  )

  const parsed = useMemo(
    () => parseOutboundPartnerPaste(text, existingKeys),
    [text, existingKeys],
  )

  const saveMutation = useMutation({
    mutationFn: () =>
      createCodeUsageTargetsBulk(
        brandId,
        parsed.rows.map((row) => ({
          name: row.name,
          aliases: row.aliases,
          folderId,
        })),
      ),
    onSuccess: async (data) => {
      setResult({ createdCount: data.created.length, failed: data.failed })
      setText('')
      setError(null)
      await onChanged()
    },
    onError: () => setError('업체를 저장하지 못했습니다.'),
  })

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">여러 줄 붙여넣기</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            한 줄에 업체 하나를 적습니다. 별칭이 있으면{' '}
            <code className="rounded bg-card px-1">무신사 / MSS, (주)무신사</code>
            처럼 이름 뒤에 <code className="rounded bg-card px-1">/</code>를 두고
            쉼표로 나열하세요. 엑셀에서 복사한 탭 구분도 읽습니다.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="닫기"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          넣을 폴더
        </span>
        <Select
          className="w-full"
          value={folderId ?? ''}
          onChange={(event) =>
            setFolderId(event.target.value === '' ? null : event.target.value)
          }
        >
          {folderMoveOptions(folders).map((option) => (
            <option key={option.id ?? 'unfiled'} value={option.id ?? ''}>
              {`${'\u00a0'.repeat(Math.max(0, option.depth - 1) * 2)}${option.label}`}
            </option>
          ))}
        </Select>
      </label>

      <Textarea
        rows={6}
        value={text}
        placeholder={'무신사 / MSS, (주)무신사\n29CM\n면세점'}
        onChange={(event) => {
          setText(event.target.value)
          setError(null)
          setResult(null)
        }}
      />

      {parsed.rows.length > 0 || parsed.issues.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="success">등록 예정 {parsed.rows.length}곳</Badge>
            {parsed.issues.length > 0 ? (
              <Badge variant="warning">건너뜀 {parsed.issues.length}줄</Badge>
            ) : null}
          </div>

          {parsed.rows.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {parsed.rows.map((row) => (
                <li key={row.normalizedName} className="flex flex-wrap gap-1.5">
                  <span className="font-medium">{row.name}</span>
                  {row.aliases.map((alias) => (
                    <Badge key={alias} variant="muted">
                      {alias}
                    </Badge>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}

          {parsed.issues.length > 0 ? (
            <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
              {parsed.issues.map((issue) => (
                <li key={`${issue.lineNumber}-${issue.text}`}>
                  {issue.lineNumber}번째 줄 · {issue.text || '(빈 줄)'} —{' '}
                  {ISSUE_LABEL[issue.reason]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-1 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          <p>{result.createdCount}곳을 등록했습니다.</p>
          {result.failed.length > 0 ? (
            <ul className="text-xs text-danger">
              {result.failed.map((row) => (
                <li key={row.name}>
                  {row.name} — {row.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={parsed.rows.length === 0 || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          <ClipboardPaste className="size-4" />
          {parsed.rows.length > 0
            ? `${parsed.rows.length}곳 등록`
            : '등록할 업체 없음'}
        </Button>
      </div>
    </section>
  )
}
