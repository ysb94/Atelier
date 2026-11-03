import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const target=path.resolve('node_modules/.tmp/company-information-check.mjs')
await build({ entryPoints: ['src/features/org/company-information-values.ts'], bundle: true, outfile:target, platform: 'node', format: 'esm' })
const { calculateCompanyWage, calculateCompanyPeriods, contractPeriodEnd, companyRosterValues, fillCompanyInformation, splitWorkTime } = await import(pathToFileURL(target).href)
const standard = { wageMode:'excel', payBasis:'세전', workDays:'주5일(월~금)',workStart:'09:00',workEnd:'18:00',breakStart:'13:00',breakEnd:'14:00',fixedOvertimePlan:'유형 1',annualSalary:'36300000',mealAllowance:'200000' }
// 월급 300만원 기준 자동 유형은 원본의 직원별 수동 유형보다 우선한다.
const a=calculateCompanyWage(standard)
assert.equal(a.error,'');assert.equal(a.value.fixedOvertimePlan,'유형 2');assert.equal(a.value.monthlyWage,'3025000');assert.equal(a.value.basePay,'2416825');assert.equal(a.value.overtimeAllowance,'408175');assert.equal(a.value.overtimeHours,'32.6');assert.equal(a.actualOvertimeHours,'21.73')
const low=calculateCompanyWage({...standard,annualSalary:'30000000',fixedOvertimePlan:'유형 2'})
assert.equal(low.error,'');assert.equal(low.value.fixedOvertimePlan,'유형 1');assert.equal(low.value.basePay,'2119130');assert.equal(low.value.overtimeAllowance,'180870');assert.equal(low.value.overtimeHours,'16.3');assert.equal(low.actualOvertimeHours,'10.86')
// 표시 월급은 둘 다 300만원이지만 유형 판정에는 반올림 전 연봉÷12를 사용한다.
for (const [annualSalary, expectedPlan, overtimeHours, basePay, overtimeAllowance] of [
 ['35999999','유형 1','16.3','2582956','217044'],
 ['36000000','유형 2','32.6','2395199','404801'],
]) {
 const item=calculateCompanyWage({...standard,annualSalary,fixedOvertimePlan:expectedPlan==='유형 1'?'유형 2':'유형 1'})
 assert.equal(item.error,'');assert.equal(item.value.monthlyWage,'3000000');assert.equal(item.value.fixedOvertimePlan,expectedPlan);assert.equal(item.value.overtimeHours,overtimeHours);assert.equal(item.value.basePay,basePay);assert.equal(item.value.overtimeAllowance,overtimeAllowance)
 assert.equal(Number(item.value.basePay)+Number(item.value.overtimeAllowance)+200000,Number(item.value.monthlyWage))
}
const b=calculateCompanyWage({...standard,annualSalary:'50400000',fixedOvertimePlan:'유형 2',workStart:'08:30',workEnd:'17:30',breakStart:'12:30',breakEnd:'13:30'})
assert.equal(b.error,'');assert.equal(b.value.fixedOvertimePlan,'유형 2');assert.equal(b.value.basePay,'3433278');assert.equal(b.value.overtimeAllowance,'566722');assert.equal(b.value.overtimeHours,'32.6');assert.equal(b.actualOvertimeHours,'21.73')
// 실제 직원 배치 선택값은 원본 연봉 열의 ‘월급x12개월’ 설명을 사용한다.
for (const payBasis of ['월급x12개월', '월급 x 12개월', '월급×12개월', '월급X12개월']) {
 const item=calculateCompanyWage({...standard,payBasis});assert.equal(item.error,'');assert.deepEqual(item.value,{...a.value,payBasis})
}
for(const change of [{payBasis:''},{payBasis:'세후'},{annualSalary:''},{annualSalary:'0'},{annualSalary:'-1'},{annualSalary:'invalid'},{annualSalary:'36000000.5'},{annualSalary:'9007199254740992'},{mealAllowance:'999999999'},{workDays:'주3일'},{workEnd:'17:00'},{breakEnd:''},{workEnd:'26:00'},{breakStart:'13:70'},{breakStart:'20:00',breakEnd:'21:00'}]){
 const item=calculateCompanyWage({...standard,...change});assert.ok(item.error);assert.equal(item.value.monthlyWage,Object.hasOwn(change,'annualSalary')?'':'3025000');assert.equal(item.value.basePay,'')
 if(Object.hasOwn(change,'annualSalary')){assert.equal(item.value.fixedOvertimePlan,'');assert.equal(item.value.overtimeHours,'')}
}
const periods={periodMode:'auto',hireDate:'2026-10-21',documentDate:'2026-11-03',contractTerm:'fixed',contractMonths:'3',wageTerm:'fixed',wageMonths:'12',probationApply:'yes',probationMonths:'3'}
const dates=calculateCompanyPeriods(periods)
assert.equal(dates.contractStart,'2026-10-21');assert.equal(dates.contractEnd,'2027-01-20');assert.equal(dates.wageStart,'2026-11-03');assert.equal(dates.wageEnd,'2027-11-02');assert.equal(dates.probationEnd,'2027-01-20')
assert.equal(calculateCompanyPeriods({...periods,documentDate:'2026-01-01'}).wageStart,'2026-10-21')
assert.equal(calculateCompanyPeriods({...periods,hireDate:'2026-12-01'}).contractEnd,'2027-02-28')
assert.equal(calculateCompanyPeriods({...periods,contractMonths:'6'}).contractEnd,'2027-04-20')
assert.equal(contractPeriodEnd('2026-01-31','1'),'2026-02-27');assert.equal(contractPeriodEnd('2024-01-31','1'),'2024-02-28')
for(const invalid of ['','2026-02-31','2026-13-01'])assert.equal(contractPeriodEnd(invalid,'3'),'')
for(const invalid of ['','0','-3','1.5'])assert.equal(contractPeriodEnd('2026-10-21',invalid),'')
const optional=calculateCompanyPeriods({...periods,contractTerm:'indefinite',wageTerm:'until-change',probationApply:'no'})
assert.equal(optional.contractEnd,'');assert.equal(optional.wageEnd,'');assert.equal(optional.probationStart,'');assert.equal(optional.probationEnd,'')
const manual={...periods,periodMode:'manual',contractEnd:'2028-01-01'};assert.deepEqual(calculateCompanyPeriods(manual),manual)
const missing=calculateCompanyPeriods({...periods,hireDate:'',documentDate:'',contractStart:'stale',wageStart:'stale'})
assert.equal(missing.contractStart,'');assert.equal(missing.wageStart,'');assert.equal(missing.probationEnd,'')
const inferred=calculateCompanyWage({...standard,fixedOvertimePlan:'',basePay:'stale'})
assert.equal(inferred.error,'');assert.deepEqual(inferred.value,a.value)
const partial=calculateCompanyWage({...standard,annualSalary:'',fixedOvertimePlan:'유형 2',basePay:'stale',overtimeHours:'32.6'})
assert.equal(partial.value.monthlyWage,'');assert.equal(partial.value.basePay,'');assert.equal(partial.value.fixedOvertimePlan,'');assert.equal(partial.value.overtimeHours,'')
const c=calculateCompanyWage({...standard,annualSalary:'77000000',carAllowance:'200000',researchAllowance:'100000',childcareAllowance:'100000',dutyAllowance:'300000'})
assert.equal(Number(c.value.monthlyWage),Number(c.value.basePay)+Number(c.value.overtimeAllowance)+900000)
assert.deepEqual(calculateCompanyWage({...standard,wageMode:'manual',basePay:'123'}).value,{...standard,wageMode:'manual',basePay:'123'})
const mapped=companyRosterValues({annual_salary:'33,000,000원',meal_allowance:'0',work_hours:'9:00 ~ 18:00',break_time:'13:00~14:00, 1시간',resident_id:'must-not-copy'})
assert.equal(mapped.annualSalary,'33000000');assert.equal(mapped.mealAllowance,'0');assert.equal(mapped.workStart,'09:00');assert.equal(mapped.breakEnd,'14:00');assert.equal(mapped.residentId,undefined)
assert.deepEqual(splitWorkTime('야간 교대'),['','']);assert.deepEqual(splitWorkTime('25:00~26:00'),['',''])
assert.deepEqual(fillCompanyInformation({workplace:'',annualSalary:'123',mealAllowance:''},{workplace:'서버',annualSalary:'999',mealAllowance:'0'},new Set(['workplace'])),{workplace:'',annualSalary:'123',mealAllowance:'0'})
console.log('PASS salary-based wage plan boundaries before rounding, workbook wage calculation, invalid and manual preservation, EDATE/MAX dates, roster mapping and late response preservation')
