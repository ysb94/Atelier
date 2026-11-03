import type { CompanyInformation } from './NewEmployeeCompanyInformation'
import { EMPLOYMENT_CONTRACT_CSS, renderEmploymentContract } from './employment-contract-template'
import { CONSENT_DOCUMENT_CSS, renderConsentDocument } from './consent-document-template'

export const SIGNATURE_DOCUMENTS = ['근로계약서', '개인정보 수집 동의서', '생체인식정보 동의서'] as const
export type SignatureDocument = typeof SIGNATURE_DOCUMENTS[number]
export type DocumentPreviewData = { employeeName: string; department: string; position: string; personal: readonly (readonly [string, string])[]; company?: CompanyInformation }
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

/** 제공된 양식을 HTML 글자·표로 표시하며, 현재 입력값만 반영한다. */
export function renderEmployeeDocument(kind: SignatureDocument, data: DocumentPreviewData) {
  const body = kind === '근로계약서' ? renderEmploymentContract(data) : renderConsentDocument(data,kind === '생체인식정보 동의서')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escape(kind)}</title><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#e5e5e5;color:#000;font-family:'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif}body{width:794px}.sheet{width:794px;height:1123px;background:#fff;position:relative;overflow:hidden;margin:0 0 16px}${EMPLOYMENT_CONTRACT_CSS}${CONSENT_DOCUMENT_CSS}
  @media print{@page{size:A4 portrait;margin:0}html,body{width:210mm;background:white}.sheet{width:210mm;min-height:297mm;height:auto;margin:0;overflow:visible;break-after:page;print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet:last-child{break-after:auto}}
  </style></head><body>${body}</body></html>`
}
