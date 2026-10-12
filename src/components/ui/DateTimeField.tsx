import { Input, Select } from './input'

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, '0'),
)
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, '0'),
)

/** 브라우저 로케일의 오전/오후 없이 날짜 + 24시간제 시·분을 고른다. */
export function DateTimeField({
  id,
  label,
  value,
  defaultTime,
  onChange,
}: {
  id: string
  label: string
  value: string
  defaultTime: string
  onChange: (next: string) => void
}) {
  const date = value.slice(0, 10)
  const time = value.length >= 16 ? value.slice(11, 16) : defaultTime
  const [hour = '00', minute = '00'] = time.split(':')

  function commit(nextDate: string, nextHour: string, nextMinute: string) {
    if (!nextDate) {
      onChange('')
      return
    }
    onChange(`${nextDate} ${nextHour}:${nextMinute}`)
  }

  return (
    <div className="w-fit">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium">
        {label}
      </label>
      <div className="flex w-fit items-center gap-1">
        <Input
          id={id}
          type="date"
          value={date}
          onChange={(event) => commit(event.target.value, hour, minute)}
          className="w-[9.75rem] shrink-0 px-2"
        />
        <Select
          aria-label={`${label} 시`}
          value={hour}
          disabled={!date}
          onChange={(event) => commit(date, event.target.value, minute)}
          className="w-[3.25rem] shrink-0 px-1"
        >
          {HOUR_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground" aria-hidden>
          :
        </span>
        <Select
          aria-label={`${label} 분`}
          value={minute}
          disabled={!date}
          onChange={(event) => commit(date, hour, event.target.value)}
          className="w-[3.25rem] shrink-0 px-1"
        >
          {MINUTE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}
