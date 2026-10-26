import { Button } from '@/components/ui/button'
import { startOptionLabel } from './attendance-start-settings'
import { useAttendanceStartOptions } from './use-attendance-start-options'

export function StartTimeChoices({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const { options } = useAttendanceStartOptions()
  const choices = value && !options.includes(value) ? [...options, value].sort() : options
  return <div className="attendance-start-presets" role="group" aria-label="출근시간 선택">
    {choices.map(item => <Button key={item} type="button" size="sm" variant={value === item ? 'default' : 'outline'} aria-pressed={value === item} disabled={disabled} onClick={() => onChange(item)}>{startOptionLabel(item)}</Button>)}
  </div>
}
