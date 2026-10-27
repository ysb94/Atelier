import { useRef, useState, type FormEvent } from 'react'
import { CheckCheck, Plus } from 'lucide-react'
import { useRenderWatch } from '@/lib/diagnostics'

type Todo = { id: string; title: string; done: boolean }

export function HomeTodoList() {
  useRenderWatch('HomeTodoList')
  const [items, setItems] = useState<Todo[]>([])
  const [title, setTitle] = useState('')
  const nextId = useRef(0)
  const completed = items.filter(item => item.done).length
  const sorted = [...items.filter(item => !item.done), ...items.filter(item => item.done)]
  function addTodo(event: FormEvent) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    nextId.current += 1
    setItems(current => [...current, { id: `local-${nextId.current}`, title: trimmed, done: false }])
    setTitle('')
  }
  return <section className="home-side-card home-todos" aria-label="오늘 할 일">
    <div className="home-section-heading"><h2>오늘 할 일</h2><CheckCheck size={17} /></div>
    <div className="home-todo-progress"><span>{items.length}개 중 <strong>{completed}개 완료</strong></span></div>
    <div className="home-todo-track"><span style={{ width: `${items.length ? completed / items.length * 100 : 0}%` }} /></div>
    <div className="home-todo-list">{sorted.map(item => <label key={item.id} className={item.done ? 'is-complete' : ''}><input type="checkbox" checked={item.done} onChange={() => setItems(current => current.map(value => value.id === item.id ? { ...value, done: !value.done } : value))} /><span>{item.title}</span></label>)}</div>
    {items.length === 0 && <p className="home-todo-empty">오늘 할 일을 간단히 적어보세요.</p>}
    <form onSubmit={addTodo} className="home-todo-form"><input aria-label="할 일 입력" placeholder="할 일 추가" maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /><button type="submit" aria-label="할 일 추가" disabled={!title.trim()}><Plus size={17} /></button></form>
    <p className="home-todo-note">체크는 개인 확인용입니다. 실제 업무 상태는 바뀌지 않으며, 새로고침하면 초기화됩니다.</p>
  </section>
}
