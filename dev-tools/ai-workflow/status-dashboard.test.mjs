import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardSnapshot,writeDashboard,cursorSlots } from './status-dashboard.mjs'

const controls={ok:true,values:{enabled:true,gptModel:'gpt-6-luna',gptEffort:'medium',cursorModel:'composer-2.5'}}
const health={tool:'atelier-ai-workflow',activeCount:2,tasks:[{phase:'reviewing',branch:'a',waitingStage:null},{phase:'implementing',branch:'b',waitingStage:null}],pipeline:{planning:{running:0,waiting:0},implementation:{running:1,waiting:0},review:{running:1,waiting:1}}}
const jobs={a:{branch:'a',cycle:{settings:{gpt:{model:'gpt-6-sol',effort:'high'}}}},b:{branch:'b',cycle:{settings:{cursorModel:'grok-4.7-xhigh-fast'}}}}

test('shared GPT workers display their current role instead of fixed planning and review columns',()=>{
  const h={...health,gptWorkers:{limit:2},tasks:[{branch:'a',task:'회의 검수',phase:'reviewing',gptStage:'review',gptSlot:1},{branch:'c',task:'일정 지시서',phase:'planning',gptStage:'planning',gptSlot:2}]}
  const view=dashboardSnapshot({health:h,controls,jobs})
  assert.match(view.rows.gpt1,/검사·검수 중.*gpt-6-sol \/ high/)
  assert.match(view.rows.gpt2,/계획 중/)
  assert.match(view.content,/GPT 1:/);assert.match(view.content,/GPT 2:/)
  assert.doesNotMatch(view.content,/GPT 계획:/);assert.doesNotMatch(view.content,/GPT 검수:/)
})

test('dashboard shows actual pinned models separately from settings and leaves an idle stage waiting',()=>{
  const view=dashboardSnapshot({health,controls,jobs})
  assert.match(view.content,/자동화 켜짐/)
  assert.match(view.rows.review,/검사·검수 중 1개.*gpt-6-sol \/ high/)
  assert.match(view.rows.review,/새 작업 설정: gpt-6-luna \/ medium/)
  assert.match(view.rows.implementation,/grok-4.7-xhigh-fast/)
  assert.match(view.rows.implementation,/새 작업 설정: composer-2.5/)
  assert.match(view.rows.planning,/대기.*gpt-6-luna/)
})

test('paused admission may still drain active work; a disconnected manager is not ON',async()=>{
  const paused=dashboardSnapshot({health,controls:{...controls,values:{...controls.values,enabled:false}},jobs})
  assert.match(paused.content,/일시정지 · 진행 중 2건 마무리/)
  assert.match(paused.rows.implementation,/실행 중/)
  const offline=dashboardSnapshot({health:null,controls,jobs})
  assert.match(offline.content,/실행기 연결 확인 필요/)
  assert.doesNotMatch(offline.content,/실행기 연결됨/)
  const writes=[]
  await writeDashboard({api:async(...args)=>writes.push(args)},{v2:{controlPageId:'settings',statusDashboard:{blockId:'display'}}},offline)
  assert.equal(writes.length,2)
  assert.equal('최근 연결' in writes[0][2].properties,false)
  assert.equal(writes[1][0],'blocks/display')
})

test('HTTP health with missing authentication shows the block reason instead of ready',()=>{
  const view=dashboardSnapshot({health:{tool:'atelier-ai-workflow',state:'설정 대기',problems:['Cursor CLI 로그인 필요']},controls})
  assert.match(view.content,/자동화 실행 차단/)
  assert.match(view.content,/멈춘 이유: Cursor CLI 로그인 필요/)
  assert.match(view.rows.implementation,/실행 차단/)
})

test('two Cursor slots show separate assignments and keep slot numbers when the task order changes',()=>{
  const h={...health,tasks:[{phase:'implementing',branch:'b',task:'첨부파일 수정',state:'구현 중'},{phase:'implementing',branch:'c',task:'일정 표시',state:'구현 중'}],pipeline:{...health.pipeline,implementation:{running:2,waiting:1}}}
  const view=dashboardSnapshot({health:h,controls,jobs,previousCursorSlots:['c','b']})
  assert.deepEqual(view.cursorSlots,['c','b'])
  assert.match(view.rows.cursor1,/업무: 일정 표시/)
  assert.match(view.rows.cursor2,/업무: 첨부파일 수정/)
  assert.match(view.rows.cursor2,/grok-4.7-xhigh-fast/)
  assert.match(view.content,/Cursor 1:/);assert.match(view.content,/Cursor 2:/)
  assert.match(view.content,/지시서 대기: 1건/)
  const one={...h,tasks:[h.tasks[0]],pipeline:{...h.pipeline,implementation:{running:1,waiting:0}}}
  assert.deepEqual(cursorSlots(one,view.cursorSlots),[null,'b'])
  const freed=dashboardSnapshot({health:one,controls,jobs,previousCursorSlots:view.cursorSlots})
  assert.match(freed.rows.cursor1,/대기.*맡은 업무 없음/)
  assert.match(freed.rows.cursor2,/첨부파일 수정/)
})

test('queued work and GPT review never appear as active Cursor workers',()=>{
  const h={...health,tasks:[{phase:'implementing',branch:'queued',waitingStage:'implementation'},{phase:'reviewing',branch:'review'}],pipeline:{...health.pipeline,implementation:{running:0,waiting:1}}}
  const view=dashboardSnapshot({health:h,controls,jobs,previousCursorSlots:['review','queued']})
  assert.deepEqual(view.cursorSlots,[null,null])
  assert.match(view.rows.cursor1,/대기.*맡은 업무 없음/)
  assert.match(view.rows.cursor2,/대기.*맡은 업무 없음/)
})
