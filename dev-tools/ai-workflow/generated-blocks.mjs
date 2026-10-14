import { randomUUID } from 'node:crypto'

// A bound block id is authoritative. Nonces recover only unbound pending writes.
// A matching title is not ownership. User callouts with the same title stay in the source.
export const PROVENANCE_PREFIX = 'atelier-owned:'
export const GENERATED_BLOCK_KINDS = Object.freeze(['notice', 'report', 'toggle', 'intake'])
const NONCE = new RegExp(`${PROVENANCE_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`, 'i')

export function provenanceSpan(nonce) {
  return { type: 'text', text: { content: '\u200b', link: { url: `https://atelier.invalid/#${PROVENANCE_PREFIX}${nonce}` } } }
}

export function stampCallout(block, nonce) {
  const callout = block?.callout
  if (!callout || !nonce) return block
  const text = callout.rich_text ?? []
  if (!JSON.stringify(text).includes(`${PROVENANCE_PREFIX}${nonce}`)) callout.rich_text = [...text, provenanceSpan(nonce)]
  return block
}

export function nonceInBlock(block) {
  if (!block?.type) return null
  const body = block[block.type] ?? {}
  const match = JSON.stringify({ rich_text: body.rich_text ?? [], children: body.children ?? [] }).match(NONCE)
  return match ? match[1].toLowerCase() : null
}

// Root registers historical generated blocks after this change. Notion itself is not modified.
// Input: { blocks: [{ pageId, blockId, kind, runId?, cycleId?, eventId?, nonce? }] }
// kind is notice, report, toggle, or intake. pageId and blockId are Notion UUIDs.
export function applyGeneratedBlockMigration(store, input) {
  if (!input || !Array.isArray(input.blocks)) {
    throw new Error('이관 입력은 { "blocks": [ { "pageId": "<노션 페이지 UUID>", "blockId": "<노션 블록 UUID>", "kind": "notice|report|toggle|intake" } ] } 형식이어야 합니다.')
  }
  const ledger = new GeneratedBlockLedger(store)
  input.blocks.forEach((entry, index) => {
    if (!entry || typeof entry.pageId !== 'string' || !entry.pageId.trim() || typeof entry.blockId !== 'string' || !entry.blockId.trim()) {
      throw new Error(`blocks[${index}]에는 pageId와 blockId 문자열이 필요합니다.`)
    }
    if (!GENERATED_BLOCK_KINDS.includes(entry.kind)) {
      throw new Error(`blocks[${index}].kind는 ${GENERATED_BLOCK_KINDS.join('/')} 중 하나여야 합니다.`)
    }
    ledger.claim({
      pageId: entry.pageId.trim(),
      blockId: entry.blockId.trim(),
      kind: entry.kind,
      runId: entry.runId ?? null,
      cycleId: entry.cycleId ?? null,
      eventId: entry.eventId ?? `legacy:${entry.blockId.trim()}`,
      nonce: entry.nonce ?? null,
      legacy: true,
    })
  })
  return { imported: input.blocks.length }
}

export class GeneratedBlockLedger {
  constructor(store = null) {
    this.store = store
    this.memory = {}
  }
  data() {
    if (this.store) return this.store.data.generatedBlocks ??= {}
    return this.memory
  }
  save() { this.store?.save() }
  records(pageId) {
    const all = this.data()
    return all[pageId] ??= []
  }
  list(pageId) { return this.data()[pageId] ?? [] }
  hasId(pageId, blockId) {
    return Boolean(blockId) && this.list(pageId).some(item => item.blockId === blockId)
  }
  hasNonce(pageId, nonce) {
    return Boolean(nonce) && this.list(pageId).some(item => !item.retired && !item.blockId && item.nonce === nonce)
  }
  hasPending(pageId) {
    return this.list(pageId).some(item => !item.retired && item.nonce && !item.blockId)
  }
  claim(entry) {
    const list = this.records(entry.pageId)
    if (list.some(item => item.blockId === entry.blockId)) return
    list.push({ ...entry, createdAt: new Date().toISOString() })
    this.save()
  }
  begin(pageId, { kind, runId = null, cycleId = null, eventId }) {
    if (!eventId) throw new Error('생성 블록의 실행 식별이 없습니다.')
    if (!GENERATED_BLOCK_KINDS.includes(kind)) throw new Error(`생성 블록 종류가 올바르지 않습니다: ${kind}`)
    const list = this.records(pageId)
    let record = list.find(item => !item.retired && item.eventId === eventId && item.kind === kind)
    if (!record) {
      record = { kind, runId, cycleId, eventId, nonce: randomUUID(), blockId: null, createdAt: new Date().toISOString() }
      list.push(record)
      this.save()
    }
    return record
  }
  adoptNonce(pageId, nonce, blockId) {
    if (!blockId || !nonce) return
    const record = this.list(pageId).find(item => !item.retired && !item.blockId && item.nonce === nonce)
    if (!record) return
    record.blockId = blockId
    this.save()
  }
  release(pageId, record) {
    const found = this.list(pageId).find(item => item === record || (item.nonce === record?.nonce && item.blockId === record?.blockId && item.eventId === record?.eventId))
    if (!found) return
    found.retired = true
    this.save()
  }
  async blocksOf(notion, pageId, kind) {
    const found = []
    let cursor
    do {
      const data = await notion.api(`blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`)
      for (const block of data.results ?? []) {
        const nonce = nonceInBlock(block)
        const record = this.list(pageId).find(item => !item.retired && ((block.id && item.blockId === block.id) || (!item.blockId && nonce && item.nonce === nonce)))
        if (!record) continue
        if (block.id && record.blockId !== block.id) {
          record.blockId = block.id
          this.save()
        }
        if (kind && record.kind !== kind) continue
        found.push({ block, record })
      }
      cursor = data.has_more ? data.next_cursor : undefined
    } while (cursor)
    return found
  }
  async claimPendingChild(notion, pageId, block) {
    const pending = this.list(pageId).filter(item => !item.retired && item.nonce && !item.blockId)
    if (!pending.length || !block?.id || !block.has_children) return false
    const children = await notion.api(`blocks/${block.id}/children?page_size=100`)
    const blob = JSON.stringify(children.results ?? [])
    const match = pending.find(item => blob.includes(item.nonce))
    if (!match) return false
    match.blockId = block.id
    this.save()
    return true
  }
  async adoptResponse(notion, pageId, record, response) {
    if (record.retired) return null
    if (record.blockId) return record.blockId
    const direct = (response?.results ?? []).find(block => block?.id && nonceInBlock(block) === record.nonce)
    if (direct?.id) {
      record.blockId = direct.id
      this.save()
      return direct.id
    }
    const found = await this.blocksOf(notion, pageId, record.kind)
    const match = found.find(item => item.record.nonce === record.nonce || item.record.eventId === record.eventId)
    if (!match?.block?.id) return null
    record.blockId = match.block.id
    this.save()
    return match.block.id
  }
}
