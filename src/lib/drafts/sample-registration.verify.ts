import assert from 'node:assert/strict'
import { emptyDraftInput, newColorRow } from './empty-draft'
import { attachSampleWorkOrderFile, normalizeSampleWorkOrders, sanitizeSampleWorkOrders, setLatestSampleWorkOrderShipped } from './sample-work-order'
import { receiveSample } from './sample-receipt'
import { normalizeColorSampleRounds } from './draft-flow'
import { colorSampleLabel, finalSampleLabel, registerDraftSampleStage, sampleOrderLabel, sampleRegistrationLabel } from './sample-registration'

const attached = attachSampleWorkOrderFile([], {url:'data:file,first',name:'first.xlsx'}, '2026-10-20T01:00:00Z')
const shipped = setLatestSampleWorkOrderShipped(attached, true, '2026-10-21T01:00:00Z')
const orders = receiveSample(shipped, shipped[0]!.id, '중국', '2026-10-22T01:00:00Z')
const input = {...emptyDraftInput(),originCountry:'중국',nameKo:'등록 검증',sampleWorkOrders:orders}
const file = {url:'data:file,next',name:'next.xlsx'},at='2026-10-28T01:00:00Z'
const snapshot=JSON.stringify(input)
const next=registerDraftSampleStage(input,'next',file,'한국',at)
assert.equal(next.sampleWorkOrders.length,2)
assert.deepEqual(next.sampleWorkOrders[0],input.sampleWorkOrders[0])
assert.equal(next.sampleWorkOrders[1]!.shippedAt,at)
assert.equal(next.sampleWorkOrders[1]!.originCountry,'한국')
assert.equal(next.sampleWorkOrders[1]!.returnedAt,null)
assert.equal(next.sampleWorkOrders[1]!.receivedAt??null,null)
assert.equal(sampleOrderLabel(next.sampleWorkOrders[1]!),'2차 샘플')
assert.equal(next.sampleDone,false)
assert.equal(JSON.stringify(input),snapshot,'기존 기록 불변')
assert.throws(()=>registerDraftSampleStage(next,'next',file,'중국'),/실물 수령/,'대기 중인 다음 차수를 중복 등록하지 않음')
assert.throws(()=>registerDraftSampleStage(input,'final',{url:'',name:''},'중국'),/파일/)
assert.throws(()=>registerDraftSampleStage(input,'final',file,''),/제조국/)
const final=registerDraftSampleStage(input,'final',file,'중국',at)
const restored=normalizeSampleWorkOrders(JSON.parse(JSON.stringify(sanitizeSampleWorkOrders(final.sampleWorkOrders))))
assert.equal(restored[1]!.sampleStage,'final')
assert.equal(sampleOrderLabel(restored[1]!),'최종 샘플','재조회 후에도 최종 종류 유지')
assert.equal(finalSampleLabel(1),'최최종 샘플')
assert.equal(finalSampleLabel(2),'최최최종 샘플')
assert.equal(sampleRegistrationLabel('final', 4, 1),'최최종 샘플')
assert.equal(restored[1]!.passed,false,'최종 등록이 자동 합격 처리가 되지 않음')
assert.throws(()=>registerDraftSampleStage(input,'color',file,'중국'),/컬러 구성/)
const receivedInput={...input,colors:[{...newColorRow(),name:'블랙'},{...newColorRow(),name:'아이보리'}],specs:{...input.specs,colorsConfirmed:true}}
const color=registerDraftSampleStage(receivedInput,'color',file,'한국',at)
assert.equal(color.sampleWorkOrders[0]!.passed,false,'수령 후 판정 없이 컬러 단계 진행')
assert.equal(color.sampleDone,false,'다음 단계 등록이 기존 완료값을 바꾸지 않음')
assert.equal(color.sampleWorkOrders.length,1,'컬러 지시서를 대표 차수에 섞지 않음')
assert.equal(color.specs.colorSampleRounds!.length,1)
assert.equal(color.specs.colorSampleRounds![0]!.originCountry,'한국')
assert.equal(normalizeColorSampleRounds(JSON.parse(JSON.stringify(color.specs.colorSampleRounds)))[0]!.originCountry,'한국')
assert.deepEqual(color.colors.map(c=>c.name),receivedInput.colors.map(c=>c.name))
assert.ok(color.colors.every(c=>c.sampleWorkOrderUrl===file.url))
assert.throws(()=>registerDraftSampleStage(color,'color',file,'한국'),/진행 중인 컬러샘플/)
const returned={...color,specs:{...color.specs,colorSampleRounds:color.specs.colorSampleRounds!.map(r=>({...r,returnedAt:at}))}}
const secondColor=registerDraftSampleStage(returned,'color',{url:'data:file,color2',name:'color2.xlsx'},'중국')
assert.equal(secondColor.specs.colorSampleRounds!.length,2)
assert.equal(secondColor.specs.colorSampleRounds![0]!.originCountry,'한국')
assert.equal(secondColor.specs.colorSampleRounds![1]!.originCountry,'중국')
assert.equal(sampleRegistrationLabel('color',3,1,2),'2차 컬러샘플','다음 컬러샘플은 저장된 차수에 연동')
assert.equal(colorSampleLabel(secondColor.specs.colorSampleRounds![1]!.round),'2차 컬러샘플')
assert.equal(secondColor.specs.colorSampleRounds![0]!.url,file.url,'다음 컬러 등록이 이전 파일을 덮어쓰지 않음')
const localFinal=registerDraftSampleStage(input,'final',{url:'data:file,final1',name:'final1.xlsx'},'한국',at)
const receivedFinal={...localFinal,sampleWorkOrders:receiveSample(localFinal.sampleWorkOrders,localFinal.sampleWorkOrders.at(-1)!.id,'한국')}
const finalAgain=registerDraftSampleStage(receivedFinal,'final',{url:'data:file,final2',name:'final2.xlsx'},'중국')
const reloadedFinals=normalizeSampleWorkOrders(JSON.parse(JSON.stringify(sanitizeSampleWorkOrders(finalAgain.sampleWorkOrders))))
assert.deepEqual(reloadedFinals.map(order=>sampleOrderLabel(order,reloadedFinals)),['1차 샘플','최종 샘플','최최종 샘플'])
assert.equal(reloadedFinals[1]!.url,'data:file,final1')
assert.equal(reloadedFinals[2]!.url,'data:file,final2')
const legacyInput={...receivedInput,sampleDone:true,sampleWorkOrders:orders.map(o=>({...o,receivedAt:null,passed:true,passedAt:at}))}
const legacyNext=registerDraftSampleStage(legacyInput,'next',file,'한국',at)
assert.equal(legacyNext.sampleDone,true,'과거 완료값 보존')
assert.deepEqual(legacyNext.sampleWorkOrders[0],legacyInput.sampleWorkOrders[0],'과거 기록 날짜와 판정값 보존')
assert.equal(legacyNext.sampleWorkOrders[1]!.passed,false)
assert.equal(registerDraftSampleStage(legacyInput,'color',file,'중국',at).specs.colorSampleRounds!.length,1,'과거 완료 기록도 진행 가능')
assert.throws(()=>registerDraftSampleStage({...receivedInput,sampleWorkOrders:shipped},'color',file,'중국'),/실물 수령/)
console.log('sample-registration: 차수·최종·컬러 분리, 저장·재조회, 국가·기존 기록 보존, 미수령·중복·무파일 차단 통과')
