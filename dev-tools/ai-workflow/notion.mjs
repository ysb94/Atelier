import { createHash } from 'node:crypto'
import { completionReportBlock } from './report.mjs'
import { NeedsInput } from './acp.mjs'
import { GeneratedBlockLedger, nonceInBlock, provenanceSpan, stampCallout } from './generated-blocks.mjs'
import { EnvironmentError } from './errors.mjs'

const plain = items => (items ?? []).map(v => v.plain_text ?? v.text?.content ?? '').join('')
export function taskFromPage(page, props) {
  const p = page.properties
  const text = key => plain(p[props[key]]?.rich_text)
  const task = { id: page.id, url: page.url, title: plain(p[props.title]?.title), enabled: p[props.enabled]?.checkbox === true,
    state: p[props.state]?.select?.name, category: p[props.category]?.select?.name, request: text('request'), criteria: text('criteria'), files: text('files'), order: p[props.order]?.number ?? 999999 }
  task.version = createHash('sha256').update(JSON.stringify([task.title, task.request, task.criteria, task.files])).digest('hex')
  return task
}

export function memoTaskFromPage(page, config, body = '') {
  const p = page.properties, props = config.properties
  const text = key => plain(p[props[key]]?.rich_text)
  const location = p[props.location]?.select?.name
  const source = { title: plain(p[props.title]?.title), body,
    screen: p[props.screen]?.select?.name ?? '', area: p[props.area]?.select?.name ?? '', answer: text('answer') }
  const task = { id: page.id, url: page.url, title: source.title, source, location,
    enabled: [config.positions.queued, config.positions.working].includes(location),
    state: p[props.state]?.select?.name ?? '대기', request: text('request'), criteria: text('criteria'), files: text('files'),
    order: p[props.order]?.number ?? 999999, createdAt: page.created_time,
    previousResult: text('result'), previousQuestion: text('question') }
  // Reports, planner outputs and status changes must not create another job.
  task.version = createHash('sha256').update(JSON.stringify(source)).digest('hex')
  task.planVersion = createHash('sha256').update(JSON.stringify([task.request, task.criteria, task.files])).digest('hex')
  return task
}

export function completionDay(instant) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant))
}

function sameCompletionMinute(stored, actual) {
  // Notion date properties normalize seconds to the minute; the report keeps
  // the original precise completion instant from the durable local journal.
  const a=Date.parse(stored),b=Date.parse(actual)
  return Number.isFinite(a)&&Number.isFinite(b)&&Math.floor(a/60000)===Math.floor(b/60000)
}

