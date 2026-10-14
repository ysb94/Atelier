import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardSnapshot,writeDashboard } from './status-dashboard.mjs'

const controls={ok:true,values:{enabled:true,gptModel:'gpt-6-luna',gptEffort:'medium',cursorModel:'composer-2.5'}}
const health={tool:'atelier-ai-workflow',activeCount:2,tasks:[{phase:'reviewing',branch:'a',waitingStage:null},{phase:'implementing',branch:'b',waitingStage:null}],pipeline:{planning:{running:0,waiting:0},implementation:{running:1,waiting:0},review:{running:1,waiting:1}}}
const jobs={a:{branch:'a',cycle:{settings:{gpt:{model:'gpt-6-sol',effort:'high'}}}},b:{branch:'b',cycle:{settings:{cursorModel:'grok-4.7-xhigh-fast'}}}}

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
