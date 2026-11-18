import { Select } from '@/components/ui/input'
import { SAMPLE_DESTINATIONS, sampleCountry } from '@/lib/drafts/sample-receipt'

export function SampleDestinationSelect({ value, onChange, label = '샘플 진행처 선택', disabled }: {
  value: string; onChange: (value: string) => void; label?: string; disabled?: boolean
}) {
  const current = sampleCountry(value).label
  const known = SAMPLE_DESTINATIONS.some(option => option.value === current)
  return (
    <Select aria-label={label} className="h-8 w-full text-xs" value={known ? current : value.trim()}
      disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="" disabled>샘플 진행처 선택</option>
      {!known && value.trim() && <option value={value.trim()} disabled>{value.trim()}</option>}
      {SAMPLE_DESTINATIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>
  )
}
