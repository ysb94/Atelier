import { completionDay } from './notion.mjs'
import { completionReportBlock } from './report.mjs'
import { TASK_PROPERTIES } from './control.mjs'
import { provenanceSpan, stampCallout } from './generated-blocks.mjs'
import { EnvironmentError } from './errors.mjs'

export const QUESTION_NOTICE = 'Atelier AI 확인 필요 안내'
export const noticeTitle = runId => runId ? `${QUESTION_NOTICE} · ${runId}` : QUESTION_NOTICE
export const executionMarker = (runId, cycleId) => `실행 식별: ${runId} ${cycleId}`
export const ANSWER_GUIDE = "'내 답변'에 답을 적거나 직접 처리한 결과를 남긴 뒤 위치를 '답변 완료'로 옮겨 주세요. 자동화가 최신 원문과 답변으로 다시 판단해 이어서 진행합니다."

const plain = items => (items ?? []).map(v => v.plain_text ?? v.text?.content ?? '').join('')
const rich = content => ({ rich_text: content ? [{ type: 'text', text: { content: String(content).slice(0, 1900) } }] : [] })
const select = name => ({ select: name ? { name } : null })
const paragraph = content => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: String(content).slice(0, 1900) } }] } })
const sameMinute = (stored, actual) => {
  const a = Date.parse(stored), b = Date.parse(actual)
  return Number.isFinite(a) && Number.isFinite(b) && Math.floor(a / 60000) === Math.floor(b / 60000)
}
const cancelled = (message, flag) => Object.assign(new Error(message), { [flag]: true, discardUpdate: true })
const unstable = () => new Error('노션 조회 중 변경을 감지했습니다. 최신 상태로 기록을 재시도합니다.')

// v2 board writes. The original memo body and answers are source data and never edited;
// only location/state/generated properties and the generated notice/report blocks change.
export class Board {
  constructor(config, notion) { this.config = config; this.notion = notion }
  get ledger() { return this._ledger ?? this.notion?.blockLedger ?? null }
  set ledger(value) { this._ledger = value }
  get props() { return this.config.properties }
  get at() { return this.config.positions }
  manualMemo(task) { return this.config.v2?.manualMemoIntake === true && task.location === this.at.memo }
  automationLocations() { const at = this.at; return [this.config.v2?.manualMemoIntake === true ? null : at.memo, at.preparing, at.answered, at.queued, at.working, at.reviewing].filter(Boolean) }
  stateOf(page) { return page.properties[this.props.state]?.select?.name ?? '대기' }

  async ready() {
    const schema = await this.notion.api(`data_sources/${this.config.dataSourceId}`), problems = []
    for (const name of Object.values(this.props).filter(Boolean)) if (!schema.properties[name]) problems.push(`노션 속성 없음: ${name}`)
    for (const [key, spec] of Object.entries(TASK_PROPERTIES)) {
      const property = schema.properties[this.props[key]]
      if (!property) continue
      if (property.type !== spec.type) problems.push(`노션 속성 형식 오류: ${this.props[key]} (${spec.type} 필요)`)
      const options = property.select?.options?.map(option => option.name) ?? []
      for (const option of spec.options ?? []) if (!options.includes(option)) problems.push(`${this.props[key]} 선택지 없음: ${option}`)
    }
    const locations = schema.properties[this.props.location]?.select?.options?.map(option => option.name) ?? []
    for (const name of Object.values(this.at).filter(Boolean)) if (!locations.includes(name)) problems.push(`${this.props.location} 선택지 없음: ${name}`)
    if (problems.length) throw new Error(problems.join(' / '))
    return true
  }
  async list(location) {
    if (this.config.v2?.manualMemoIntake === true && location === this.at.memo) return []
    const pages = [], body = { filter: { property: this.props.location, select: { equals: location } },
      sorts: [{ property: this.props.order, direction: 'ascending' }, { timestamp: 'created_time', direction: 'ascending' }], page_size: 100 }
    let cursor
    do {
      const data = await this.notion.api(`data_sources/${this.config.dataSourceId}/query`, 'POST', { ...body, ...(cursor ? { start_cursor: cursor } : {}) })
      pages.push(...data.results); cursor = data.has_more ? data.next_cursor : undefined
    } while (cursor)
    return pages
  }
  read(id) { return this.notion.memoSnapshot(id, true) }
  async requireStable(id, expectVersion) {
    const snap = await this.notion.memoSnapshot(id, !!expectVersion)
    if (snap.unstable) throw unstable()
    if (this.manualMemo(snap.task)) throw cancelled('메모는 사용자와 대화로 작업서를 정리하는 공간입니다. 자동화 기록을 적용하지 않습니다.', 'stopped')
    return snap
  }

