import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import {
  FIELD_MAP,
  IMPORT_FIELDS,
  OWNER_LABEL,
  OWNER_ORDER,
  type FieldOwner,
} from '@/lib/import/fields'
import type { ColumnMapping } from '@/lib/import/transform'
import type { ParsedSheet } from '@/lib/import/parse'

type MappingStepProps = {
  sheet: ParsedSheet
  hasHeader: boolean
  mapping: ColumnMapping
  onMappingChange: (mapping: ColumnMapping) => void
  sourceOwner: FieldOwner
  allowCrossDepartment: boolean
  onAllowCrossDepartmentChange: (value: boolean) => void
  onBack: () => void
  onNext: () => void
}

export function MappingStep({
  sheet,
  hasHeader,
  mapping,
  onMappingChange,
  sourceOwner,
  allowCrossDepartment,
  onAllowCrossDepartmentChange,
  onBack,
  onNext,
}: MappingStepProps) {
  const headerRow = hasHeader ? (sheet.rows[0] ?? []) : []
  const sampleRows = (hasHeader ? sheet.rows.slice(1) : sheet.rows).slice(0, 2)
  const columnCount = Math.max(
    ...sheet.rows.slice(0, 20).map((row) => row.length),
    0,
  )

  const usedKeys = new Set(mapping.filter(Boolean) as string[])
  const styleNoMapped = usedKeys.has('styleNo')
  const mappedCount = usedKeys.size

  function setColumn(index: number, value: string) {
    const next = [...mapping]
    const fieldKey = value || null
    if (fieldKey) {
      // 한 필드에 두 컬럼이 붙지 않도록 기존 매핑을 해제한다.
      for (let i = 0; i < next.length; i += 1) {
        if (i !== index && next[i] === fieldKey) next[i] = null
      }
    }
    next[index] = fieldKey
    onMappingChange(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="text-sm text-muted-foreground">
          {mappedCount}개 컬럼이 매핑되었습니다
        </div>
        <label className="flex items-center gap-2 text-sm sm:ml-auto">
          <input
            type="checkbox"
            className="size-4"
            checked={allowCrossDepartment}
            onChange={(e) => onAllowCrossDepartmentChange(e.target.checked)}
          />
          다른 부서 소유 필드도 덮어쓰기
        </label>
      </div>

      {!styleNoMapped ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          품번 컬럼을 반드시 지정해야 합니다. 품번이 기존 상품과 연결하는
          기준입니다.
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">시트 컬럼</th>
                <th className="px-4 py-3 font-medium">예시 값</th>
                <th className="px-4 py-3 font-medium">시스템 필드</th>
                <th className="px-4 py-3 font-medium">반영</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: columnCount }, (_, index) => {
                const fieldKey = mapping[index] ?? null
                const field = fieldKey ? FIELD_MAP.get(fieldKey) : null
                const ignored =
                  field &&
                  field.key !== 'styleNo' &&
                  field.owner !== 'common' &&
                  field.owner !== sourceOwner &&
                  !allowCrossDepartment

                return (
                  <tr
                    key={index}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {headerRow[index] || `${index + 1}번째 열`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {sampleRows
                        .map((row) => row[index])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        className="w-44"
                        value={fieldKey ?? ''}
                        onChange={(e) => setColumn(index, e.target.value)}
                      >
                        <option value="">가져오지 않음</option>
                        {OWNER_ORDER.map((owner) => {
                          const fields = IMPORT_FIELDS.filter(
                            (f) => f.owner === owner,
                          )
                          if (fields.length === 0) return null
                          return (
                            <optgroup key={owner} label={OWNER_LABEL[owner]}>
                              {fields.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                          )
                        })}
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      {!field ? (
                        <span className="text-muted-foreground">—</span>
                      ) : ignored ? (
                        <Badge variant="warning">
                          참고만 ({OWNER_LABEL[field.owner]} 소유)
                        </Badge>
                      ) : (
                        <Badge variant="success">반영</Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <CardContent className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        시스템 필드를 비워두면 그 컬럼은 무시됩니다. 지금 매핑하지 않아도
        나중에 같은 시트를 다시 올려 채울 수 있습니다.
      </CardContent>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          이전
        </Button>
        <Button type="button" onClick={onNext} disabled={!styleNoMapped}>
          검증 결과 보기
        </Button>
      </div>
    </div>
  )
}
