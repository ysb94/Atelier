import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  saveInvoiceCodeRule,
  searchStyleNames,
  type InvoiceCodeRuleInput,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type DropdownRect = { top: number; left: number; width: number }

function normalizeSuggestion(value: string) {
  return value.trim().toLocaleLowerCase('ko-KR')
}

export function InvoiceCodeRuleForm({
  brandId,
  initialCode = '',
  lockCode = false,
  onSaved,
}: {
  brandId: string
  initialCode?: string
  lockCode?: boolean
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const [ownProductCode, setOwnProductCode] = useState(initialCode)
  const [officialProductName, setOfficialProductName] = useState('')
  const [isException, setIsException] = useState(false)
  const [note, setNote] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [isOfficialNameFocused, setIsOfficialNameFocused] = useState(false)
  const [debouncedNameQuery, setDebouncedNameQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [dropdownRect, setDropdownRect] = useState<DropdownRect | null>(null)
  const officialNameAnchorRef = useRef<HTMLDivElement>(null)
  const blurTimerRef = useRef<number | null>(null)

  const typedOfficialName = officialProductName.trim()
  const suggestionsId = `invoice-official-suggestions-${initialCode || 'new'}`
  const canSave =
    Boolean(ownProductCode.trim()) &&
    (isException || Boolean(typedOfficialName))

  useEffect(() => {
    if (isException || !isOfficialNameFocused || !typedOfficialName) {
      setDebouncedNameQuery('')
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedNameQuery(typedOfficialName)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [isException, isOfficialNameFocused, typedOfficialName])

  const suggestionsQuery = useQuery({
    queryKey: [
      'invoice-rule-form-style-name-suggestions',
      brandId,
      debouncedNameQuery,
    ],
    queryFn: () => searchStyleNames(brandId, debouncedNameQuery, 4),
    enabled: Boolean(
      !isException && isOfficialNameFocused && debouncedNameQuery,
    ),
    staleTime: 30_000,
  })

  const suggestions = useMemo(() => {
    if (isException) return []
    const normalizedTypedName = normalizeSuggestion(officialProductName)
    return (suggestionsQuery.data ?? [])
      .filter((name) => normalizeSuggestion(name) !== normalizedTypedName)
      .slice(0, 3)
  }, [isException, officialProductName, suggestionsQuery.data])

  const hasCurrentSearch =
    Boolean(typedOfficialName) && debouncedNameQuery === typedOfficialName
  const showLoadingHint =
    !isException &&
    hasCurrentSearch &&
    suggestionsQuery.isFetching &&
    suggestions.length === 0
  const showDropdown =
    !isException &&
    isOfficialNameFocused &&
    hasCurrentSearch &&
    (suggestions.length > 0 || showLoadingHint)

  function measureDropdown() {
    const anchor = officialNameAnchorRef.current
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
    if (isException || !isOfficialNameFocused) {
      setDropdownRect(null)
      return
    }
    measureDropdown()
    function reposition() {
      measureDropdown()
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [isException, isOfficialNameFocused])

  useEffect(() => {
    setHighlightIndex(0)
  }, [debouncedNameQuery, isException, isOfficialNameFocused])

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current)
      }
    }
  }, [])

  function toggleException() {
    setSavedMessage('')
    setIsException((current) => {
      const next = !current
      if (next) {
        setOfficialProductName('')
        setIsOfficialNameFocused(false)
        setDropdownRect(null)
        setDebouncedNameQuery('')
      }
      return next
    })
  }

  function applySuggestion(name: string) {
    setOfficialProductName(name)
    setIsException(false)
    setSavedMessage('')
    setIsOfficialNameFocused(false)
    setDropdownRect(null)
  }

  const mutation = useMutation({
    mutationFn: (input: InvoiceCodeRuleInput) =>
      saveInvoiceCodeRule(brandId, input),
    onSuccess: async (rule) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-name-rules', brandId],
      })
      setSavedMessage(
        rule.action === 'rename'
          ? `${rule.sourceValue} 공식명을 저장했습니다.`
          : `${rule.sourceValue} 코드를 예외로 저장했습니다.`,
      )
      if (!lockCode) setOwnProductCode('')
      setOfficialProductName('')
      setIsException(false)
      setNote('')
      onSaved?.()
    },
  })

  function submit() {
    if (!canSave) return
    setSavedMessage('')
    mutation.mutate({
      ownProductCode,
      action: isException ? 'exception' : 'rename',
      officialProductName: isException ? '' : officialProductName,
      note,
    })
  }

  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null

  return (
    <>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr_1fr]">
          <div>
            <label
              htmlFor={`invoice-code-${initialCode}`}
              className="mb-1.5 block text-xs font-medium"
            >
              자체품번코드
            </label>
            <Input
              id={`invoice-code-${initialCode}`}
              value={ownProductCode}
              readOnly={lockCode}
              onChange={(event) => setOwnProductCode(event.target.value)}
              placeholder="자체품번코드 입력"
              className={lockCode ? 'bg-muted/40 font-medium' : undefined}
            />
          </div>
          <div>
            <label
              htmlFor={`invoice-official-name-${initialCode}`}
              className="mb-1.5 block text-xs font-medium"
            >
              상품업체 상품명(업체 공식)
            </label>
            <div className="flex gap-2">
              <div ref={officialNameAnchorRef} className="min-w-0 flex-1">
                <Input
                  id={`invoice-official-name-${initialCode}`}
                  value={officialProductName}
                  disabled={isException}
                  aria-autocomplete="list"
                  aria-controls={suggestionsId}
                  aria-expanded={showDropdown}
                  onFocus={() => {
                    if (isException) return
                    if (blurTimerRef.current !== null) {
                      window.clearTimeout(blurTimerRef.current)
                      blurTimerRef.current = null
                    }
                    setIsOfficialNameFocused(true)
                  }}
                  onBlur={() => {
                    blurTimerRef.current = window.setTimeout(() => {
                      setIsOfficialNameFocused(false)
                    }, 120)
                  }}
                  onChange={(event) => {
                    setOfficialProductName(event.target.value)
                    setIsException(false)
                    setSavedMessage('')
                    setIsOfficialNameFocused(true)
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || isException) return

                    if (event.key === 'Escape') {
                      setIsOfficialNameFocused(false)
                      return
                    }
                    if (
                      showDropdown &&
                      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
                    ) {
                      event.preventDefault()
                      setHighlightIndex((current) => {
                        if (suggestions.length === 0) return 0
                        if (event.key === 'ArrowDown') {
                          return (current + 1) % suggestions.length
                        }
                        return (
                          (current - 1 + suggestions.length) %
                          suggestions.length
                        )
                      })
                      return
                    }
                    if (event.key === 'Enter' && suggestions.length > 0) {
                      event.preventDefault()
                      applySuggestion(
                        suggestions[highlightIndex] ?? suggestions[0] ?? '',
                      )
                    }
                  }}
                  placeholder={
                    isException
                      ? '예외 · 원본 품목명 유지'
                      : '이 코드가 바뀔 공식 상품명'
                  }
                  className={isException ? 'bg-muted/40' : undefined}
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant={isException ? 'default' : 'outline'}
                aria-pressed={isException}
                className="shrink-0"
                onClick={toggleException}
              >
                예외
              </Button>
            </div>
          </div>
          <div>
            <label
              htmlFor={`invoice-code-note-${initialCode}`}
              className="mb-1.5 block text-xs font-medium"
            >
              메모{' '}
              <span className="font-normal text-muted-foreground">(선택)</span>
            </label>
            <Input
              id={`invoice-code-note-${initialCode}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="등록 또는 예외 처리 이유"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            disabled={mutation.isPending || !canSave}
            onClick={submit}
          >
            <Save className="size-4" />
            {mutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </div>

        {errorMessage ? (
          <p className="text-xs text-danger">{errorMessage}</p>
        ) : savedMessage ? (
          <p className="text-xs text-success">{savedMessage}</p>
        ) : null}
      </div>

      {showDropdown && dropdownRect
        ? createPortal(
            <div
              id={suggestionsId}
              role="listbox"
              style={{
                position: 'fixed',
                top: dropdownRect.top,
                left: dropdownRect.left,
                width: dropdownRect.width,
              }}
              className="z-[9999] overflow-hidden rounded-md border border-border bg-card shadow-md"
            >
              {suggestions.length > 0 ? (
                suggestions.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={index === highlightIndex}
                    className={cn(
                      'block w-full truncate px-2.5 py-2 text-left text-xs hover:bg-muted',
                      index === highlightIndex && 'bg-muted',
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applySuggestion(name)
                    }}
                  >
                    {name}
                  </button>
                ))
              ) : (
                <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  상품명 검색 중...
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