  ownsExecution(id, update) {
    if (!update?.runId || typeof this.executionOf !== 'function') return true
    const current = this.executionOf(id)
    if (!current?.runId) return true
    if (current.runId !== update.runId) return false
    if (update.cycleId && current.cycleId && current.cycleId !== update.cycleId) return false
    return true
  }
  resultText(update) {
    const summary = String(update.summary ?? '')
    if (!update.runId || !update.cycleId) return summary.slice(0, 1900)
    const failure = update.kind === 'error' && update.eventId ? `\n오류 식별: ${update.eventId}` : ''
    return `${executionMarker(update.runId, update.cycleId)}${failure}\n${summary}`.slice(0, 1900)
  }
  // Outbox consumer. Events recorded by the legacy runner keep their original handling.
  async publish(id, update) {
    if (!update.v2) {
      if (this.config.v2?.manualMemoIntake === true) await this.requireStable(id, update.expectVersion)
      return this.notion.publish(id, update)
    }
    if (!this.ownsExecution(id, update)) {
      console.warn('[ai-workflow] 이전 실행 기록은 현재 카드에 적용하지 않습니다.', { page: id, kind: update.kind, runId: update.runId })
      if (['complete', 'needs_input'].includes(update.kind)) throw cancelled('이전 실행의 기록입니다.', 'superseded')
      return
    }
    const p = this.props, at = this.at
    const snap = await this.notion.memoSnapshot(id, !!update.expectVersion), { task, page } = snap
    if (snap.unstable) throw unstable()
    if (this.manualMemo(task)) throw cancelled('사용자가 카드를 메모로 옮겼으므로 자동화 기록을 적용하지 않습니다.', 'stopped')
    if (update.kind === 'reflection') {
      if ((page.properties[p.pr]?.url ?? null) !== update.prUrl) return
      return this.patch(id, { [p.reflection]: select(update.value) })
    }
    if (update.kind === 'complete') return this.complete(id, update)
    if (update.kind === 'needs_input') return this.recordNeedsInput(id, update)
    if(update.kind==='deferred')return this.recordDeferred(id,update)
    if (update.kind === 'error') return this.recordError(id, snap, update)
    const stopped = task.state === '중지', placed = !update.expectLocations || update.expectLocations.includes(task.location)
    if (stopped || !placed) {
      if (update.kind === 'progress') throw cancelled('사용자가 자동 실행을 중지했거나 카드를 자동화 밖으로 옮겼습니다.', 'stopped')
      return
    }
    if (update.expectVersion && task.version !== update.expectVersion) {
      if (['progress', 'plan'].includes(update.kind)) throw cancelled('작업 중 원문이 바뀌었습니다.', 'superseded')
      return
    }
    if (update.kind === 'progress') {
      await this.patch(id, { [p.state]: select(update.state),
        ...(update.location && update.location !== task.location ? { [p.location]: select(update.location) } : {}),
        ...(update.attempt !== undefined && p.attempt ? { [p.attempt]: { number: update.attempt } } : {}),
        ...(update.clearQuestion && p.question ? { [p.question]: rich('') } : {}) })
      if (update.clearNotice) await this.notice(id, null, { expectVersion: update.expectVersion, locations: [update.location || task.location].filter(Boolean), runId: update.runId, cycleId: update.cycleId })
      return
    }
    if (update.kind === 'plan') return this.patch(id, { [p.request]: rich(update.plan.request), [p.criteria]: rich(update.plan.criteria),
      [p.files]: rich(update.plan.files.join('\n')), [p.model]: rich(update.modelText), [p.baseCommit]: rich(update.baseCommit), [p.branch]: rich(update.branch) })
    throw new Error(`알 수 없는 v2 기록 종류: ${update.kind}`)
  }
  async recordError(id, _snap, update) {
    if (!this.ownsExecution(id, update)) return
    const snap = await this.requireStable(id, update.expectVersion)
    const { task, page } = snap, at = this.at, p = this.props
    if (['중지', '완료', '확인 필요'].includes(task.state) || task.location === at.done || task.location === at.needsInput) return
    if (update.expectVersion && task.version !== update.expectVersion) return
    if (update.expectLocations && !update.expectLocations.includes(task.location)) return
    const summary = this.resultText(update)
    const stored = plain(page.properties[p.result]?.rich_text)
    // Only the same failure delivery is a retry. A new failure in this cycle must be visible.
    if (stored === summary) return
    await this.patch(id, { [p.state]: select('오류'), [p.result]: rich(summary),...(p.question?{[p.question]:rich('')}:{ }),
      ...(this.config.v2?.cursorPull?.enabled&&at.preparing ? { [p.location]: select(at.preparing) } : [at.working, at.reviewing].filter(Boolean).includes(task.location) ? { [p.location]: select(at.queued) } : {}) })
    if(this.ledger)await this.notice(id,[summary,'사용자 답변을 기다리는 상태가 아닙니다. 자동화 담당자가 실행·검증 문제를 해결한 뒤 같은 작업을 재개합니다.'],{expectVersion:update.expectVersion,locations:[at.preparing,at.queued,task.location].filter(Boolean),state:'오류',runId:update.runId,cycleId:update.cycleId,eventId:update.eventId,title:'Atelier AI 자동화 오류 안내',icon:'⚠️'})
  }
  async recordDeferred(id,update) {
    const snap=await this.requireStable(id,update.expectVersion),{task}=snap,p=this.props
    if(!this.ownsExecution(id,update)||update.expectVersion&&task.version!==update.expectVersion)return
    if(update.expectLocations&&!update.expectLocations.includes(task.location))return
    const location = this.config.v2?.manualMemoIntake === true ? this.at.preparing : this.at.memo
    await this.patch(id,{[p.location]:select(location),[p.state]:select('중지'),[p.result]:rich(this.resultText(update)),[p.question]:rich('')})
    await this.notice(id,[update.summary,'사용자 답변 요청이 아닙니다. 보류 상태로 자동 실행하지 않습니다. 대화로 작업서를 정리한 뒤 자동화 단계를 대기로 바꾸고 GPT 준비에서 재개합니다.'],{expectVersion:update.expectVersion,locations:[location],state:'중지',runId:update.runId,cycleId:update.cycleId,eventId:update.eventId,title:'Atelier AI 보류 안내',icon:'⏸️'})
  }
  async recordNeedsInput(id, update) {
    if (!this.ownsExecution(id, update)) return
    const snap = await this.requireStable(id, update.expectVersion)
    const { task, page } = snap, at = this.at, p = this.props
    if (task.state === '중지') return
    if (update.expectVersion && task.version !== update.expectVersion) {
      await this.revertSupersededQuestion(id, update)
      throw cancelled('질문 기록 중 원문이 바뀌어 다시 계획합니다.', 'superseded')
    }
    const question = String(update.question ?? '').slice(0, 1900)
    const summary = this.resultText(update)
    const storedQuestion = plain(page.properties[p.question]?.rich_text)
    const storedResult = plain(page.properties[p.result]?.rich_text)
    const marker = update.runId && update.cycleId ? executionMarker(update.runId, update.cycleId) : ''
    const applied = storedQuestion === question && storedResult === summary && (!marker || storedResult.startsWith(marker))
    // Same event only. A later cycle records again even when the question text matches.
    // If the user already moved this cycle's question off 확인 필요, do not pull it back.
    if (applied && task.location !== at.needsInput) return
    const placed = !update.expectLocations || update.expectLocations.includes(task.location)
    if (task.location !== at.needsInput && !placed) return
    if (!(task.location === at.needsInput && task.state === '확인 필요' && applied)) {
      await this.patch(id, { [p.location]: select(at.needsInput), [p.state]: select('확인 필요'), [p.result]: rich(summary),
        ...(p.question ? { [p.question]: rich(update.question) } : {}), ...(update.attempt !== undefined && p.attempt ? { [p.attempt]: { number: update.attempt } } : {}) })
      const posted = await this.requireStable(id, update.expectVersion)
      const visible = posted.task.location === at.needsInput && posted.task.state === '확인 필요' && (!update.expectVersion || posted.task.version === update.expectVersion)
      if (!visible) {
        if (update.expectVersion && posted.task.version !== update.expectVersion) {
          await this.revertSupersededQuestion(id, update)
          throw cancelled('질문 기록 후 원문 변경을 감지했습니다.', 'superseded')
        }
        if (posted.task.state === '중지') throw cancelled('사용자가 자동 실행을 중지했습니다.', 'stopped')
        if (posted.task.location !== at.needsInput && update.expectLocations && !update.expectLocations.includes(posted.task.location)) return
        throw unstable()
      }
    }
    const guard = { expectVersion: update.expectVersion, locations: [at.needsInput], state: '확인 필요', runId: update.runId, cycleId: update.cycleId, eventId: update.eventId ?? `${update.runId}:${update.cycleId}:needs_input` }
    if (await this.notice(id, update.lines, guard) === 'stale') throw unstable()
    const final = await this.requireStable(id, update.expectVersion)
    if (update.expectVersion && final.task.version !== update.expectVersion) {
      await this.revertSupersededQuestion(id, update)
      throw cancelled('질문 안내 기록 중 원문 변경을 감지했습니다.', 'superseded')
    }
  }
  async revertSupersededQuestion(id, update) {
    const {task, page} = await this.requireStable(id, true)
    if (!this.ownsExecution(id, update) || !update.expectVersion || task.version === update.expectVersion) return
    if (task.state !== '확인 필요' || task.location !== this.at.needsInput) return
    if (plain(page.properties[this.props.result]?.rich_text) !== this.resultText(update)) return
    await this.patch(id, {[this.props.location]: select(this.at.queued), [this.props.state]: select('대기'),
      [this.props.result]: rich('원문이 바뀌어 이전 질문 기록을 취소했습니다. 최신 내용으로 다시 계획합니다.')})
  }
  branchText(page) { return plain(page.properties[this.props.branch]?.rich_text) }
  sameCompletion(snap, update) {
    const { task, page } = snap, publication = update.publication, at = this.at
    const expectedBranch = publication.prUrl ? publication.branch : ''
    const result = plain(page.properties[this.props.result]?.rich_text)
    const identity = update.runId && update.cycleId ? executionMarker(update.runId, update.cycleId) : ''
    const stored = result.match(/실행 식별: (\S+) (\S+)/)
    if (identity && stored && (stored[1] !== update.runId || stored[2] !== update.cycleId)) return false
    // A done card from this publication can finish a missing report. A different run marker cannot.
    if (identity && !result.includes(identity) && !(task.state === '완료' && task.location === at.done && !stored)) return false
    return task.state === '완료' && task.location === at.done
      && (page.properties[this.props.pr]?.url ?? null) === publication.prUrl
      && this.branchText(page) === expectedBranch
      && sameMinute(page.properties[this.props.completedAt]?.date?.start, update.completedAt)
      && (!update.expectVersion || task.version === update.expectVersion)
  }
  completionAllowed(snap, update) {
    const { task, page } = snap, publication = update.publication
    if (!this.ownsExecution(task.id, update)) return false
    if (task.state === '중지') return false
    if (update.expectVersion && task.version !== update.expectVersion) return false
    if (this.sameCompletion(snap, update)) return true
    const active = [this.at.working, this.at.reviewing].filter(Boolean)
    if (!active.includes(task.location)) return false
    const branch = this.branchText(page)
    if (branch && publication.branch && branch !== publication.branch) return false
    return true
  }
  completionStampMatches(snap, update) {
    const { task, page } = snap, publication = update.publication
    if (!publication) return false
    const expectedBranch = publication.prUrl ? publication.branch : ''
    const result = plain(page.properties[this.props.result]?.rich_text)
    const identity = update.runId && update.cycleId ? executionMarker(update.runId, update.cycleId) : ''
    if (!identity || !result.includes(identity)) return false
    return task.state === '완료' && task.location === this.at.done
      && (page.properties[this.props.pr]?.url ?? null) === publication.prUrl
      && this.branchText(page) === expectedBranch
      && sameMinute(page.properties[this.props.completedAt]?.date?.start, update.completedAt)
  }
  reportEventId(update) { return update.eventId ?? `${update.runId}:${update.cycleId}:complete` }
  async classifyCompletion(id, update) {
    const snap = await this.requireStable(id, update.expectVersion)
    if (this.sameCompletion(snap, update)) return 'ready'
    if (update.expectVersion && snap.task.version !== update.expectVersion) return 'superseded'
    if (snap.task.state === '중지') return 'stopped'
    if (this.completionAllowed(snap, update)) throw unstable()
    return 'stopped'
  }
  async revertSupersededCompletion(id, update) {
    const snap = await this.requireStable(id, true)
    if (!update.expectVersion || snap.task.version === update.expectVersion || !this.completionStampMatches(snap, update)) return
    const p = this.props, at = this.at
    await this.patch(id, {
      [p.location]: select(at.queued), [p.state]: select('대기'),
      [p.result]: rich('원문이 바뀌어 완료 기록을 취소했습니다. 같은 작업 브랜치에서 최신 원문을 다시 계획합니다.'),
      ...(p.completedAt ? { [p.completedAt]: { date: null } } : {}),
      ...(p.completedDay ? { [p.completedDay]: { date: null } } : {}),
    })
    await this.archiveOwned(id, 'report', this.reportEventId(update))
  }
  async complete(id, update) {
    const ready = await this.requireStable(id, update.expectVersion)
    if (!this.completionAllowed(ready, update)) {
      console.warn('[ai-workflow] 완료 기록을 건너뜀', { page: id, location: ready.task.location, state: ready.task.state })
      if (update.expectVersion && ready.task.version !== update.expectVersion) {
        await this.revertSupersededCompletion(id, update)
        throw cancelled('작업 중 원문이 바뀌어 완료로 기록하지 않습니다.', 'superseded')
      }
      const branch = this.branchText(ready.page)
      if (branch && update.publication?.branch && branch !== update.publication.branch)
        throw Object.assign(new EnvironmentError(`카드의 브랜치(${branch})와 완료하려는 브랜치(${update.publication.branch})가 다릅니다.`, { retry: false, code: 'completion_rejected', action: '카드의 GitHub 브랜치와 작업 브랜치를 확인한 뒤 자동화 단계를 대기로 바꾸세요.' }), { discardUpdate: true })
      throw cancelled('사용자가 자동 실행을 중지했거나 카드를 자동화 밖으로 옮겼습니다.', 'stopped')
    }
    if (!this.sameCompletion(ready, update)) {
      const p = this.props, at = this.at, publication = update.publication
      const properties = { [p.branch]: rich(publication.prUrl ? publication.branch : ''), [p.pr]: { url: publication.prUrl },
        [p.reflection]: select(publication.prUrl ? publication.reflection : null), [p.model]: rich(update.modelText),
        [p.baseCommit]: rich(publication.baseCommit), [p.result]: rich(this.resultText(update)),
        [p.location]: select(at.done), [p.state]: select('완료'),
        ...(p.question ? { [p.question]: rich('') } : {}), ...(p.attempt ? { [p.attempt]: { number: update.attempt } } : {}),
        ...(p.completedAt ? { [p.completedAt]: { date: { start: update.completedAt } } } : {}),
        ...(p.completedDay ? { [p.completedDay]: { date: { start: completionDay(update.completedAt) } } } : {}) }
      await this.patch(id, properties)
    }
    const posted = await this.classifyCompletion(id, update)
    if (posted === 'superseded') {
      await this.revertSupersededCompletion(id, update)
      throw cancelled('완료 기록 후 원문 변경을 감지했습니다.', 'superseded')
    }
    if (posted === 'stopped') throw cancelled('완료 기록 후 카드가 자동화 밖으로 옮겨졌습니다.', 'stopped')
    if (await this.notice(id, null, { expectVersion: update.expectVersion, locations: [this.at.done], state: '완료', publication: update.publication, completedAt: update.completedAt, runId: update.runId, cycleId: update.cycleId }) === 'stale') throw unstable()
    const reported = await this.ensureReport(id, update)
    if (reported === 'superseded') {
      await this.revertSupersededCompletion(id, update)
      throw cancelled('완료 보고서 기록 후 원문 변경을 감지했습니다.', 'superseded')
    }
    if (reported === 'stopped') throw cancelled('완료 보고서 기록 중 카드가 자동화 밖으로 옮겨졌습니다.', 'stopped')
    const final = await this.classifyCompletion(id, update)
    if (final === 'superseded') {
      await this.revertSupersededCompletion(id, update)
      throw cancelled('완료 확정 전 원문 변경을 감지했습니다.', 'superseded')
    }
    if (final === 'stopped') throw cancelled('완료 확정 전 사용자가 카드를 옮겼습니다.', 'stopped')
    return 'applied'
  }
  async ensureReport(id, update) {
    const ledger = this.ledger
    if (!ledger) throw new Error('생성 블록 원장이 없습니다.')
    const eventId = this.reportEventId(update)
    const mine = (await ledger.blocksOf(this.notion, id, 'report')).filter(item => item.record.eventId === eventId)
    if (mine.length === 1) return this.classifyCompletion(id, update)
    const fresh = await this.classifyCompletion(id, update)
    if (fresh !== 'ready') return fresh
    const record = ledger.begin(id, { kind: 'report', runId: update.runId, cycleId: update.cycleId, eventId })
    const block = stampCallout(completionReportBlock({ source: update.source }, update.report, update.completedAt, update.publication), record.nonce)
    const created = await this.notion.api(`blocks/${id}/children`, 'PATCH', { children: [block] })
    await ledger.adoptResponse(this.notion, id, record, created)
    const after = await this.classifyCompletion(id, update)
    if (after !== 'ready') {
      await this.archiveOwned(id, 'report', eventId)
      return after
    }
    const written = (await ledger.blocksOf(this.notion, id, 'report')).filter(item => item.record.eventId === eventId)
    if (written.length !== 1) throw unstable()
    return 'ready'
  }
  async archiveOwned(id, kind, eventId) {
    const ledger = this.ledger
    if (!ledger) return
    const owned = await ledger.blocksOf(this.notion, id, kind)
    for (const item of owned) {
      if (eventId && item.record.eventId !== eventId) continue
      if (item.block?.id) await this.notion.api(`blocks/${item.block.id}`, 'PATCH', { archived: true })
      ledger.release(id, item.record)
    }
  }
  async patch(id, properties) {
    if (Object.keys(properties).length) await this.notion.api(`pages/${id}`, 'PATCH', { properties })
  }
  noticeAllowed(snap, guard) {
    const { task, page } = snap
    if (task.state === '중지') return false
    if (guard.expectVersion && task.version !== guard.expectVersion) return false
    if (guard.locations && !guard.locations.includes(task.location)) return false
    if (guard.state && task.state !== guard.state) return false
    if (guard.runId && !this.ownsExecution(task.id, guard)) return false
    if (guard.publication) {
      const expectedBranch = guard.publication.prUrl ? guard.publication.branch : ''
      if ((page.properties[this.props.pr]?.url ?? null) !== guard.publication.prUrl || this.branchText(page) !== expectedBranch) return false
      if (guard.completedAt && !sameMinute(page.properties[this.props.completedAt]?.date?.start, guard.completedAt)) return false
    }
    return true
  }
  async noticeBodyMatches(block, lines) {
    const children = await this.notion.api(`blocks/${block.id}/children?page_size=100`)
    const visible = (children.results ?? []).filter(child => !(child.type === 'paragraph' && plain(child.paragraph?.rich_text).includes('atelier-owned:')))
    return !children.has_more && visible.length === lines.length
      && visible.every((child, i) => child.type === 'paragraph' && plain(child.paragraph.rich_text) === String(lines[i] ?? '').slice(0, 1900))
  }
  // Archives only blocks this manager recorded. A user callout with the same title is left in place.
  async notice(id, lines, guard = {}) {
    const ledger = this.ledger
    if (!ledger) throw new Error('생성 블록 원장이 없습니다.')
    const allow = async () => {
      const snap = await this.requireStable(id, guard.expectVersion)
      return this.noticeAllowed(snap, guard) ? snap : null
    }
    if (!(await allow())) return 'stale'
    const eventId = guard.eventId ?? (guard.runId && guard.cycleId ? `${guard.runId}:${guard.cycleId}:notice` : null)
    const owned = async () => (await ledger.blocksOf(this.notion, id)).filter(item => ['notice', 'intake'].includes(item.record.kind) && !String(item.record.eventId).startsWith('v1:'))
    if (lines && eventId) {
      const same = (await owned()).filter(item => item.record.eventId === eventId && item.block?.id)
      if (same.length === 1 && await this.noticeBodyMatches(same[0].block, lines)) return 'ready'
    }
    for (const item of await owned()) {
      if (!(await allow())) return 'stale'
      if (item.block?.id) await this.notion.api(`blocks/${item.block.id}`, 'PATCH', { archived: true })
      ledger.release(id, item.record)
    }
    if (!lines) return 'ready'
    if (!eventId) throw new Error('확인 필요 안내의 실행 식별이 없습니다.')
    if (!(await allow())) return 'stale'
    const record = ledger.begin(id, { kind: 'notice', runId: guard.runId ?? null, cycleId: guard.cycleId ?? null, eventId })
    const created = await this.notion.api(`blocks/${id}/children`, 'PATCH', { children: [{ object: 'block', type: 'callout', callout: {
      rich_text: [{ type: 'text', text: { content: guard.title??noticeTitle(guard.runId) } }, provenanceSpan(record.nonce)],
      icon: { type: 'emoji', emoji: guard.icon??'❓' }, children: lines.map(paragraph) } }] })
    await ledger.adoptResponse(this.notion, id, record, created)
    if (!(await allow())) return 'stale'
    const written = (await owned()).filter(item => item.record.eventId === eventId && item.block?.id)
    if (written.length !== 1 || !(await this.noticeBodyMatches(written[0].block, lines))) throw unstable()
    return 'ready'
  }
}
