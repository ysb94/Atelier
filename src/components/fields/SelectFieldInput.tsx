import type { MouseEvent } from 'react'
import { Select } from '@/components/ui/input'
import { selectOptionsForEditor } from '@/lib/products/brand-field-select'
import type { BrandField } from '@/lib/types'

type SelectFieldInputProps = {
  field: BrandField
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  className?: string
  emptyLabel?: string
  autoFocus?: boolean
  onBlur?: () => void
  onClick?: (event: MouseEvent<HTMLSelectElement>) => void
}

export function SelectFieldInput({
  field,
  value,
  onChange,
  disabled,
  required,
  className,
  emptyLabel = '선택',
  autoFocus,
  onBlur,
  onClick,
}: SelectFieldInputProps) {
  const options = selectOptionsForEditor(field, value)

  return (
    <Select
      className={className}
      value={value}
      disabled={disabled}
      required={required}
      autoFocus={autoFocus}
      onBlur={onBlur}
      onClick={onClick}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}
