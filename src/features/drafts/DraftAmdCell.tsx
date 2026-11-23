import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DraftTeamRecord, DraftTeamValues } from '@/lib/supabase/draft-team-work'
import type { DraftColorRow } from '@/lib/types'
import type { DraftTeamWork } from './use-draft-team-work'

const EMPTY_CODES = { sabangnet: '', barcode: '' }
type AmdValues = DraftTeamValues['amd']
type AmdNumber = { label: string; placeholder: string; value: string; numeric?: boolean }

function AmdNumbers({ name, fields, locked, saving, onSave, onReset }: {
  name: string
  fields: AmdNumber[]
  locked: boolean
  saving: boolean
  onSave: (values: string[]) => Promise<boolean>
  onReset: () => void
}) {
  const [edit, setEdit] = useState<{ original: string[]; values: string[] }>()
  const saved = fields.map(field => field.value)
  const values = edit?.values ?? saved
  const changed = saved.some((value, index) => value !== values[index])
  const conflict = Boolean(edit && saved.some((value, index) => value !== edit.original[index]))

  async function save() {
    if (await onSave(values)) setEdit(undefined)
  }

  return <>
    {fields.map((field, index) => <label key={field.placeholder} className="draft-amd-entry">
      <Input className="draft-team-control" aria-label={field.label} placeholder={field.placeholder} autoComplete="off"
        inputMode={field.numeric ? 'numeric' : undefined} maxLength={80} disabled={locked || conflict} value={values[index]}
        onChange={event => {
          const value = event.currentTarget.value
          setEdit(current => ({ original: current?.original ?? saved,
            values: (current?.values ?? saved).map((previous, position) => position === index ? value : previous) }))
        }} />
    </label>)}
    <Button type="button" size="sm" variant="outline" className="draft-team-control draft-amd-save"
      aria-label={`${name} ${conflict ? '최신값 불러오기' : '저장'}`} disabled={locked || (!conflict && !changed)}
      onClick={conflict ? () => { setEdit(undefined); onReset() } : () => void save()}>
      {saving ? '저장 중…' : conflict ? '다시 조회' : '저장'}
    </Button>
  </>
}

export function DraftAmdCell({ colors, readOnly, teamWork }: {
  colors: DraftColorRow[]
  readOnly: boolean
  teamWork: DraftTeamWork
}) {
  const amd = teamWork.records?.get('amd') as DraftTeamRecord<'amd'> | undefined
  const saved: AmdValues = amd?.payload ?? { collection: '', colors: {} }
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const locked = readOnly || !teamWork.ready || saving !== null

  async function save(target: string, update: (payload: AmdValues) => AmdValues) {
    if (locked) return false
    setSaving(target)
    setError('')
    try {
      const payload = update({ ...saved, colors: Object.fromEntries(colors.map(color =>
        [color.id, saved.colors[color.id] ?? EMPTY_CODES])) })
      await teamWork.save('amd', payload, amd?.confirmed ?? false, amd?.revision ?? null)
      return true
    } catch (failure) {
      const code = (failure as { code?: string })?.code
      setError(code === '40001' ? '다른 화면에서 먼저 저장했습니다. 최신 번호를 확인한 뒤 다시 시도해 주세요.'
        : code === '42501' ? '기획안을 편집할 권한이 없습니다.'
          : code === '22023' ? '컬러 구성이나 입력한 번호를 확인해 주세요.'
            : 'AMD 번호를 저장하지 못했습니다. 입력값을 유지했습니다.')
      return false
    } finally {
      setSaving(null)
    }
  }

  function clearError() { setError('') }

  return <td className="draft-sheet-amd-cell">
    <div className="draft-color-pad draft-amd-header">
      <AmdNumbers name="모음전 번호" fields={[{ label: '모음전 번호', placeholder: '모음전 no.', value: saved.collection }]}
        locked={locked} saving={saving === 'collection'} onReset={clearError}
        onSave={([collection]) => save('collection', payload => ({ ...payload, collection: collection.trim() }))} />
    </div>
    <div className="draft-color-lines">
      {colors.map((color, index) => {
        const name = color.name.trim() || `컬러 ${index + 1}`
        const codes = saved.colors[color.id] ?? EMPTY_CODES
        return <div key={color.id} className={`draft-color-line${index % 2 ? ' is-alt' : ''}`}>
          <AmdNumbers name={`${name} AMD 번호`} fields={[
            { label: `${name} 사방넷 번호`, placeholder: '사방넷 no.', value: codes.sabangnet },
            { label: `${name} 바코드 번호`, placeholder: '바코드 no.', value: codes.barcode, numeric: true },
          ]} locked={locked} saving={saving === color.id} onReset={clearError}
            onSave={([sabangnet, barcode]) => save(color.id, payload => ({ ...payload, colors: {
              ...payload.colors, [color.id]: { sabangnet: sabangnet.trim(), barcode: barcode.trim() },
            } }))} />
        </div>
      })}
    </div>
    {error && <p role="alert" className="draft-team-notice">{error}</p>}
  </td>
}
