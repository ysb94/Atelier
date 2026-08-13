import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, Save } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { saveInvoiceCodeRule } from '@/lib/api'
import { downloadUnresolvedInvoiceCodes } from '@/lib/invoice/rule-import'
import type { UnresolvedInvoiceCode } from '@/lib/invoice/name-transform'
import type { StyleRef } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

/**
 * <table>은 border-collapse와 함께 쓰면 브라우저가 셀마다 별도 스태킹
 * 컨텍스트를 만들어 absolute 드롭다운이 아래 행에 가려지는 경우가 있다.
 * 그래서 표처럼 보이게만 grid로 구현한다.
 */
const ROW_GRID_COLS =
  'grid-cols-[minmax(15rem,1.5fr)_minmax(11rem,1fr)_minmax(9rem,0.8fr)_minmax(17rem,1.6fr)_3.5rem]'

function joinNames(names: string[]) {
  if (names.length === 0) return '-'
  return names.join(' · ')
}

type RowDraft = {
  targetStyle: StyleRef | null
  isException: boolean
}

export function UnresolvedInvoiceCodePanel({
  brandId,
  brandName,
  codes,
}: {
  brandId: string
  brandName: string
  codes: UnresolvedInvoiceCode[]
}) {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)

  function getDraft(code: UnresolvedInvoiceCode): RowDraft {
    return (
      drafts[code.normalizedCode] ?? {
        targetStyle: null,
        isException: false,
      }
    )
  }

  function updateDraft(normalizedCode: string, patch: Partial<RowDraft>) {
    setDrafts((current) => {
      const previous = current[normalizedCode] ?? {
        targetStyle: null,
        isException: false,
      }
      return {
        ...current,
        [normalizedCode]: { ...previous, ...patch },
      }
    })
  }

  const pendingRows = useMemo(() => {
    return codes.filter((code) => {
      const draft = drafts[code.normalizedCode] ?? {
        targetStyle: null,
        isException: false,
      }
      return draft.isException || Boolean(draft.targetStyle)
    })
  }, [codes, drafts])

  const mutation = useMutation({
    mutationFn: async (
      rows: {
        ownProductCode: string
        action: 'rename' | 'exception'
        targetStyle?: StyleRef
        normalizedCode: string
      }[],
    ) => {
      const results = []
      for (const row of rows) {
        results.push(
          await saveInvoiceCodeRule(brandId, {
            ownProductCode: row.ownProductCode,
            action: row.action,
            targetStyle: row.targetStyle,
          }),
        )
      }
      return results
    },
    onSuccess: async (_rules, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-name-rules', brandId],
      })
      setDrafts((current) => {
        const next = { ...current }
        for (const row of variables) {
          delete next[row.normalizedCode]
        }
        return next
      })
      setMessageIsError(false)
      setSaveMessage(`${variables.length}건을 저장했습니다.`)
    },
    onError: (error) => {
      setMessageIsError(true)
      setSaveMessage(
        error instanceof Error
          ? error.message
          : '저장하지 못했습니다. 다시 시도해주세요.',
      )
    },
    onSettled: () => {
      setIsSaving(false)
    },
  })

  function toggleException(code: UnresolvedInvoiceCode) {
    const draft = getDraft(code)
    const nextException = !draft.isException
    updateDraft(code.normalizedCode, {
      isException: nextException,
      targetStyle: nextException ? null : draft.targetStyle,
    })
    setMessageIsError(false)
    setSaveMessage('')
  }

  function savePending() {
    if (isSaving || pendingRows.length === 0) return
    setIsSaving(true)
    setMessageIsError(false)
    setSaveMessage('')

    const rows = pendingRows.map((code) => {
      const draft = getDraft(code)
      if (draft.isException) {
        return {
          ownProductCode: code.ownProductCode,
          action: 'exception' as const,
          normalizedCode: code.normalizedCode,
        }
      }
      return {
        ownProductCode: code.ownProductCode,
        action: 'rename' as const,
        targetStyle: draft.targetStyle!,
        normalizedCode: code.normalizedCode,
      }
    })

    mutation.mutate(rows)
  }

  async function downloadBulkSheet() {
    if (isDownloading || codes.length === 0) return
    setIsDownloading(true)
    setSaveMessage('')
    try {
      await downloadUnresolvedInvoiceCodes({
        brandName,
        codes: codes.map((code) => ({
          ownProductCode: code.ownProductCode,
          productNames: code.productNames,
          rowCount: code.rowCount,
        })),
      })
      setMessageIsError(false)
      setSaveMessage(
        `${formatNumber(codes.length)}건을 내려받았습니다. 기준정보 → 엑셀 일괄 등록에 올리면 됩니다.`,
      )
    } catch (error) {
      setMessageIsError(true)
      setSaveMessage(
        error instanceof Error
          ? error.message
          : '엑셀을 내려받지 못했습니다. 다시 시도해주세요.',
      )
    } finally {
      setIsDownloading(false)
    }
  }

  if (codes.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-4">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        <div>
          <p className="text-sm font-medium text-success">
            미등록 자체품번코드가 없습니다.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            코드가 있는 모든 행이 공식명 변경 또는 예외 처리되었습니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">변환 안 된 코드</h3>
          <Badge variant="danger">{formatNumber(codes.length)}개</Badge>
          {pendingRows.length > 0 ? (
            <Badge variant="outline">대기 {pendingRows.length}건</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            M번호·상품명으로 고르고 저장 · 많을 때는 일괄 다운로드 후 기준정보에서
            업로드
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDownloading}
            onClick={() => void downloadBulkSheet()}
          >
            <Download className="size-3.5" />
            {isDownloading ? '준비 중...' : '일괄 다운로드'}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isSaving || pendingRows.length === 0}
            onClick={savePending}
          >
            <Save className="size-3.5" />
            {isSaving ? '저장 중...' : `저장 ${pendingRows.length}`}
          </Button>
        </div>
      </div>

      {saveMessage ? (
        <p
          className={cn(
            'text-xs',
            messageIsError ? 'text-danger' : 'text-success',
          )}
        >
          {saveMessage}
        </p>
      ) : null}

      <div className="max-h-[40rem] overflow-auto rounded-lg border border-border">
        <div className="min-w-240">
          <div
            className={cn(
              'sticky top-0 z-10 grid gap-2 border-b border-border bg-muted px-2.5 py-2 text-xs font-medium',
              ROW_GRID_COLS,
            )}
          >
            <div>품목명</div>
            <div>내품명</div>
            <div>자체상품코드</div>
            <div>상품업체 상품명 (M번호)</div>
            <div className="text-center">예외</div>
          </div>

          {codes.map((code) => {
            const draft = getDraft(code)

            return (
              <div
                key={code.normalizedCode}
                className={cn(
                  'grid gap-2 border-t border-border px-2.5 py-1.5 text-xs',
                  ROW_GRID_COLS,
                  draft.isException && 'bg-muted/30',
                )}
              >
                <div className="line-clamp-2 self-center text-muted-foreground">
                  {joinNames(code.productNames)}
                </div>
                <div className="line-clamp-2 self-center text-muted-foreground">
                  {joinNames(code.itemNames)}
                </div>
                <div className="self-center truncate font-medium">
                  {code.ownProductCode}
                </div>
                <div className="self-center">
                  {draft.isException ? (
                    <span className="text-muted-foreground">예외 처리됨</span>
                  ) : (
                    <StylePicker
                      brandId={brandId}
                      value={draft.targetStyle}
                      disabled={isSaving}
                      onChange={(next) => {
                        updateDraft(code.normalizedCode, {
                          targetStyle: next,
                          isException: false,
                        })
                        setSaveMessage('')
                      }}
                      placeholder="M번호 또는 상품명 검색"
                      inputClassName="h-8 border-transparent bg-transparent shadow-none focus-visible:border-border focus-visible:bg-background"
                    />
                  )}
                </div>
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={`${code.ownProductCode} 예외`}
                    checked={draft.isException}
                    disabled={isSaving}
                    className="size-4 accent-foreground"
                    onChange={() => toggleException(code)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
