import type { DocumentPreviewData } from './new-employee-document-templates'

// 20260406 개인정보 / 20260416 생체인식 HWP 원본 기준. 동의와 서명은 자동 작성하지 않는다.
const escapeHtml = (value = '') => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const field = (key: string, value = '', className = '') => `<span data-field="${key}" class="consent-value ${className}">${escapeHtml(value)}</span>`
const date = (value = '') => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replace(/-/g, '.') : ''
const longDate = (value = '') => /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(0,4)}년 ${value.slice(5,7)}월 ${value.slice(8,10)}일` : ''
const lines = (values: string[]) => values.map(escapeHtml).join('<br>')
const retention = '재직기간 동안 보유하고, 기타 개별법령에서 보유기간을 정하고 있는 경우 그에 따름'
const personnelPurpose = `<div>가. 채용 및 승진 등 인사관리</div><div class="consent-purpose">나. 세법, 노동관계법령 등에서<br>부과하는 의무이행</div><div>다. 정부지원금 신청</div>`
const attendancePurpose = lines(['가. 이용자 식별 및 본인 인증', '나. 출퇴근 시간 확인 및 근태 관리 (지각·조퇴·결근 포함)', '다. 급여·수당 산정 기초 자료 활용'])

function choice(label: string) {
  return `<p class="consent-choice">${label} (<span class="consent-check" data-consent-choice aria-label="동의함 미선택"></span>동의함 <span class="consent-check" data-consent-choice aria-label="동의하지 않음 미선택"></span>동의하지 않음)</p>`
}
function table(heading: string, items: string, purpose: string, note = '', retentionHeading = '보유기간') {
  return `<table class="consent-table"><colgroup><col style="width:33%"><col style="width:37%"><col style="width:30%"></colgroup>
    <thead><tr><th>${heading}</th><th>수집·이용 목적</th><th>${retentionHeading}</th></tr></thead>
    <tbody><tr><td>${items}</td><td>${purpose}</td><td>${retention}</td></tr>${note ? `<tr><td colspan="3" class="consent-note">${note}</td></tr>` : ''}</tbody></table>`
}
function identity(data: DocumentPreviewData) {
  const birthDate = data.personal.find(([label]) => label === '생년월일')?.[1] ?? ''
  return `<table class="consent-identity"><colgroup><col style="width:11%"><col style="width:34%"><col style="width:19%"><col style="width:36%"></colgroup><tbody>
    <tr><th>소속</th><td>${field('department',data.department)}</td><th>직책(직위)</th><td>${field('position',data.position)}</td></tr>
    <tr><th>성명</th><td>${field('employeeName',data.employeeName)}</td><th>생년월일</th><td>${field('birthDate',birthDate)}</td></tr>
  </tbody></table>`
}
function footer(data: DocumentPreviewData) {
  return `<div class="consent-footer">
    <p class="consent-date">${field('documentDate',longDate(data.company?.documentDate))}<span class="date-label">(작성일자)</span></p>
    <p class="consent-signature">확인자 : <span class="signature-line" data-signature></span> (인)</p>
    <p class="consent-recipient">${field('recipient-company',data.company?.employerName)} 귀하</p>
  </div>`
}
function privacy(data: DocumentPreviewData) {
  return `<h1>개인정보 수집·이용에 관한 동의서</h1>${identity(data)}
    <p class="consent-intro">상기 본인은 ${field('hireDate',date(data.company?.hireDate))}자로 ${field('employerName',data.company?.employerName)}(이하 “회사”)와 근로계약을 체결한바, 인사관리상 개인정보의 수집·이용이 필요하다는 것을 확인하여 다음과 같이 개인정보, 민감정보, 고유식별정보를 수집·이용하는 것에 동의합니다.</p>
    <p class="consent-divider">- 다 음 -</p>
    <section class="consent-section">${table('개인정보항목',lines(['가. 성명','나. 주소, 이메일, 연락처','다. 학력, 근무경력, 자격증','라. 기타 근무 관련 개인정보']),personnelPurpose)}${choice('개인정보의 수집·이용에')}</section>
    <section class="consent-section">${table('민감정보항목',lines(['가. 신체장애','나. 병력']),personnelPurpose)}${choice('민감 정보의 수집·이용에')}</section>
    <section class="consent-section">${table('고유식별정보',lines(['가. 주민등록번호','나. 운전면허번호','다. 여권번호','라. 외국인등록번호']),personnelPurpose)}${choice('고유식별정보의 수집·이용에')}</section>
    <ul class="consent-notes"><li>본 회사는 상기 본인 동의 하에 취득한 개인정보 등을 수집·이용목적에 따라 재직기간 중 이용하고 사용증명서 발급 등을 위해 <strong>퇴직일로부터 5년 간 보관</strong>할 것이며, 수집·이용목적에 따라 외부 기관에 제공할 수 있음을 안내드립니다.</li><li>근로자는 개인정보 등의 수집·이용에 관한 동의를 거부할 수 있으나, 거부 시 인사·복리후생 등 고용관계 형성·유지·관리 등에 있어 불이익이 있을 수 있습니다.</li></ul>
    ${footer(data)}`
}
function biometric(data: DocumentPreviewData) {
  const refusal = (sensitive: boolean) => `※ 위 ${sensitive ? '민감정보(지문정보)' : '일반 개인정보'} 수집·이용에 동의하지 않을 권리가 있습니다(개인정보보호법 ${sensitive ? '제23조 제1항' : '제15조 제2항'}). 다만, 동의를 거부하시는 경우 지문인식시스템을 통한 출퇴근 관리가 불가하며, 회사가 별도로 정한 출퇴근 관리 방식(출입카드, 수기 서명 등)을 이용하셔야 합니다.`
  return `<h1>생체인식정보 수집·이용 안내 및 동의서</h1><p class="consent-subtitle">-지문인식시스템을 통한 출퇴근 관리-</p>${identity(data)}
    <p class="consent-intro">${field('employerName',data.company?.employerName)}(이하 "회사")는 「개인정보 보호법」 제15조 및 제23조에 따라 임직원의 출퇴근 현황을 정확하게 관리하기 위해 지문인식 시스템을 도입 및 운영합니다. 이와 관련하여 아래와 같이 개인정보(민감정보 포함)를 수집·이용하오니, 내용을 충분히 검토하신 후 동의 여부를 결정하여 주시기 바랍니다.</p>
    <section class="consent-section"><h2>■ 일반 개인정보 수집·이용 동의</h2>${table('개인정보의 항목',lines(['가. 성명','나. 사원번호','다. 부서 및 직위']),attendancePurpose,refusal(false),'보유·이용기간')}${choice('일반 개인정보의 수집·이용에')}</section>
    <section class="consent-section"><h2>■ 민감정보 수집·이용 동의</h2>${table('개인정보의 항목','지문정보(원본정보 및 특징정보)',attendancePurpose,refusal(true),'보유·이용기간')}${choice('민감정보(지문정보)의 수집·이용에')}</section>
    ${footer(data)}`
}

export function renderConsentDocument(data: DocumentPreviewData, isBiometric: boolean) {
  return `<article class="sheet consent-document ${isBiometric ? 'biometric-consent' : 'privacy-consent'}"><div class="consent-frame">${isBiometric ? biometric(data) : privacy(data)}</div><div class="consent-page-number">- 1 -</div></article>`
}

export const CONSENT_DOCUMENT_CSS = `
.consent-document{padding:107px 76px 0;height:auto;min-height:1123px;overflow:visible;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:13.33px;line-height:1.6}
.consent-frame{border:1px solid #000;padding:40px 18px 16px;min-height:916px}
.biometric-consent .consent-frame{min-height:922px}
.consent-document h1{font-family:'Malgun Gothic',sans-serif;font-size:26.67px;line-height:1.3;text-align:center;margin:0 0 12px;font-weight:700;letter-spacing:0;white-space:nowrap}
.consent-subtitle{text-align:center;margin:14px 0 18px;font-size:14.67px}
.consent-document table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:inherit;line-height:1.2}
.consent-document th,.consent-document td{border:1px solid #000;padding:1px 6px;vertical-align:top;overflow-wrap:anywhere}
.consent-document th{background:#d9d9d9;text-align:center;font-weight:bold}
.consent-identity th{background:white}.consent-identity td{height:24px;vertical-align:middle}.consent-identity th{vertical-align:middle}
.consent-table{font-size:12px!important;line-height:1.25!important}
.consent-value{white-space:pre-wrap;overflow-wrap:anywhere}.consent-value:empty{display:inline-block;min-width:76px;min-height:1em;vertical-align:baseline}.consent-identity .consent-value:empty{min-width:0}
.consent-intro{margin:22px 0 18px;text-align:justify}.privacy-consent .consent-intro .consent-value{font-weight:bold}.privacy-consent .consent-intro{text-indent:3.5em}
.consent-divider{text-align:center;letter-spacing:6px;margin:18px 0 12px}
.consent-section{margin:0 6px 13px;break-inside:avoid}.consent-section h2{font-size:13.33px;margin:26px 0 10px;line-height:1.3}
.privacy-consent .consent-section{margin-bottom:10px}
.consent-table tbody tr:first-child td{height:64px;padding-top:3px;padding-bottom:3px}.consent-table tbody tr:first-child td:last-child{vertical-align:middle}
.consent-purpose{padding-left:1.5em;text-indent:-1.5em}
.consent-choice{margin:12px 8px 0 0;text-align:right;font-weight:bold;font-size:13.33px;white-space:nowrap;line-height:1.4}
.consent-check{display:inline-block;width:9px;height:9px;border:1px solid #000;margin:0 1px 0 4px;vertical-align:baseline}
.consent-note{font-size:12px;line-height:1.05;padding:4px 10px!important}
.consent-notes{padding:0 14px 0 30px;margin:24px 0 0;font-size:12px;line-height:1.8;list-style-type:disc}.consent-notes li{margin:0 0 3px;text-align:justify;padding-left:0}.consent-notes li::marker{font-size:17px}.consent-notes strong{text-decoration:underline}
.consent-footer{padding-top:18px}.consent-date{text-align:center;color:blue;margin:8px 0 28px;min-height:21px}.consent-date .consent-value:empty{min-width:190px}.date-label{margin-left:0}
.privacy-consent .consent-notes{margin-top:20px}.privacy-consent .consent-footer{padding-top:12px}
.consent-signature{text-align:right;margin:0 0 2px}.signature-line{display:inline-block;width:108px;min-height:20px;border-bottom:1px solid #000;vertical-align:bottom}
.consent-recipient{font-size:18.67px;font-weight:bold;margin:0}.consent-recipient .consent-value{display:inline-block;min-width:195px;border-bottom:1px solid #000;margin-right:16px;padding-left:18px}
.biometric-consent .consent-intro{margin:22px 0 0}
.biometric-consent .consent-subtitle{margin-bottom:12px}
.biometric-consent .consent-table tbody tr:first-child td{height:74px;vertical-align:middle}
.biometric-consent .consent-section{margin-bottom:16px}
.biometric-consent .consent-section+.consent-section h2{margin-top:20px}
.biometric-consent .consent-footer{padding-top:16px}
.consent-page-number{text-align:center;color:#000;font-size:12px;margin-top:20px}
@media print{.consent-document{width:210mm;min-height:297mm}}
`
