import { holidayCredit, holidayTime, type HolidayWorkConfirmation } from './holiday-work'

const escaped: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const field = (value: string | null | undefined) => (value ?? '').replace(/[&<>"']/g, character => escaped[character]!)
const date = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long' }).format(new Date(value))

export function renderHolidayConfirmation(confirmation: HolidayWorkConfirmation) {
  const { work, choice, respondedAt } = confirmation
  const selection = `${choice === 'cash' ? '☑' : '☐'} 가산임금 지급　　${choice === 'leave' ? '☑' : '☐'} 보상휴가 부여`
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>주말·휴일근로 보상방법 선택 및 확인서</title>
  <style>
    @page{size:A4 portrait;margin:17mm}
    *{box-sizing:border-box}
    body{margin:0;background:#fff;color:#181818;font:12pt/1.55 "Malgun Gothic",sans-serif}
    article{max-width:176mm;margin:auto;padding:8mm 4mm}
    h1{text-align:center;font-size:19pt;margin:0 0 9mm} h2{font-size:13pt;margin:6mm 0 2mm;color:#172f49;break-after:avoid}
    h3{font-size:12pt;margin:6mm 0 2mm} p{margin:0 0 3mm}
    table{width:100%;border-collapse:collapse;margin:2mm 0 5mm} th,td{border:1px solid #a3a9b1;padding:3mm;text-align:left;vertical-align:middle}
    th{width:22%;background:#f2f5f8;white-space:nowrap} td{overflow-wrap:anywhere}
    .reason{white-space:pre-wrap;font-size:10pt} .sign{display:block;min-height:11mm;text-align:right}
    ul{margin:2mm 0;padding-left:6mm}
    .signature-page{border-top:1px solid #a3a9b1;margin-top:10mm;padding-top:5mm}
    @media print{article{max-width:none;padding:0}.signature-page{break-before:page;border:0;margin:0;padding:0}tr{break-inside:avoid}}
  </style></head><body><article>
  <h1>주말·휴일근로 보상방법 선택 및 확인서</h1>
  <p>본인은 회사 업무로 발생한 주말 및 휴일근로에 대한 보상 기준 및 방법에 대하여 충분히 안내받았으며, 아래와 같이 보상방법을 선택합니다.</p>
  <h2>1. 근로내역</h2>
  <table><tbody>
    <tr><th>성명</th><td>${field(work.name)}</td><th>소속</th><td>${field(work.department)}</td></tr>
    <tr><th>직급</th><td>${field(work.grade)}</td><th>근로일</th><td>${field(date(work.date))}</td></tr>
    <tr><th>근로시간</th><td colspan="3">${work.intervals.map(interval => `${holidayTime(interval.start)} ~ ${holidayTime(interval.end)}`).join(' / ')}<br>총 ${holidayCredit(work.actualMinutes * 2)}</td></tr>
    <tr><th>근로사유</th><td colspan="3" class="reason">${field(work.reason)}</td></tr>
  </tbody></table>
  <h2>2. 보상방법 선택</h2>
  <p>본인은 위 주말·휴일근로에 대한 보상방법으로 다음 중 하나를 선택합니다.</p>
  <p>${selection}</p>
  <p><strong>가산임금 지급</strong> · 주말·휴일근로에 대하여 관계 법령 및 회사 기준에 따라 가산임금을 지급받겠습니다.</p>
  <p><strong>보상휴가 부여</strong> · 주말·휴일근로에 대하여 관계 법령 및 회사의 보상휴가 운영기준에 따라 보상휴가를 부여받겠습니다.</p>
  <p>보상휴가를 선택하는 경우 실제 근로시간에 법정 가산분을 반영하여 휴가시간을 산정합니다.</p>
  <p>가산 반영 보상시간 ${holidayCredit(work.creditUnits)}${work.creditUnits !== work.remainingUnits ? ` · 이번 정산 대상 ${holidayCredit(work.remainingUnits)}` : ''}</p>
  <h2>3. 확인사항</h2>
  <ul>
    <li>본인은 주말·휴일근로에 대한 보상방법 및 산정기준에 대하여 회사로부터 충분한 설명을 들었습니다.</li>
    <li>본 확인서에서 선택한 보상방법에 따라 회사는 해당 주말·휴일근로에 대한 보상을 처리합니다.</li>
    <li>보상휴가는 일반적인 연차유급휴가와 구분되는 보상휴가임을 확인합니다.</li>
    <li>출장 중 이동시간 및 실제 업무수행 여부에 따라 근로시간 및 보상대상이 달라질 수 있음을 확인합니다.</li>
    <li>본 확인서는 실제 발생한 주말·휴일근로 내역을 기준으로 작성합니다.</li>
  </ul>
  <section class="signature-page">
    <h2>4. 서명 및 확인</h2>
    <h3>근로자 확인</h3>
    <p>본인은 위 내용을 확인하고 아래와 같이 보상방법을 선택합니다.</p>
    <p>${selection}</p>
    <table><tbody>
      <tr><th>작성일자</th><td>${field(respondedAt ? date(respondedAt) : '')}</td></tr>
      <tr><th>근로자 성명</th><td>${field(work.name)} <span class="sign">(서명)</span></td></tr>
    </tbody></table>
    <h3>회사 확인</h3>
    <table><tbody>
      <tr><th>담당자</th><td>${field(work.requestedBy)}</td><th>확인일자</th><td></td></tr>
      <tr><th>승인자</th><td colspan="3"><span class="sign">(서명)</span></td></tr>
    </tbody></table>
    <p style="text-align:center;font-weight:bold">㈜ 에스앤디</p>
  </section></article></body></html>`
}
