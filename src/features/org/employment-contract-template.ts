import type { CompanyInformation } from './NewEmployeeCompanyInformation'
import type { DocumentPreviewData } from './new-employee-document-templates'
import { WAGE_PLANS, calculateCompanyWage } from './company-information-values'

// 제공된 근로계약서(출력용) A1:K114, 54행의 페이지 나눔을 기준으로 한다.
// 직원 예시값·스크린샷은 포함하지 않고 현재 입력값만 문서에 반영한다.
const escapeHtml = (value = '') => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const amount = (value = '') => value.trim() && Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR') : ''
const won = (value = '') => amount(value) ? `금 ${amount(value)}원` : ''
const shortWon = (value = '') => !amount(value) ? '' : Number(value) > 0 && Number(value) % 10000 === 0 ? `${amount(String(Number(value) / 10000))}만원` : `${amount(value)}원`
// 원본 F66의 10원 반올림은 숫자 합계와 달라질 수 있어, 같은 원 단위 금액을 한글로 쓴다.
function koreanWon(value: string) {
  const number = Number(value)
  if (!value.trim() || !Number.isSafeInteger(number) || number < 0) return ''
  if (number === 0) return '영'
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], units = ['', '십', '백', '천'], groups = ['', '만', '억', '조']
  let remaining = number, index = 0, result = ''
  while (remaining > 0) {
    const group = remaining % 10000
    let part = ''
    for (let place = 3; place >= 0; place -= 1) {
      const digit = Math.floor(group / 10 ** place) % 10
      if (digit) part += (digit === 1 && place > 0 ? '' : digits[digit]) + units[place]
    }
    if (part) result = part + groups[index] + result
    remaining = Math.floor(remaining / 10000); index += 1
  }
  return result
}
const longDate = (value = '') => /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(0,4)}년 ${value.slice(5,7)}월 ${value.slice(8,10)}일` : ''
const field = (key: string, value = '', className = '') => `<span data-field="${key}" class="contract-value ${className}">${escapeHtml(value)}</span>`
const clause = (heading: string, body: string, inline = false) => `<section class="contract-clause${inline ? ' contract-clause-inline' : ''}"><h2>${heading}</h2>${body}</section>`
const paragraph = (content: string) => `<p>${content}</p>`

export function renderEmploymentContract(data: DocumentPreviewData) {
  // 저장 당시의 계산 결과가 비어 있거나 오래됐어도 현재 입력으로 다시 계산한다.
  // 직접 입력 모드는 계산 함수가 그대로 보존한다.
  const c = data.company ? calculateCompanyWage(data.company).value : undefined
  const v = (key: keyof CompanyInformation) => c?.[key] ?? ''
  const f = (key: keyof CompanyInformation, className = '') => field(key, v(key), className)
  const p = (label: string) => data.personal.find(([name]) => name === label)?.[1] ?? ''
  const signature = (key: string) => `<div class="contract-signature"><span class="signature-highlight">서 명 <span data-signature>${field(key)}</span> <span class="sign-space"></span>(인)</span></div>`
  const probation = v('probationApply')
  const probationSelection = probation === 'yes' ? '■ 적용 / □ 미적용' : probation === 'no' ? '□ 적용 / ■ 미적용' : '□ 적용 / □ 미적용'
  const timeRange = (start: string, end: string) => start || end ? `${start} ~ ${end}` : ''
  const workTime = v('workHours') || timeRange(v('workStart'), v('workEnd'))
  const breakTime = v('breakTime') || timeRange(v('breakStart'), v('breakEnd'))
  const plan = WAGE_PLANS.find(item => item.value.replace(/\s/g,'') === v('fixedOvertimePlan').replace(/\s/g,''))
  const overtimeCalculation = !v('overtimeHours') ? '' : Number(v('overtimeHours')) === 0 ? '-' : v('wageMode') === 'excel' && plan ? `1주 ${plan.weeklyHours}시간 × (365일/12개월/7일) × 1.5배` : `월 ${v('overtimeHours')}시간 (1.5배 가산 산정시간)`
  const timeCell = (key: keyof CompanyInformation) => field(key, v(key) === '' || !Number.isFinite(Number(v(key))) ? '' : Number(v(key)) === 0 ? '해당사항 없음' : `${Number(v(key)).toFixed(2)}시간`)
  const moneyCell = (key: keyof CompanyInformation, zeroIsAbsent = false, className = '') => field(key, v(key) !== '' && Number(v(key)) === 0 && zeroIsAbsent ? '해당사항 없음' : won(v(key)), className)
  const wageRow = (label: string, calculation: string, hours: keyof CompanyInformation | null, money: keyof CompanyInformation) => `<tr><th>${label}</th><td colspan="3">${calculation}</td><td>${hours ? timeCell(hours) : ''}</td><td class="money">${moneyCell(money, true)}</td></tr>`
  const allowanceCalculation = (key: 'nightHours' | 'holidayHours' | 'annualLeaveHours') => {
    if (!v(key) || !Number.isFinite(Number(v(key)))) return ''
    const hours = Number(v(key))
    if (!hours) return '-'
    const up = (number: number) => Math.ceil((number - 1e-10) * 10) / 10
    if (key === 'nightHours') return `1주 ${up(hours / 0.5 / (365 / 12 / 7))}시간 × (365일/12개월/7일) × 0.5배`
    if (key === 'holidayHours') return `1일 8시간 × 1.5배 × ${up(hours / 1.5 / 8 * 12)}일 / 12개월`
    return `8시간 × ${up(hours / 8 * 12)}일 / 12개월`
  }
  const description = v('jobDescription').trim() || data.department
  const jobDescription = description.replace(/\s*관련\s*제반\s*업무\s*$/, '').trim()
  const payDay = v('payDay') || '말일'
  const weeklyHoliday = v('weeklyHoliday') || '일요일'
  const monthlyWords = koreanWon(v('monthlyWage'))
  const extraAllowances = ([['carAllowance','자가운전보조비'],['researchAllowance','연구개발비'],['childcareAllowance','육아수당'],['dutyAllowance','직책수당']] as const)
    .filter(([key]) => v(key) && Number(v(key)) !== 0)
    .map(([key,label]) => wageRow(label, '', null, key)).join('')
  const first = `<article class="sheet employment-contract">
    <h1>${probation === 'no' ? '연 봉 근 로 계 약 서' : '수 습 근 로 계 약 서'}</h1>
    <table class="contract-identity"><colgroup><col style="width:4%"><col style="width:19%"><col style="width:32%"><col style="width:16%"><col style="width:29%"></colgroup><tbody>
      <tr><th rowspan="2" class="vertical-label">사용자</th><th>사업체명</th><td>${f('employerName')}</td><th>대표자</th><td>${f('representative')}</td></tr>
      <tr><th>소재지</th><td colspan="3" class="address">${f('employerAddress')}</td></tr>
      <tr><th rowspan="2" class="vertical-label">근로자</th><th>성명</th><td>${field('employeeName', data.employeeName)}</td><th>생년월일</th><td>${field('birthDate', p('생년월일'))}</td></tr>
      <tr><th>주소</th><td class="address">${field('address', p('현 거주지'))}</td><th>소속 부서</th><td>${field('department', data.department)}</td></tr>
    </tbody></table>
    <p class="contract-intro">${field('intro-employerName',v('employerName'),'contract-emphasis')}(이하 “사용자”라 함)와 ${field('intro-employeeName',data.employeeName,'contract-emphasis')}(이하 “근로자”라 함)은<br>다음과 같이 연봉근로계약을 체결하고 이를 성실히 이행하기로 약정한다.</p>
    ${clause('제 1조 [근로계약기간]', paragraph(`근로계약기간은 ${f('contractStart','date-value')}부터 ${field('contractEnd',v('contractTerm') === 'indefinite' ? '기간의 정함이 없는 것' : v('contractEnd'),'date-value')}으로 한다.`))}
    ${clause('제 2조 [연봉계약기간]', paragraph(`연봉계약기간은 ${f('wageStart','date-value')}부터 ${field('wageEnd',v('wageTerm') === 'until-change' ? '변경 시' : v('wageEnd'),'date-value')}까지로 하며, 동 연봉계약기간에도 불구하고 본 계약은 사용자와 근로자 사이의 근로계약이 존속하는 동안 유효한 것으로, 근로계약 종료 시 본 계약도 당연히 소멸된다.`))}
    ${clause('제 3조 [수습기간]', paragraph(`<span class="probation-highlight"><span data-field="probation-selection">(${probationSelection})</span> ${probation === 'no' ? '' : `${f('probationStart','date-value')}(입사일)부터 ${f('probationEnd','date-value')}까지`}</span>`)
      + paragraph(`<span data-field="probation-description">${probation === 'no' ? '① 수습기간 미적용' : `① 신규입사자의 <strong class="contract-emphasis">입사일로부터 ${f('probationMonths')}개월이 되기 전날까지</strong>의 기간을 수습기간으로 한다.`}</span>`)
      + paragraph(`<span class="probation-pay">② 수습기간의 임금은 제8조에도 불구하고, 제8조에서 정한 임금의 ${f('probationPayRate')}%로 한다. 단, 최저임금법에서 정한 최저임금의 90%에 미달될 수 없으며, 미달되는 경우 최저임금의 90%를 수습기간 동안의 임금으로 한다.</span>`)
      + paragraph('③ 사용자는 수습기간 중 근로자의 적성·자질·능력·적응도 등을 종합하여 직원으로서의 적부여부를 판단하여 부적격자에 대하여는 수습기간을 연장하거나 제1조에도 불구하고 본채용을 거부할 수 있다.'))}
    ${clause('제 4조 [근무장소 및 업무내용]', paragraph(`① 근무장소 : ${f('workplace')}`)
      + paragraph(`② 업무내용 / 직책 : <span class="job-highlight">${field('jobDescription',jobDescription,'contract-emphasis')} 관련제반 업무/ ${field('position',data.position)}</span>`)
      + paragraph('③ 근무장소와 업무내용·직책은 업무상 필요에 의하여 변경될 수 있으며 근로자는 이에 동의한다.') + signature('signature-4'))}
    ${clause('제 5조 [근로시간]', paragraph('① 근로일, 근로시간 및 휴게시간은 다음과 같다.')
      + `<table class="contract-hours"><tbody><tr><th rowspan="2" scope="rowgroup">구분</th><th scope="col">근로일</th><th scope="col">근로시간</th><th scope="col">휴게시간</th></tr><tr><td>${f('workDays')}</td><td>${field('workTime',workTime)}</td><td>${field('breakTime',breakTime)}</td></tr></tbody></table>`
      + paragraph('② 전 항의 근로시간 중에 휴게시간을 제외하고 <strong class="contract-blue contract-emphasis">1일 8시간, 1주 40시간</strong>을 기본(소정근로시간)으로 하며, 이를 초과하는 시간은 연장근로로 본다.')
      + paragraph('③ 근로자는 제1항의 근로일, 근로시간 및 휴게시간은 업무상 필요에 따라 변경될 수 있음과 그에 따라 발생하는 연장·야간·휴일근로에 동의한다.') + signature('signature-5')
      + paragraph('④ 상기 근로시간 이외에 추가적인 연장근로를 하기 위해서는 회사의 허락을 득해야만 하며, 회사의 허락 없이 개인적으로 초과근로한 경우 연장근로로 인정하지 아니한다.'))}
    ${clause('제 6조 [유급휴일]', paragraph(`① 주휴일은 ${field('weeklyHoliday',weeklyHoliday,'contract-emphasis')}로 하며, 1주간 소정근로일을 개근한 경우에 유급휴일로 한다. 주휴일은 업무사정에 따라 근로자의 동의로 사전에 다른 요일로 대체될 수 있다. <strong class="contract-emphasis">토요일은 무급휴무일로 한다.</strong>`)
      + paragraph('② 노동절(5월 1일)은 유급휴일로 한다.')
      + paragraph('③ 「관공서의 공휴일에 관한 규정」 제2조 각 호(제1호는 제외한다)에 따른 공휴일 및 같은 영 제3조에 따른 대체공휴일은 유급휴일로 하며, 근로자대표와의 서면합의에 따라 다른 근로일로 대체될 수 있다.'))}
    ${clause('제 7조 [연봉제 및 조정]', paragraph('① 사용자는 성과와 역량에 따라 차별적인 연봉제(전년대비 급여의 수준이 변경되는 성과주의 임금제도)를 운영하고 있으며, 근로자는 그 취지를 이해하고 동의한다.') + signature('signature-7a')
      + paragraph('② 사용자는 매년 근로자의 성과와 역량을 평가하고 이를 근거로 연봉을 재산정하며, 근로자는 이 과정에서 성과부진 또는 능력부족을 사유로 연봉이 삭감될 수도 있음을 명확히 이해하고 동의한다.') + signature('signature-7b'))}
    <footer class="contract-page-number">1 / 2</footer>
  </article>`
  const second = `<article class="sheet employment-contract">
    ${clause('제 8조 [연봉]', paragraph(`① 연봉은 ${moneyCell('annualSalary',false,'salary-highlight contract-blue contract-emphasis')}으로 하며,<br>월 임금은 연봉의 12분의 1을 매월 지급하되 구성내역은 다음과 같다.`)
      + paragraph('(적용기간 도중에 약정임금이 변경되는 경우 항목별 임금은 급여대장 및 급여명세서로 갈음한다.)')
      + `<table class="contract-wage"><colgroup><col style="width:22%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:17%"><col style="width:19%"></colgroup><thead><tr><th>구분</th><th colspan="3">산정내역</th><th>시간</th><th>금액</th></tr></thead><tbody>
        <tr><th rowspan="2">기본급${v('mealAllowance') ? `<br>(식대 ${field('meal-label',shortWon(v('mealAllowance')))} 포함)` : ''}</th><td colspan="3">${v('baseHours') ? Number(v('baseHours')) > 208 ? '(1주 40시간 + 주휴 8시간) × (365일/12개월/7일)' : '등록된 기본급 산정시간 기준' : ''}</td><td rowspan="2">${timeCell('baseHours')}</td><td class="money">${moneyCell('basePay',true)}</td></tr>
        <tr><td colspan="3">식대 ${field('meal-calculation',shortWon(v('mealAllowance')))} (비과세 항목)</td><td class="money">${moneyCell('mealAllowance',true)}</td></tr>${extraAllowances}
        ${wageRow('연장근로수당',`<span data-field="overtime-calculation">${escapeHtml(overtimeCalculation)}</span>`,'overtimeHours','overtimeAllowance')}
        ${wageRow('야간근로수당',allowanceCalculation('nightHours'), 'nightHours','nightAllowance')}${wageRow('휴일근로수당',allowanceCalculation('holidayHours'),'holidayHours','holidayAllowance')}${wageRow('연차미사용수당',allowanceCalculation('annualLeaveHours'),'annualLeaveHours','annualLeaveAllowance')}
        <tr class="total"><th colspan="2">총 합계 (월 임금)</th><td colspan="2">${field('monthlyWageWords',monthlyWords ? `[금 ${monthlyWords}원정]` : '')}</td><td colspan="2" class="money">${moneyCell('monthlyWage')}</td></tr>
      </tbody></table>`
      + paragraph('② 월 임금은 계산의 편의와 근로의욕 고취차원에서 연장근로수당 등 법정수당이 포함된 포괄산정임금형태로 구성하며, 근로자는 이에 동의한다.') + signature('signature-8')
      + paragraph(`③ 월 임금은 <span class="contract-blue">${field('payDay',`매월 ${payDay === '말일' ? '말일' : payDay.replace(/일$/, '') + '일'}`,'contract-emphasis')}(당월 초일부터 당월 말일까지 정산)</span>에 제세금 등을 제외하고 근로자가 지정한 금융계좌로 지급한다. 단, 근로자가 지각, 조퇴, 외출 및 결근하는 경우에는 해당시간에 대한 금액을 공제하고 월 중도 입, 퇴사 및 결근 시 근로일수에 비례하여 일할계산 후 지급한다.`))}
    ${clause('제 9조 [연차유급휴가]',paragraph('연차유급휴가는 근로기준법과 취업규칙이 정하는 바에 따른다.'),true)}
    ${clause('제 10조 [퇴직급여 및 퇴직절차]',paragraph('① 퇴직급여는 근로자퇴직급여보장법에 따른 퇴직금 또는 퇴직연금으로 지급한다. 단, 근속연수 1년 미만 또는 1주 15시간 미만 근로하는 경우에는 지급하지 아니한다.')
      + paragraph('② 근로자는 퇴직하고자 할 경우에는 퇴직일로부터 30일전에 퇴직원을 제출하고, 후임자를 선임하여 업무 인수인계를 완료할 때까지 성실하게 근무하여야 한다.'))}
    ${clause('제 11조 [근로계약의 해지사유]',paragraph('① 정당한 사유 없이 무단결근하였을 때') + paragraph('② 업무태만, 업무수행능력 부족 또는 건강상의 장애로 업무수행이 어려울 때')
      + paragraph('③ 회사의 명예를 손상시켰거나 고의 또는 중과실로 회사에 손해를 입혔을 때') + paragraph('④ 취업규칙 기타 사회통념상 더 이상 근로관계를 유지하기 어렵다고 판단될 때'))}
    ${clause('제 12조 [지적자산 및 제반 작업물 일체의 소유, 기밀유지(비밀보호) 및 손해배상]',paragraph('① 근로자는 업무를 수행함에 있어 지적자산 및 제반 작업물 일체에 관한 권리는 회사에 귀속된다는 점에 동의한다.')
      + paragraph('② 근로자는 계약서에 명시된 연봉 및 월 임금에 대하여 상호간에 비교·공개하거나 타인에게 누설하여서는 아니 되며, 이를 위반한 경우 이로 인한 모든 불이익(감봉 및 정직 등)을 감수한다.')
      + paragraph('③ 근로자는 근로계약기간을 포함하여 퇴사 후에라도 회사의 서면 허가 없이는 회사에서 지득한 업무상 기밀사항 또는 고객의 비밀사항에 대해 그 경중을 막론하고 외부에 유출하여서는 아니 되며, 만일 위반할 경우 민·형사상의 모든 책임을 진다.')
      + paragraph('④ 근로자는 업무의 특성상 업무와 관련한 정보라도 허가 없이 내부 직원과 공유하지 않는다.') + paragraph('⑤ 근로자는 고의 또는 과실로 갑에 손해를 입힌 경우 그 손해의 한도 내에서 배상책임을 진다.'))}
    ${clause('제 13조 [기타조건]',paragraph('① 상기 조건 이외의 개별약정이 있는 경우 그 약정을 본 계약에 우선하여 적용한다.')
      + paragraph('② 근로자는 사용자와 근로계약을 체결하였는 바, 사용자가 “재직한 상태로 사용자의 이익에 반하여 근로자 자신의 영리를 도모하거나 타 업무에 종사하는 행위<strong class="contract-emphasis">(겸업 및 프리랜서 등)</strong>”를 금지하고 있다는 점을 명확히 이해하고 동의한다<strong class="contract-emphasis">(위반 시 징계처분 대상).</strong>') + signature('signature-13'))}
    ${clause('제 14조 [준용]',paragraph('본 계약서에 명시되지 않은 사항은 근로기준법 등 노동관계법령, 취업규칙을 준용한다.'),true)}
    <p class="contract-conclusion">양 당사자는 상기 사항에 대하여 이의가 없음을 확인하고, 위와 같이 연봉근로계약을 체결합니다.</p>
    <p class="contract-date">${field('documentDate',longDate(v('documentDate')))}</p>
    <div class="contract-parties"><div>[사용자] ${field('footer-employerName',v('employerName'))}<br>대표 ${field('footer-representative',v('representative'))}<span class="sign-space" data-signature></span>(인)</div><div>[근로자] ${field('footer-employeeName',data.employeeName)}<span class="sign-space" data-signature></span>(인)</div></div>
    <div class="contract-receipt">상기 근로자는 <strong class="contract-emphasis">수습기간(해당자에 한함), 연장근로 및 포괄산정임금제, 계약해지사유, 기밀유지 및 손해배상 등</strong> 주요 근로계약조건에 대해 사용자로부터 상세한 설명을 듣고 충분히 이해한 후 동의하여 본 근로계약을 체결하였으며, 본 계약서 1부를 교부 받았음을 확인한다.<div class="contract-signature">확인자 <span data-signature>${field('receipt-name')}</span><span class="sign-space"></span>(인)</div></div>
    <footer class="contract-page-number">2 / 2</footer>
  </article>`
  return first + second
}

export const EMPLOYMENT_CONTRACT_CSS = `
.employment-contract{padding:28px 40px 30px;font-size:11.5px;line-height:1.38;overflow:visible;height:auto;min-height:1123px}
.employment-contract h1{font-size:24px;line-height:1.3;letter-spacing:3px;text-align:center;text-decoration:underline;margin:0 0 16px}
.employment-contract table{border-collapse:collapse;width:100%;table-layout:fixed;margin:5px 0;font-size:inherit}
.employment-contract th,.employment-contract td{border:1px solid #222;padding:3px 5px;text-align:center;vertical-align:middle;font-weight:normal;overflow-wrap:anywhere}
.employment-contract th{background:#f2f2f2}.employment-contract .vertical-label{writing-mode:vertical-rl;letter-spacing:3px;background:#e4f0f4}
.employment-contract .contract-identity td{height:28px}.employment-contract .address{white-space:pre-line;font-size:11px}
.contract-value{white-space:pre-wrap;overflow-wrap:anywhere}.contract-value:empty{display:inline-block;min-width:56px;min-height:1em;vertical-align:baseline}
.contract-identity .contract-value:empty{min-width:0}.date-value{display:inline-block;min-width:92px;text-align:center;margin:0 4px;background:#ebf1de;font-weight:bold;text-decoration:underline}
.employment-contract .contract-emphasis{font-weight:bold;text-decoration:underline}.employment-contract .contract-blue{color:#0000ff}
.employment-contract .probation-highlight{display:inline-block;background:#ebf1de;font-weight:bold;padding:1px 4px}.probation-highlight .date-value{text-decoration:none}.probation-highlight [data-field="probation-selection"]{text-decoration:underline}
.employment-contract .probation-pay{color:#808080}.employment-contract .job-highlight{display:inline-block;min-width:235px;background:#e6e0ed;font-weight:bold;text-align:center;padding:0 8px}.job-highlight [data-field="position"]{text-decoration:underline}
.employment-contract .signature-highlight{display:inline-block;min-width:235px;text-decoration:underline;background:#fdeadb;padding:0 8px}
.employment-contract .salary-highlight{display:inline-block;min-width:140px;margin:0 12px;text-align:center;background:#f3dcdb}
.employment-contract .contract-identity th,.employment-contract .contract-hours th,.employment-contract .contract-wage thead th{font-weight:bold}
.employment-contract .contract-hours td{color:#0000ff;font-weight:bold;text-decoration:underline}
.contract-intro{text-align:center;margin:12px 0}.contract-intro .contract-value{margin:0 5px}
.contract-clause{margin:9px 0 0;break-inside:avoid}.contract-clause h2{font-size:12px;margin:0 0 3px;font-weight:bold}.contract-clause p{margin:1px 0 1px 15px}
.contract-clause-inline{display:grid;grid-template-columns:180px 1fr;gap:0 5px}.contract-clause-inline h2,.contract-clause-inline p{margin:0}
.contract-signature{text-align:right;margin:1px 0 3px;min-height:18px}.contract-signature .contract-value{display:inline-block;min-width:72px;text-align:center}.sign-space{display:inline-block;width:24px}
.contract-parties .sign-space{width:60px}
.employment-contract .contract-wage{font-size:10.5px}.contract-wage tbody th{background:white}.contract-wage .money{text-align:right;white-space:nowrap}.employment-contract .contract-wage .total>*{font-weight:bold}.contract-wage .total th{background:#f2f2f2}
.contract-conclusion{text-align:center;margin:10px 0 8px}.contract-date{text-align:center;min-height:18px;margin:8px 0 10px;color:#0000ff}.contract-parties{display:flex;justify-content:space-between;gap:24px;margin:0 15px 8px;line-height:1.8;font-weight:bold}.contract-parties .contract-value{margin:0 8px}
.contract-receipt{border:1px solid #222;padding:5px;font-size:10.5px}.contract-receipt .contract-signature{margin:3px 0 0}.contract-page-number{text-align:center;color:#555;font-size:10px;margin-top:14px}
@media print{@page{size:A4;margin:0}html,body{background:white}.sheet{margin:0;break-after:page}.sheet:last-child{break-after:auto}.employment-contract{width:210mm;min-height:297mm;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`
