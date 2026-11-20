import { useContext, useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type { ProductDraft } from '@/lib/types'
import {
  DEFAULT_DRAFT_MD_OPTIONS, DRAFT_MD_OPTION_LABELS, DraftMdOptionsContext, initialDraftMdOptionId,
  type DraftMdOption, type DraftMdOptionField,
} from './draft-md-options'
import { DraftMdOptionDialog } from './DraftMdOptionDialog'

type MdSection = 'listing' | 'price' | 'options'

const ORDER_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function DraftMdOptionsProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState(DEFAULT_DRAFT_MD_OPTIONS)
  const catalog = useMemo(() => ({
    lists,
    update: (field: DraftMdOptionField, options: DraftMdOption[]) =>
      setLists(current => ({ ...current, [field]: options })),
  }), [lists])
  return <DraftMdOptionsContext.Provider value={catalog}>{children}</DraftMdOptionsContext.Provider>
}

function MdSelect({ label, value, options, disabled, onChange }: {
  label: string
  value: string
  options: DraftMdOption[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <span className="draft-md-select">
      <Select aria-label={label} value={options.some(option => option.id === value) ? value : ''} disabled={disabled}
        onChange={event => onChange(event.currentTarget.value)}>
        <option value="">select</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </Select>
    </span>
  )
}

function MdField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="draft-md-field"><span>{label}</span>{children}</div>
}

