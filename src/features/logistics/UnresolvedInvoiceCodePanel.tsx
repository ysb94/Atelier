import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, Loader2, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveInvoiceCodeRule, searchStyleNames } from '@/lib/api'
import { downloadUnresolvedInvoiceCodes } from '@/lib/invoice/rule-import'
import type { UnresolvedInvoiceCode } from '@/lib/invoice/name-transform'
import { cn, formatNumber } from '@/lib/utils'

/**
 * <table>은 border-collapse와 함께 쓰면 브라우저가 셀마다 별도 스태킹
 * 컨텍스트를 만들어 absolute 드롭다운이 아래 행에 가려지는 경우가 있다.
 * 그래서 표처럼 보이게만 grid로 구현한다.
 */
const ROW_GRID_COLS =
  'grid-cols-[minmax(15rem,1.5fr)_minmax(11rem,1fr)_minmax(9rem,0.8fr)_minmax(17rem,1.6fr)_3.5rem]'

type DropdownRect = { top: number; left: number; width: number }

function joinNames(names: string[]) {
  if (names.length === 0) return '-'
  return names.join(' · ')
}

function normalizeSuggest(value: string) {
  return value.trim().toLocaleLowerCase('ko-KR')
}

/** 입력값이 없으면 품목명에서 검색어를 뽑아 데이터 시트 상품명을 찾는다. */
function buildSearchQuery(draft: string, productNames: string[]) {
  const typed = draft.trim()
  if (typed.length >= 1) return typed

  const source = productNames[0] ?? ''
  const cleaned = source
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[/_·,.\-+()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''

  const tokens = cleaned
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .sort((left, right) => right.length - left.length)

  return tokens[0] ?? cleaned.slice(0, 12)
}

type RowDraft = {
  officialName: string
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
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<DropdownRect | null>(null)
  const blurTimerRef = useRef<number | null>(null)
  const anchorRefs = useRef(new Map<string, HTMLDivElement>())

  function getDraft(code: UnresolvedInvoiceCode): RowDraft {
    return (
      drafts[code.normalizedCode] ?? {
        officialName: '',
        isException: false,
      }
    )
  }

  function updateDraft(normalizedCode: string, patch: Partial<RowDraft>) {
    setDrafts((current) => {
      const previous = current[normalizedCode] ?? {
        officialName: '',
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
        officialName: '',
        isException: false,
      }
      return draft.isException || draft.officialName.trim().length > 0
    })
  }, [codes, drafts])

  const activeCode = codes.find((code) => code.normalizedCode === activeKey)
  const activeDraft = activeCode ? getDraft(activeCode) : null
  const activeSearchQuery =
    activeCode && activeDraft && !activeDraft.isException
      ? buildSearchQuery(activeDraft.officialName, activeCode.productNames)
      : ''

  useEffect(() => {
    if (!activeKey || !activeSearchQuery) {
      setDebouncedQuery('')
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(activeSearchQuery)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [activeKey, activeSearchQuery])

  const suggestionsQuery = useQuery({
    queryKey: ['style-name-suggestions', brandId, debouncedQuery],
    queryFn: () => searchStyleNames(brandId, debouncedQuery, 3),
    enabled: Boolean(activeKey && debouncedQuery),
    staleTime: 30_000,
  })

  const activeSuggestions = useMemo(() => {
    if (!activeDraft || activeDraft.isException) return []
    const typed = normalizeSuggest(activeDraft.officialName)
    return (suggestionsQuery.data ?? []).filter(
      (name) => normalizeSuggest(name) !== typed,
    )
  }, [activeDraft, suggestionsQuery.data])

  const showLoadingHint =
    Boolean(activeKey) &&
    !activeDraft?.isException &&
    suggestionsQuery.isFetching &&
    activeSuggestions.length === 0

  const showDropdown =
    Boolean(activeKey) && (activeSuggestions.length > 0 || showLoadingHint)

  // 드롭다운은 목록 바깥(document.body)에 띄우므로, 화면 좌표를 직접 계산해
  // 목록의 가로/세로 스크롤 영역이 드롭다운 크기에 영향받지 않게 한다.
  function measureActiveAnchor(key: string | null) {
    if (!key) {
      setDropdownRect(null)
      return
    }
    const anchor = anchorRefs.current.get(key)
    if (!anchor) {
      setDropdownRect(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    setDropdownRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    })
  }

  useEffect(() => {
    measureActiveAnchor(activeKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 함수 참조는 매번 새로 만들어도 된다
  }, [activeKey])

  useEffect(() => {
    if (!activeKey) return
    function handleReposition() {
      measureActiveAnchor(activeKey)
    }
    window.addEventListener('resize', handleReposition)
    // capture: true로 목록 내부 스크롤·페이지 스크롤을 모두 잡는다.
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 함수 참조는 매번 새로 만들어도 된다
  }, [activeKey])

  useEffect(() => {
    setHighlightIndex(0)
  }, [activeKey, debouncedQuery, activeDraft?.isException])

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current)
      }
    }
  }, [])

  const mutation = useMutation({
    mutationFn: async (
      rows: {
        ownProductCode: string
        action: 'rename' | 'exception'
        officialProductName?: string
        normalizedCode: string
      }[],
    ) => {
      const results = []
      for (const row of rows) {
        results.push(
          await saveInvoiceCodeRule(brandId, {
            ownProductCode: row.ownProductCode,
            action: row.action,
            officialProductName: row.officialProductName,
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
      setActiveKey(null)
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
      officialName: nextException ? '' : draft.officialName,
    })
    setMessageIsError(false)
    setSaveMessage('')
  }

  function applySuggestion(code: UnresolvedInvoiceCode, name: string) {
    updateDraft(code.normalizedCode, {
      officialName: name,
      isException: false,
    })
    setActiveKey(code.normalizedCode)
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
        officialProductName: draft.officialName.trim(),
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
            데이터 시트 상품명 검색 · Enter는 예외 체크 · 저장 버튼으로 반영 ·
            많을 때는 일괄 다운로드 후 기준정보에서 업로드
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
            <div>상품업체 상품명</div>
            <div className="text-center">예외</div>
          </div>

          {codes.map((code) => {
            const draft = getDraft(code)
            const isActive = activeKey === code.normalizedCode

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
                <div
                  ref={(element) => {
                    if (element) {
                      anchorRefs.current.set(code.normalizedCode, element)
                    } else {
                      anchorRefs.current.delete(code.normalizedCode)
                    }
                  }}
                >
                  <Input
                    value={draft.officialName}
                    disabled={draft.isException || isSaving}
                    placeholder={
                      draft.isException ? '예외 처리됨' : '등록 상품명 검색'
                    }
                    className="h-8 border-transparent bg-transparent shadow-none focus-visible:border-border focus-visible:bg-background"
                    onFocus={() => {
                      if (blurTimerRef.current !== null) {
                        window.clearTimeout(blurTimerRef.current)
                        blurTimerRef.current = null
                      }
                      setActiveKey(code.normalizedCode)
                    }}
                    onBlur={() => {
                      blurTimerRef.current = window.setTimeout(() => {
                        setActiveKey((current) =>
                          current === code.normalizedCode ? null : current,
                        )
                      }, 120)
                    }}
                    onChange={(event) => {
                      updateDraft(code.normalizedCode, {
                        officialName: event.target.value,
                        isException: false,
                      })
                      setSaveMessage('')
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return

                      if (
                        isActive &&
                        showDropdown &&
                        (event.key === 'ArrowDown' || event.key === 'ArrowUp')
                      ) {
                        event.preventDefault()
                        setHighlightIndex((current) => {
                          if (activeSuggestions.length === 0) return 0
                          if (event.key === 'ArrowDown') {
                            return (current + 1) % activeSuggestions.length
                          }
                          return (
                            (current - 1 + activeSuggestions.length) %
                            activeSuggestions.length
                          )
                        })
                        return
                      }

                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      toggleException(code)
                    }}
                  />
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

      {activeCode && showDropdown && dropdownRect
        ? createPortal(
            <div
              style={{
                position: 'fixed',
                top: dropdownRect.top,
                left: dropdownRect.left,
                width: dropdownRect.width,
              }}
              className="z-[9999] overflow-hidden rounded-md border border-border bg-card shadow-md"
            >
              {activeSuggestions.length > 0 ? (
                activeSuggestions.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    className={cn(
                      'block w-full truncate px-2.5 py-2 text-left text-xs hover:bg-muted',
                      index === highlightIndex && 'bg-muted',
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applySuggestion(activeCode, name)
                    }}
                  >
                    {name}
                  </button>
                ))
              ) : (
                <p className="flex items-center gap-1.5 px-2.5 py-2 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  상품명 검색 중...
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
