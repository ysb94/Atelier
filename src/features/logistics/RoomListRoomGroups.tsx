import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { readRoomPrefixes, type RoomGroup } from './room-list-rooms'

export function RoomListRoomGroups({ groups, onChange }: { groups: RoomGroup[]; onChange: (groups: RoomGroup[]) => void }) {
  const [name, setName] = useState('')
  const [prefixText, setPrefixText] = useState('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [error, setError] = useState('')

  function reset() {
    setName('')
    setPrefixText('')
    setEditingName(null)
    setError('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = name.trim()
    const prefixes = readRoomPrefixes(prefixText)
    if (!nextName || prefixes.length < 2 || prefixes.some(prefix => [...prefix].length !== 1)) {
      setError('방 이름과 한 글자짜리 위치 첫 글자 두 개 이상을 입력해 주세요.')
      return
    }
    const otherGroups = groups.filter(group => group.name !== editingName)
    if (otherGroups.some(group => group.name === nextName)) {
      setError('이미 사용 중인 방 이름입니다.')
      return
    }
    if (otherGroups.some(group => prefixes.some(prefix => group.prefixes.includes(prefix)))) {
      setError('다른 방에 들어 있는 첫 글자는 먼저 그 방에서 빼 주세요.')
      return
    }
    const next = { name: nextName, prefixes }
    onChange(editingName ? groups.map(group => group.name === editingName ? next : group) : [...groups, next])
    reset()
  }

  return (
    <Card className="mb-3 space-y-3 p-4">
      <form onSubmit={submit} className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid flex-1 gap-1 text-sm">
            방 이름
            <Input value={name} onChange={event => { setName(event.target.value); setError('') }} />
          </label>
          <label className="grid flex-1 gap-1 text-sm">
            위치 첫 글자
            <Input value={prefixText} placeholder="$, #, *" onChange={event => { setPrefixText(event.target.value); setError('') }} />
          </label>
          <Button type="submit">{editingName ? '변경 저장' : '묶음 추가'}</Button>
          {editingName && <Button type="button" variant="outline" onClick={reset}>취소</Button>}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
      {groups.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {groups.map(group => (
            <li key={group.name} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <strong>{group.name}</strong>
              <span className="text-muted-foreground">{group.prefixes.join(', ')}</span>
              <div className="ml-auto flex gap-1">
                <Button type="button" variant="ghost" size="sm" aria-label={`${group.name} 수정`} onClick={() => {
                  setName(group.name)
                  setPrefixText(group.prefixes.join(', '))
                  setEditingName(group.name)
                  setError('')
                }}>수정</Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`${group.name} 묶음 해제`} onClick={() => {
                  onChange(groups.filter(item => item.name !== group.name))
                  if (editingName === group.name) reset()
                }}>해제</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