export function DraftMdTeamCell({ draft, readOnly }: { draft: ProductDraft; readOnly: boolean }) {
  const catalog = useContext(DraftMdOptionsContext)
  const [arrival, setArrival] = useState('')
  const [editingArrival, setEditingArrival] = useState(false)
  const [orderConfirmed, setOrderConfirmed] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [managingOptions, setManagingOptions] = useState<DraftMdOptionField | null>(null)
  const [registerType, setRegisterType] = useState(() => initialDraftMdOptionId('register', draft.registerType))
  const [openType, setOpenType] = useState(() => initialDraftMdOptionId('open', draft.openType))
  const [retailPrice, setRetailPrice] = useState(draft.retailPrice?.toString() ?? '')
  const [discountPrice, setDiscountPrice] = useState(draft.discountPrice?.toString() ?? '')
  const [extraDiscount, setExtraDiscount] = useState('')
  const [auto, setAuto] = useState(false)
  const [option, setOption] = useState(() => initialDraftMdOptionId('option', draft.hasOptions ? '있음' : ''))
  const [confirmed, setConfirmed] = useState({ listing: false, price: false, options: false })
  if (!catalog) throw new Error('DraftMdTeamCell requires DraftMdOptionsProvider')

  const listingLocked = readOnly || confirmed.listing
  const priceLocked = readOnly || confirmed.price
  const optionsLocked = readOnly || confirmed.options

  function confirmOrder() {
    const expectedDay = new Date(`${ORDER_DATE.format(new Date())}T00:00:00Z`)
    expectedDay.setUTCDate(expectedDay.getUTCDate() + 60)
    setArrival(expectedDay.toISOString().slice(0, 10))
    setEditingArrival(false)
    setOrderConfirmed(true)
  }

  function manageOptionButton(field: DraftMdOptionField, disabled: boolean) {
    return (
      <Button type="button" variant="secondary" size="icon" className="draft-md-add"
        aria-label={`${DRAFT_MD_OPTION_LABELS[field]} 목록 관리`} disabled={disabled}
        onClick={() => setManagingOptions(field)}>
        <Plus size={15} strokeWidth={3} aria-hidden="true" />
      </Button>
    )
  }

  function confirmButton(section: MdSection, label: string) {
    const action = confirmed[section] ? '수정' : '확정'
    return (
      <Button type="button" variant="outline" size="sm" className="draft-md-confirm" aria-label={`${label} ${action}`} disabled={readOnly}
        onClick={() => setConfirmed(current => ({ ...current, [section]: !current[section] }))}>
        {action}
      </Button>
    )
  }

  return (
    <td className="draft-sheet-md-cell">
      <div className="draft-md-layout">
        <div className="draft-md-order">
          <div className="draft-color-pad justify-center">
            <Button type="button" variant="outline" size="sm"
              className={`draft-md-order-status${orderConfirmed || draft.orderDone ? ' is-done' : ''}`}
              disabled={readOnly} onClick={confirmOrder}>발주확정</Button>
          </div>
          <div className="draft-color-lines">
            {draft.colors.map((color, index) => {
              const name = color.name.trim() || `컬러 ${index + 1}`
              const quantity = quantities[color.id] ?? color.orderQty?.toString() ?? ''
              return (
                <div key={color.id} className={`draft-color-line${index % 2 === 1 ? ' is-alt' : ''}`}>
                  <label className="draft-md-order-quantity">
                    <Input inputMode="numeric" aria-label={`${name} 발주 수량`} disabled={readOnly}
                      value={quantity.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} onChange={event => {
                        const next = event.currentTarget.value.replaceAll(',', '')
                        if (/^\d*$/.test(next)) setQuantities(current => ({ ...current, [color.id]: next }))
                      }} />
                  </label>
                </div>
              )
            })}
          </div>
        </div>

        <div className="draft-md-main">
          <section className="draft-md-section draft-md-listing" aria-label="등록 및 오픈 유형">
            <div className="draft-md-arrival">
              {editingArrival && !listingLocked ? (
                <label>예상입고일 : <Input type="date" autoFocus value={arrival} onBlur={() => setEditingArrival(false)}
                  onChange={event => setArrival(event.currentTarget.value)} /></label>
              ) : (
                <button type="button" disabled={listingLocked} onClick={() => setEditingArrival(true)}>
                  예상입고일 : {arrival ? arrival.slice(2).replaceAll('-', '.') : '미정'}
                </button>
              )}
            </div>
            <MdField label="등록유형">
              <MdSelect label="등록유형" value={registerType} options={catalog.lists.register} disabled={listingLocked} onChange={setRegisterType} />
              {manageOptionButton('register', listingLocked)}
            </MdField>
            <MdField label="오픈유형">
              <MdSelect label="오픈유형" value={openType} options={catalog.lists.open} disabled={listingLocked} onChange={setOpenType} />
              {manageOptionButton('open', listingLocked)}
            </MdField>
            {confirmButton('listing', '등록 및 오픈 유형')}
          </section>

          <section className="draft-md-section draft-md-pricing" aria-label="판매가 및 할인가">
            <MdField label="판매가">
              <Input className="draft-md-input" aria-label="판매가" inputMode="numeric" placeholder="직접등록"
                value={retailPrice} disabled={priceLocked} onChange={event => setRetailPrice(event.currentTarget.value)} />
              <Button type="button" variant="outline" size="sm" className="draft-md-auto" aria-pressed={auto} disabled={priceLocked}
                onClick={() => setAuto(current => !current)}>Auto</Button>
            </MdField>
            <MdField label="할인가">
              <Input className="draft-md-input" aria-label="할인가" inputMode="numeric" placeholder="직접등록"
                value={discountPrice} disabled={priceLocked} onChange={event => setDiscountPrice(event.currentTarget.value)} />
              <Input className="draft-md-input" aria-label="할인가 추가 입력" inputMode="numeric" placeholder="직접등록"
                value={extraDiscount} disabled={priceLocked} onChange={event => setExtraDiscount(event.currentTarget.value)} />
            </MdField>
            {confirmButton('price', '판매가 및 할인가')}
          </section>

          <section className="draft-md-section draft-md-product" aria-label="제조국 및 옵션">
            <div className="draft-md-origin"><span>제조국</span><span>{draft.originCountry.trim() || '미정'}</span></div>
            <MdField label="옵션유무">
              <MdSelect label="옵션유무" value={option} options={catalog.lists.option} disabled={optionsLocked} onChange={setOption} />
              {manageOptionButton('option', optionsLocked)}
            </MdField>
            {confirmButton('options', '제조국 및 옵션')}
          </section>
        </div>
      </div>
      {managingOptions && (
        <DraftMdOptionDialog label={DRAFT_MD_OPTION_LABELS[managingOptions]} options={catalog.lists[managingOptions]}
          onChange={options => catalog.update(managingOptions, options)} onClose={() => setManagingOptions(null)} />
      )}
    </td>
  )
}
