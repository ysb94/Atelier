import { createHash } from 'node:crypto'

const plain = items => (items ?? []).map(v => v.plain_text ?? v.text?.content ?? '').join('')
export function taskFromPage(page, props) {
  const p = page.properties
  const text = key => plain(p[props[key]]?.rich_text)
  const task = { id: page.id, url: page.url, title: plain(p[props.title]?.title), enabled: p[props.enabled]?.checkbox === true,
    state: p[props.state]?.select?.name, request: text('request'), criteria: text('criteria'), files: text('files'), order: p[props.order]?.number ?? 999999 }
  task.version = createHash('sha256').update(JSON.stringify([task.title, task.request, task.criteria, task.files])).digest('hex')
  return task
}

export class Notion {
  constructor(config, fetcher = fetch) { this.config = config; this.fetch = fetcher }
  async api(endpoint, method = 'GET', body) {
    const response = await this.fetch(`https://api.notion.com/v1/${endpoint}`, {
      method, headers: { Authorization: `Bearer ${this.config.env.NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(`Notion ${response.status}: ${data.code ?? 'API 오류'}`)
    return data
  }
  async ready() {
    const schema = await this.api(`data_sources/${this.config.dataSourceId}`)
    for (const name of Object.values(this.config.properties)) if (!schema.properties[name]) throw new Error(`노션 속성이 없습니다: ${name}`)
    return true
  }
  async queue() {
    const p = this.config.properties
    const body = { filter: { and: [{ property: p.enabled, checkbox: { equals: true } }, { property: p.state, select: { equals: '대기' } }] },
      sorts: [{ property: p.order, direction: 'ascending' }], page_size: 100 }
    const result = await this.api(`data_sources/${this.config.dataSourceId}/query`, 'POST', body)
    return result.results.map(page => taskFromPage(page, p))
  }
  async task(id) { return taskFromPage(await this.api(`pages/${id}`), this.config.properties) }
  async publish(id, update) {
    const p = this.config.properties, properties = {}
    if (update.state) properties[p.state] = { select: { name: update.state } }
    if (update.progress) properties[p.progress] = { select: { name: update.progress } }
    if (update.attempt !== undefined) properties[p.attempt] = { number: update.attempt }
    if (update.summary !== undefined) properties[p.result] = { rich_text: [{ type: 'text', text: { content: update.summary.slice(0,1900) } }] }
    if (Object.keys(properties).length) await this.api(`pages/${id}`, 'PATCH', { properties })
    if (update.note) {
      // A stable marker prevents duplicate reports after a write succeeded but its response was lost.
      const marker = `Atelier AI ${update.eventId}`
      let cursor, found = false
      do {
        const data = await this.api(`blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`)
        found = data.results.some(b => plain(b[b.type]?.rich_text).includes(marker))
        cursor = data.has_more ? data.next_cursor : undefined
      } while (cursor && !found)
      if (!found) {
        const note=update.note.length>80000?`${update.note.slice(0,80000)}\n긴 기록의 전체 내용은 로컬 실행 기록에 보관했습니다.`:update.note
        const lines = [`${marker}\n${note}`].flatMap(s => s.match(/[\s\S]{1,1800}/g) ?? [])
        await this.api(`blocks/${id}/children`, 'PATCH', { children: lines.map(content => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } })) })
      }
    }
  }
}
