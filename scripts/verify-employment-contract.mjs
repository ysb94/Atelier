import assert from 'node:assert/strict'
import { build } from 'esbuild'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const target = path.resolve('node_modules/.tmp/employment-contract-check.mjs')
await build({ entryPoints: ['src/features/org/employment-contract-template.ts'], bundle: true, outfile: target, platform: 'node', format: 'esm' })
const { renderEmploymentContract } = await import(pathToFileURL(target).href)
const render = (company = {}, details = {}) => renderEmploymentContract({ employeeName: '', department: '', position: '', personal: [], company, ...details })
const value = (html, key) => html.match(new RegExp(`data-field="${key}"[^>]*>([^<]*)</span>`))?.[1]
// 근로계약서(출력용): 월 420만원·유형2의 숫자/한글 금액과 병합된 구성 항목.
const wage = { wageMode: 'excel', payBasis: '월급x12개월', workDays: '주5일(월~금)', workStart: '09:00', workEnd: '18:00', breakStart: '13:00', breakEnd: '14:00', fixedOvertimePlan: '유형 2', annualSalary: '50400000', monthlyWage: '4200000', basePay: '3433278', baseHours: '209', mealAllowance: '200000', overtimeHours: '32.6', overtimeAllowance: '566722', nightHours: '0', nightAllowance: '0', holidayHours: '0', holidayAllowance: '0', annualLeaveHours: '0', annualLeaveAllowance: '0' }
const html = render(wage, { department: '디자인', position: '사원' })
for (const [key, expected] of Object.entries({ annualSalary: '금 50,400,000원', monthlyWage: '금 4,200,000원', monthlyWageWords: '[금 사백이십만원정]', baseHours: '209.00시간', overtimeHours: '32.60시간', basePay: '금 3,433,278원', mealAllowance: '금 200,000원', overtimeAllowance: '금 566,722원', nightAllowance: '해당사항 없음', weeklyHoliday: '일요일', payDay: '매월 말일', jobDescription: '디자인' })) assert.equal(value(html, key), expected, key)
assert.equal((html.match(/class="contract-clause[" ]/g) || []).length, 14)
assert.match(html, /rowspan="2" scope="rowgroup">구분/)
assert.match(html, /rowspan="2">기본급/)
assert.match(html, /1주 5시간 × \(365일\/12개월\/7일\) × 1.5배/)
assert.match(html, /당월 초일부터 당월 말일까지 정산/)
assert.equal((html.match(/class="signature-highlight"/g) || []).length, 6)
assert.doesNotMatch(html, /<img|941122|김민희|김혜정/)
// 원본 출력식의 반올림으로 주2.5시간을 3시간으로 바꾸거나 한글금액만 10원 반올림하지 않는다.
const precise = render({ ...wage, fixedOvertimePlan: '유형 2', annualSalary: '30000012', overtimeHours: '32.6', monthlyWage: '2500001' })
assert.match(precise, /1주 2.5시간/)
assert.equal(value(precise, 'monthlyWageWords'), '[금 이백오십만일원정]')
assert.equal(value(precise, 'monthlyWage'), '금 2,500,001원')
assert.equal(value(precise, 'overtimeHours'), '16.30시간')
// 반올림된 표시 월급이 같아도 계약서의 연장시간은 실제 월급 기준 유형을 따른다.
const belowBoundary=render({...wage,annualSalary:'35999999',fixedOvertimePlan:'유형 2'})
const atBoundary=render({...wage,annualSalary:'36000000',fixedOvertimePlan:'유형 1'})
assert.equal(value(belowBoundary,'monthlyWage'),'금 3,000,000원');assert.equal(value(atBoundary,'monthlyWage'),'금 3,000,000원')
assert.equal(value(belowBoundary,'overtimeHours'),'16.30시간');assert.match(belowBoundary,/1주 2.5시간/)
assert.equal(value(atBoundary,'overtimeHours'),'32.60시간');assert.match(atBoundary,/1주 5시간/)
// 자동 계산 결과를 따로 입력하지 않아도 현재 입력에서 계산하며, 오래된 금액은 사용하지 않는다.
const stale = render({ ...wage, basePay: '', overtimeAllowance: '', baseHours: '', overtimeHours: '', monthlyWage: '1' })
for (const key of ['basePay','overtimeAllowance','baseHours','overtimeHours','monthlyWage','nightAllowance']) assert.equal(value(stale,key),value(html,key))
const inferred = render({ ...wage, fixedOvertimePlan: '' })
assert.equal(value(inferred,'basePay'),value(html,'basePay'));assert.match(inferred,/1주 5시간/)
const incomplete = render({ ...wage, annualSalary: '' })
assert.equal(value(incomplete,'basePay'),'');assert.equal(value(incomplete,'overtimeAllowance'),'')
assert.equal(value(incomplete,'overtimeHours'),'');assert.equal(value(incomplete,'monthlyWage'),'')
const manual = render({ ...wage, wageMode: 'manual', payDay: '25', weeklyHoliday: '월요일', jobDescription: '디자인 관련제반 업무', nightHours: '2.2', nightAllowance: '123', holidayHours: '12', holidayAllowance: '456', annualLeaveHours: '10', annualLeaveAllowance: '789' })
assert.equal(value(manual, 'payDay'), '매월 25일'); assert.equal(value(manual, 'weeklyHoliday'), '월요일')
assert.equal(value(manual, 'jobDescription'), '디자인'); assert.equal((manual.match(/관련제반 업무/g) || []).length, 1)
assert.match(manual, /1주 1.1시간 × \(365일\/12개월\/7일\) × 0.5배/)
assert.match(manual, /1일 8시간 × 1.5배 × 12일 \/ 12개월/)
assert.match(manual, /8시간 × 15일 \/ 12개월/)
const blank = render()
for (const key of ['employeeName', 'department', 'position', 'jobDescription', 'annualSalary', 'monthlyWage', 'monthlyWageWords', 'basePay', 'mealAllowance', 'overtimeHours', 'nightAllowance', 'contractStart', 'documentDate']) assert.equal(value(blank, key), '', key)
const escaped = render({ jobDescription: '<script>alert(1)</script>' }, { employeeName: '<img src=x onerror=alert(1)>' })
assert.doesNotMatch(escaped, /<script|<img/)
assert.match(escaped, /&lt;script&gt;/)
const signed = render(wage, { employeeName: '서명검증 직원' })
for (const key of ['signature-4', 'signature-5', 'signature-7a', 'signature-7b', 'signature-8', 'signature-13', 'receipt-name']) assert.equal(value(signed, key), '', key)
assert.equal(value(signed, 'employeeName'), '서명검증 직원')
assert.equal(value(signed, 'footer-employeeName'), '서명검증 직원')
console.log('PASS contract workbook wage display, 14 clauses, merged cells, precise Korean money, 2.5h plan, manual conditions, blank values and escaped input')
