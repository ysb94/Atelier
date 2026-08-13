import { useEffect, useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  saveInvoiceOptionMap,
  type InvoiceOptionMapInput,
} from '@/lib/api'
import {
  INVOICE_OPTION_COMPONENT_ROLE_LABEL,
  type InvoiceOptionMap,
  type InvoiceOptionMapComponent,
  type StyleRef,
} from '@/lib/types'

type ExtraDraft = {
  key: string
  style: StyleRef | null
  role: 'included' | 'required' | 'paid_add'
  quantity: number
}

function extrasFromMap(map: InvoiceOptionMap | null): ExtraDraft[] {
  if (!map) return []
  return map.components
    .filter(
      (item): item is InvoiceOptionMapComponent & { role: ExtraDraft['role'] } =>
        item.role !== 'main',
    )
    .map((item, index) => ({
      key: item.id || `extra-${index}`,
      style: item.style,
      role: item.role,
      quantity: item.quantity,
    }))
}

function mainFromMap(map: InvoiceOptionMap | null): StyleRef | null {
  return map?.components.find((item) => item.role === 'main')?.style ?? null
}

export function InvoiceOptionMapForm({
  brandId,
  map = null,
  initialProductName = '',
  initialItemName = '',
  initialMallName = '',
  initialOwnProductCode = '',
  lockSource = false,
  submitLabel = '기준으로 저장',
  onSaved,
}: {
  brandId: string
  map?: InvoiceOptionMap | null
  initialProductName?: string
  initialItemName?: string
  initialMallName?: string
  initialOwnProductCode?: string
  lockSource?: boolean
  submitLabel?: string
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const formId = useId()
  const [productName, setProductName] = useState(
    map?.productName || initialProductName,
  )
  const [itemName, setItemName] = useState(map?.itemName || initialItemName)
  const [mallName, setMallName] = useState(map?.mallName || initialMallName)
  const [allMalls, setAllMalls] = useState(
    map ? !map.mallName : !initialMallName,
  )
  const [ownProductCode, setOwnProductCode] = useState(
    map?.ownProductCode || initialOwnProductCode,
  )
  const [note, setNote] = useState(map?.note ?? '')
  const [displayItemName, setDisplayItemName] = useState(
    map?.displayItemName ?? '',
  )
  const [main, setMain] = useState<StyleRef | null>(mainFromMap(map))
  const [extras, setExtras] = useState<ExtraDraft[]>(extrasFromMap(map))
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    setProductName(map?.productName || initialProductName)
    setItemName(map?.itemName || initialItemName)
    setMallName(map?.mallName || initialMallName)
    setAllMalls(map ? !map.mallName : !initialMallName)
    setOwnProductCode(map?.ownProductCode || initialOwnProductCode)
    setNote(map?.note ?? '')
    setDisplayItemName(map?.displayItemName ?? '')
    setMain(mainFromMap(map))
    setExtras(extrasFromMap(map))
  }, [
    map,
    initialProductName,
    initialItemName,
    initialMallName,
    initialOwnProductCode,
  ])

  const canSave = Boolean(productName.trim()) && Boolean(main)

  const mutation = useMutation({
    mutationFn: (input: InvoiceOptionMapInput) =>
      saveInvoiceOptionMap(brandId, input, map?.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-option-maps', brandId],
      })
      setSavedMessage('저장했습니다. 현재 파일과 이후 작업에 바로 쓰입니다.')
      if (!lockSource && !map) {
        setProductName('')
        setItemName('')
        setMallName('')
        setAllMalls(true)
        setOwnProductCode('')
        setNote('')
        setDisplayItemName('')
        setMain(null)
        setExtras([])
      }
      onSaved?.()
    },
  })

  function submit() {
    if (!canSave || !main) return
    setSavedMessage('')
    mutation.mutate({
      productName,
      itemName,
      mallName: allMalls ? '' : mallName,
      ownProductCode,
      displayItemName,
      note,
      components: [
        { styleId: main.styleId, role: 'main', quantity: 1 },
        ...extras
          .filter((item) => item.style)
          .map((item) => ({
            styleId: item.style!.styleId,
            role: item.role,
            quantity: item.quantity,
          })),
      ],
    })
  }

  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label
            htmlFor={`${formId}-product`}
            className="mb-1.5 block text-xs font-medium"
          >
            원본 품목명
          </label>
          <Input
            id={`${formId}-product`}
            value={productName}
            readOnly={lockSource}
            onChange={(event) => setProductName(event.target.value)}
            placeholder="사방넷 품목명"
            className={lockSource ? 'bg-muted/40 font-medium' : undefined}
          />
        </div>
        <div>
          <label
            htmlFor={`${formId}-item`}
            className="mb-1.5 block text-xs font-medium"
          >
            원본 내품명
          </label>
          <Input
            id={`${formId}-item`}
            value={itemName}
            readOnly={lockSource}
            onChange={(event) => setItemName(event.target.value)}
            placeholder="비우면 품목명만 매칭"
            className={lockSource ? 'bg-muted/40' : undefined}
          />
        </div>
        <div>
          <label
            htmlFor={`${formId}-code`}
            className="mb-1.5 block text-xs font-medium"
          >
            자체상품코드
          </label>
          <Input
            id={`${formId}-code`}
            value={ownProductCode}
            onChange={(event) => setOwnProductCode(event.target.value)}
            placeholder="참고용"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label
            htmlFor={`${formId}-mall`}
            className="mb-1.5 block text-xs font-medium"
          >
            쇼핑몰명
          </label>
          <Input
            id={`${formId}-mall`}
            value={allMalls ? '' : mallName}
            disabled={allMalls}
            onChange={(event) => setMallName(event.target.value)}
            placeholder="비우면 모든 쇼핑몰"
            className={allMalls ? 'bg-muted/40' : undefined}
          />
        </div>
        <label className="mt-6 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={allMalls}
            onChange={(event) => setAllMalls(event.target.checked)}
          />
          모든 쇼핑몰
        </label>
      </div>

      <div>
        <label
          htmlFor={`${formId}-display`}
          className="mb-1.5 block text-xs font-medium"
        >
          변환 내품명(선택)
        </label>
        <Input
          id={`${formId}-display`}
          value={displayItemName}
          onChange={(event) => setDisplayItemName(event.target.value)}
          placeholder="비우면 원본 내품명을 유지합니다"
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium">본품 M번호</p>
        <StylePicker
          brandId={brandId}
          value={main}
          onChange={(next) => {
            setMain(next)
            setSavedMessage('')
          }}
          placeholder="본품 M번호 또는 공식명 검색"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">구성품</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setExtras((current) => [
                ...current,
                {
                  key: `extra-${Date.now()}-${current.length}`,
                  style: null,
                  role: 'included',
                  quantity: 1,
                },
              ])
            }
          >
            <Plus className="size-3.5" />
            구성 추가
          </Button>
        </div>
        {extras.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            본품만 나가면 비워 두세요. 포함 스트랩·필수 태슬·유료추가는 아래에
            넣습니다.
          </p>
        ) : (
          extras.map((extra) => (
            <div
              key={extra.key}
              className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1.6fr)_7.5rem_4.5rem_auto]"
            >
              <StylePicker
                brandId={brandId}
                value={extra.style}
                onChange={(next) =>
                  setExtras((current) =>
                    current.map((item) =>
                      item.key === extra.key ? { ...item, style: next } : item,
                    ),
                  )
                }
                placeholder="구성 M번호 검색"
              />
              <Select
                value={extra.role}
                onChange={(event) =>
                  setExtras((current) =>
                    current.map((item) =>
                      item.key === extra.key
                        ? {
                            ...item,
                            role: event.target.value as ExtraDraft['role'],
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="included">
                  {INVOICE_OPTION_COMPONENT_ROLE_LABEL.included}
                </option>
                <option value="required">
                  {INVOICE_OPTION_COMPONENT_ROLE_LABEL.required}
                </option>
                <option value="paid_add">
                  {INVOICE_OPTION_COMPONENT_ROLE_LABEL.paid_add}
                </option>
              </Select>
              <Input
                type="number"
                min={1}
                step={1}
                value={extra.quantity}
                onChange={(event) =>
                  setExtras((current) =>
                    current.map((item) =>
                      item.key === extra.key
                        ? {
                            ...item,
                            quantity: Math.max(
                              1,
                              Math.floor(Number(event.target.value) || 1),
                            ),
                          }
                        : item,
                    ),
                  )
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() =>
                  setExtras((current) =>
                    current.filter((item) => item.key !== extra.key),
                  )
                }
                aria-label="구성 삭제"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div>
        <label
          htmlFor={`${formId}-note`}
          className="mb-1.5 block text-xs font-medium"
        >
          메모
        </label>
        <Input
          id={`${formId}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="선택"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!canSave || mutation.isPending}
          onClick={submit}
        >
          <Save className="size-3.5" />
          {mutation.isPending ? '저장 중...' : submitLabel}
        </Button>
        {errorMessage ? (
          <p className="text-xs text-danger">{errorMessage}</p>
        ) : savedMessage ? (
          <p className="text-xs text-success">{savedMessage}</p>
        ) : null}
      </div>
    </div>
  )
}
