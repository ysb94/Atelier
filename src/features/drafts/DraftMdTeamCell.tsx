import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { DRAFT_OPEN_TYPE_OPTIONS, DRAFT_REGISTER_TYPE_OPTIONS, type ProductDraft } from '@/lib/types'
import { formatNumber } from '@/lib/utils'

type MdListing = { registerType: string; openType: string }
type MdSection = 'listing' | 'price' | 'options'

function MdSelect({ label, value, options, disabled, onChange }: {
  label: string
  value: string
  options: readonly string[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <span className="draft-md-select">
      <Select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)}>
        <option value="">select</option>
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </Select>
    </span>
  )
}

function MdField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="draft-md-field"><span>{label}</span>{children}</div>
}

export function DraftMdTeamCell({ draft, readOnly }: { draft: ProductDraft; readOnly: boolean }) {
  const [arrival, setArrival] = useState('')
  const [editingArrival, setEditingArrival] = useState(false)
  const [listings, setListings] = useState<MdListing[]>([{ registerType: draft.registerType, openType: draft.openType }])
  const [retailPrice, setRetailPrice] = useState(draft.retailPrice?.toString() ?? '')
  const [discountPrice, setDiscountPrice] = useState(draft.discountPrice?.toString() ?? '')
  const [extraDiscount, setExtraDiscount] = useState('')
  const [auto, setAuto] = useState(false)
  const [option, setOption] = useState(draft.hasOptions ? '있음' : '')
  const [confirmed, setConfirmed] = useState({ listing: false, price: false, options: false })

  const orderQuantities = draft.colors.flatMap(color => color.orderQty == null ? [] : [color.orderQty])
  const orderQuantity = orderQuantities.length ? formatNumber(orderQuantities.reduce((total, quantity) => total + quantity, 0)) : '—'
  const listingLocked = readOnly || confirmed.listing
  const priceLocked = readOnly || confirmed.price
  const optionsLocked = readOnly || confirmed.options

  function updateListing(index: number, field: keyof MdListing, value: string) {
    setListings(current => current.map((listing, position) => position === index ? { ...listing, [field]: value } : listing))
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
          <div className="draft-md-order-summary">
            <span className={`draft-md-order-status${draft.orderDone ? ' is-done' : ''}`}>발주확정</span>
            <span className="draft-md-order-quantity" aria-label={`총 발주 수량 ${orderQuantity}`}>{orderQuantity}</span>
          </div>
          {draft.colors.map(color => (
            <div className="draft-md-color" key={color.id}>
              <span title={color.name.trim()}>{color.name.trim() || '—'}</span>
            </div>
          ))}
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
            {listings.map((listing, index) => (
              <div className="draft-md-fields" key={index}>
                <MdField label="등록유형">
                  <MdSelect label={index ? `등록유형 ${index + 1}` : '등록유형'} value={listing.registerType} options={DRAFT_REGISTER_TYPE_OPTIONS}
                    disabled={listingLocked} onChange={value => updateListing(index, 'registerType', value)} />
                  {index === 0 && (
                    <Button type="button" variant="secondary" size="icon" className="draft-md-add" aria-label="등록유형 추가" disabled={listingLocked}
                      onClick={() => setListings(current => [...current, { registerType: '', openType: '' }])}>
                      <Plus size={15} strokeWidth={3} aria-hidden="true" />
                    </Button>
                  )}
                </MdField>
                <MdField label="오픈유형">
                  <MdSelect label={index ? `오픈유형 ${index + 1}` : '오픈유형'} value={listing.openType} options={DRAFT_OPEN_TYPE_OPTIONS}
                    disabled={listingLocked} onChange={value => updateListing(index, 'openType', value)} />
                </MdField>
              </div>
            ))}
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
              <MdSelect label="옵션유무" value={option} options={['있음', '없음']} disabled={optionsLocked} onChange={setOption} />
            </MdField>
            {confirmButton('options', '제조국 및 옵션')}
          </section>
        </div>
      </div>
    </td>
  )
}