export class Notion {
  constructor(config, fetcher = fetch) {
    this.config = config
    this.fetch = fetcher
    this.blockLedger = new GeneratedBlockLedger()
  }
  async isGeneratedBlock(pageId, block) {
    const ledger = this.blockLedger
    if (!ledger || !block) return false
    if (block.id && ledger.hasId(pageId, block.id)) return true
    const nonce = nonceInBlock(block)
    if (nonce && ledger.hasNonce(pageId, nonce)) {
      if (block.id) ledger.adoptNonce(pageId, nonce, block.id)
      return true
    }
    if (ledger.hasPending(pageId) && block.has_children && (block.type === 'callout' || block.type === 'toggle'))
      return ledger.claimPendingChild(this, pageId, block)
    return false
  }
  async api(endpoint, method = 'GET', body) {
    // Queries and property replacement are idempotent. Block append/creation
    // retains its journal-based recovery rather than risking duplicate writes.
    const safeRetry=method==='GET'||method==='PATCH'&&!endpoint.endsWith('/children')||method==='POST'&&endpoint.endsWith('/query')
    for(let attempt=0;attempt<3;attempt++){
      if((this.config.maxParallelTasks??1)>1){
        const at=Math.max(Date.now(),this.nextApiAt??0);this.nextApiAt=at+350
        if(at>Date.now())await this.apiDelay(at-Date.now())
      }
      let response,data
      try {
        response=await this.fetch(`https://api.notion.com/v1/${endpoint}`,{
          method,headers:{Authorization:`Bearer ${this.config.env.NOTION_TOKEN}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},
          body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)
        })
        try{data=await response.json()}catch{data={code:'invalid_response'}}
      }catch(error){
        if(!safeRetry||attempt===2)throw error
        console.warn('[ai-workflow] Notion 연결 재시도',{method,attempt:attempt+1})
        await this.apiDelay(1000*2**attempt);continue
      }
      if(response.ok)return data
      if([401,403].includes(response.status)) {
        const error=new EnvironmentError(`Notion ${response.status}: 인증·접근 권한을 확인할 수 없어 모델 작업을 중단합니다. 실행기 연결을 복구한 뒤 기존 기록으로 재개합니다.`,{retry:false,code:'notion_auth'})
        // Keep only an allowlisted diagnosis, never the upstream body, headers,
        // credentials or arbitrary message. Persisted locally for operator repair.
        error.notionAuth={status:response.status,apiCode:['unauthorized','restricted_resource'].includes(data.code)?data.code:'unknown',
          invalidToken:data.code==='unauthorized'&&/token.{0,20}invalid|invalid.{0,20}token/i.test(String(data.message??'')),method,endpoint:endpoint.split('?')[0]}
        this.onAuthFailure?.(error)
        throw error
      }
      const retry=response.status===429||safeRetry&&[502,503,504].includes(response.status)
      if(retry&&attempt<2){
        const after=Number(response.headers?.get?.('Retry-After'))
        console.warn('[ai-workflow] Notion 일시 오류 재시도',{method,status:response.status,attempt:attempt+1})
        await this.apiDelay(Math.min(10000,Math.max(1000*2**attempt,Number.isFinite(after)?after*1000:0)));continue
      }
      throw new Error(`Notion ${response.status}: ${data.code??'API 오류'}`)
    }
  }
  apiDelay(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
  async ready() {
    const schema = await this.api(`data_sources/${this.config.dataSourceId}`)
    for (const name of Object.values(this.config.properties).filter(Boolean)) if (!schema.properties[name]) throw new Error(`노션 속성이 없습니다: ${name}`)
    return true
  }
  async queue() {
    const p = this.config.properties
    if (this.config.mode === 'memo-board') {
      const result = [], body = { filter: { property: p.location, select: { equals: this.config.positions.queued } },
        sorts: [{ property: p.order, direction: 'ascending' }, { timestamp: 'created_time', direction: 'ascending' }], page_size: 100 }
      let cursor
      do {
        const data = await this.api(`data_sources/${this.config.dataSourceId}/query`, 'POST', { ...body, ...(cursor ? { start_cursor: cursor } : {}) })
        for (const page of data.results) result.push(memoTaskFromPage(page, this.config, await this.memoBody(page.id)))
        cursor = data.has_more ? data.next_cursor : undefined
      } while (cursor)
      return result
    }
    const body = { filter: { and: [{ property: p.enabled, checkbox: { equals: true } }, { property: p.state, select: { equals: '대기' } }] },
      sorts: [{ property: p.order, direction: 'ascending' }], page_size: 100 }
    const result = await this.api(`data_sources/${this.config.dataSourceId}/query`, 'POST', body)
    return result.results.map(page => taskFromPage(page, p))
  }
  async memoBody(id, depth = 0, rootId = id) {
    if (depth > 5) throw new Error('메모의 중첩이 너무 깊어 읽을 수 없습니다.')
    const parts = []; let cursor
    do {
      const data = await this.api(`blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`)
      for (const block of data.results) {
        const text = plain(block[block.type]?.rich_text)
        // Owned generated blocks stay out of the source. Title and block type do not decide ownership.
        if (await this.isGeneratedBlock(rootId, block)) continue
        if (text) parts.push(text)
        const detail=structuredClone(block[block.type]??{})
        delete detail.rich_text
        const references=(block[block.type]?.rich_text??[]).flatMap(item=>item.text?.link?[item.text.link]:item.mention?[item.mention]:item.equation?[item.equation]:[])
        if(references.length)detail.references=references
        // Signed file URLs expire on reads. The stable path identifies the file.
        if(detail.file){delete detail.file.expiry_time;if(detail.file.url)detail.file.url=detail.file.url.split('?')[0]}
        if(Object.keys(detail).length)parts.push(JSON.stringify({type:block.type,...detail}))
        if (block.has_children && !['child_page', 'child_database'].includes(block.type)) parts.push(await this.memoBody(block.id, depth + 1, rootId))
      }
      cursor = data.has_more ? data.next_cursor : undefined
      if (parts.join('\n').length > 16000) throw new Error('메모가 너무 큽니다. 관련 내용만 한 카드에 묶어 주세요.')
    } while (cursor)
    return parts.filter(Boolean).join('\n')
  }
  async task(id) {
    if(this.config.mode!=='memo-board')return taskFromPage(await this.api(`pages/${id}`),this.config.properties)
    const snapshot=await this.memoSnapshot(id,true)
    if(snapshot.unstable)throw new NeedsInput('메모를 읽는 동안 내용이나 설정이 변경되었습니다.')
    return snapshot.task
  }
  async memoSnapshot(id, withBody, retry=0) {
    const first=await this.api(`pages/${id}`),edited=first.last_edited_time
    if(!withBody&&first.properties[this.config.properties.state]?.select?.name==='중지')return{page:first,task:memoTaskFromPage(first,this.config),unstable:false}
    const body=withBody?await this.memoBody(id):''
    // Properties read before block traversal can be stale after slow API reads.
    const page=withBody?await this.api(`pages/${id}`):first
    if(withBody&&edited&&page.last_edited_time&&edited!==page.last_edited_time&&retry<2)return this.memoSnapshot(id,withBody,retry+1)
    return{page,task:memoTaskFromPage(page,this.config,body),unstable:!!(edited&&page.last_edited_time&&edited!==page.last_edited_time)}
  }
  async savePlan(id, plan, expected) {
    const current=await this.task(id)
    if(expected&&(!current.enabled||current.state==='중지'||current.version!==expected.version||current.planVersion!==expected.planVersion))throw new NeedsInput('구조 조사 중 사용자가 메모나 실행 설정을 변경했습니다. 준비된 계획으로 덮어쓰지 않습니다.')
    const p = this.config.properties, rich = content => ({ rich_text: [{ type: 'text', text: { content } }] })
    await this.api(`pages/${id}`, 'PATCH', { properties: { [p.request]: rich(plan.request), [p.criteria]: rich(plan.criteria), [p.files]: rich(plan.files.join('\n')) } })
  }
  async syncMemoNotice(id, update) {
    const stopped=['확인 필요','오류','중지'].includes(update.state)
    if(!stopped&&!['대기','구조 확인','작업 중','완료'].includes(update.state))return
    const snapshot=await this.memoSnapshot(id,!!update.expectedVersion),p=this.config.properties
    if(snapshot.unstable||snapshot.page.properties[p.state]?.select?.name!==update.state)return
    if(update.expectedVersion&&snapshot.task.version!==update.expectedVersion)return
    const expectedLocation=stopped?this.config.positions.needsInput:update.state==='완료'?this.config.positions.done
      :update.state==='작업 중'?this.config.positions.working:this.config.positions.queued
    if(snapshot.task.location!==expectedLocation)return
    const eventId = `v1:${update.state}:${update.summary ?? ''}:${update.question ?? ''}`
    const lines=[update.summary||'자동화가 중단되었습니다.',update.question||'현재 작업 결과를 확인해 주세요.'].map(line=>line.slice(0,1900))
    const owned = (await this.blockLedger.blocksOf(this, id, 'notice')).filter(item => String(item.record.eventId).startsWith('v1:'))
    if (stopped && owned.length === 1 && owned[0].record.eventId === eventId) {
      const children = await this.api(`blocks/${owned[0].block.id}/children?page_size=100`)
      if (!children.has_more && children.results.length === lines.length
        && children.results.every((block, i) => block.type === 'paragraph' && plain(block.paragraph.rich_text) === lines[i])) return
    }
    for (const item of owned) {
      if (!item.block?.id) continue
      await this.api(`blocks/${item.block.id}`, 'PATCH', { archived: true })
      this.blockLedger.release(id, item.record)
    }
    if (!stopped) return
    const record = this.blockLedger.begin(id, { kind: 'notice', eventId, runId: update.runId ?? null, cycleId: update.cycleId ?? null })
    const created = await this.api(`blocks/${id}/children`, 'PATCH', { children: [{
      object: 'block', type: 'callout', callout: {
        rich_text: [{ type: 'text', text: { content: 'Atelier AI 확인 필요 안내' } }, provenanceSpan(record.nonce)],
        icon: { type: 'emoji', emoji: '❓' },
        children: lines.map(content => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } })),
      },
    }] })
    await this.blockLedger.adoptResponse(this, id, record, created)
  }
  async publish(id, update) {
    const p = this.config.properties, properties = {}
    const reportBlock = this.config.mode==='memo-board'&&update.state==='완료'
      ? completionReportBlock({source:update.source},update.report,update.completedAt) : null
    if (update.state) properties[p.state] = { select: { name: update.state } }
    if (update.progress && p.progress) properties[p.progress] = { select: { name: update.progress } }
    if (update.attempt !== undefined) properties[p.attempt] = { number: update.attempt }
    if (update.completedAt !== undefined && p.completedAt) properties[p.completedAt] = { date: update.completedAt ? { start: update.completedAt } : null }
    if (update.completedAt && p.completedDay) properties[p.completedDay] = { date: { start: completionDay(update.completedAt) } }
    if (update.question !== undefined && p.question) properties[p.question] = { rich_text: update.question ? [{ type: 'text', text: { content: update.question.slice(0,1900) } }] : [] }
    if (this.config.mode === 'memo-board' && update.state) {
      const progressing=['구조 확인','작업 중','검토 중','수정 중'].includes(update.state)
      const cancelled=()=>{throw Object.assign(new NeedsInput('사용자가 자동 실행을 중지했습니다.'),{stopped:true,discardUpdate:true})}
      // Check the latest properties AFTER reading the original memo blocks.
      const snapshot=await this.memoSnapshot(id,!!update.expectedVersion),page=snapshot.page,current=page.properties[p.location]?.select?.name
      if(page.properties[p.state]?.select?.name==='중지'){if(progressing)cancelled();return}
      if(current===this.config.positions.queued&&page.properties[p.state]?.select?.name===update.state
        &&(['확인 필요','오류'].includes(update.state)||update.state==='완료'&&sameCompletionMinute(page.properties[p.completedAt]?.date?.start,update.completedAt))) {
        // This terminal result is already visible and the user requeued it.
        // A response-lost retry must not undo that new selection.
        return
      }
      const sameTerminalStored=['확인 필요','오류'].includes(update.state)&&current===this.config.positions.needsInput
        &&page.properties[p.state]?.select?.name===update.state&&update.summary!==undefined
        &&plain(page.properties[p.result]?.rich_text)===update.summary.slice(0,1900)
        &&(update.question===undefined||plain(page.properties[p.question]?.rich_text)===(update.question||'').slice(0,1900))
      if(![this.config.positions.queued,this.config.positions.working].includes(current)&&update.state!=='완료'&&!sameTerminalStored){if(progressing)cancelled();return}
      if(snapshot.unstable&&!['확인 필요','오류','중지'].includes(update.state))throw new Error('노션 조회 중 변경을 감지했습니다. 최신 상태로 기록을 재시도합니다.')
      if(update.expectedVersion||update.expectedPlanVersion) {
        const actual=snapshot.task
        const changed=(update.expectedVersion&&actual.version!==update.expectedVersion)||(update.expectedPlanVersion&&actual.planVersion!==update.expectedPlanVersion)
        if(changed&&!['확인 필요','오류','중지'].includes(update.state)) return
      }
      if ([this.config.positions.queued, this.config.positions.working].includes(current)) {
        const position = update.state === '완료' ? this.config.positions.done
          : ['확인 필요', '오류', '중지'].includes(update.state) ? this.config.positions.needsInput
          : ['대기', '구조 확인'].includes(update.state) ? this.config.positions.queued
          : ['작업 중', '검토 중', '수정 중'].includes(update.state) ? this.config.positions.working : null
        if (position) properties[p.location] = { select: { name: position } }
      } else if (update.state === '완료' && (current!==this.config.positions.done||!sameCompletionMinute(page.properties[p.completedAt]?.date?.start,update.completedAt))) {
        // A delayed completion write must not replace a manual cancellation.
        return
      }
    }
    if (update.summary !== undefined&&(this.config.mode!=='memo-board'||['완료','확인 필요','오류','중지'].includes(update.state))) properties[p.result] = { rich_text: [{ type: 'text', text: { content: update.summary.slice(0,1900) } }] }
    if (Object.keys(properties).length) await this.api(`pages/${id}`, 'PATCH', { properties })
    if(this.config.mode==='memo-board') {
      await this.syncMemoNotice(id,update)
      // Prompt, feedback, logs and reviewer JSON stay in the local run journal.
      if(!reportBlock)return
      const eventId = update.eventId ?? `v1-report:${update.completedAt ?? ''}:${update.expectedVersion ?? ''}`
      const owned = (await this.blockLedger.blocksOf(this, id, 'report')).some(item => item.record.eventId === eventId)
      if(!owned){
        // Completion properties and the report are separate Notion writes.
        const final=await this.memoSnapshot(id,!!update.expectedVersion),actual=final.task
        if(final.unstable)throw new Error('완료 보고서 저장 전 노션 변경을 감지했습니다. 최신 상태로 재시도합니다.')
        if(actual.location!==this.config.positions.done||actual.state==='중지'
          ||!sameCompletionMinute(final.page.properties[p.completedAt]?.date?.start,update.completedAt)
          ||update.expectedVersion&&actual.version!==update.expectedVersion
          ||update.expectedPlanVersion&&actual.planVersion!==update.expectedPlanVersion)return
        const record = this.blockLedger.begin(id, { kind: 'report', eventId, runId: update.runId ?? null, cycleId: update.cycleId ?? null })
        stampCallout(reportBlock, record.nonce)
        const created = await this.api(`blocks/${id}/children`,'PATCH',{children:[reportBlock]})
        await this.blockLedger.adoptResponse(this, id, record, created)
      }
      return
    }
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
        const children = lines.map(content => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }))
        await this.api(`blocks/${id}/children`, 'PATCH', { children: this.config.mode === 'memo-board'
          ? [{ object: 'block', type: 'toggle', toggle: { rich_text: [{ type: 'text', text: { content: marker } }], children } }] : children })
      }
    }
  }
}
