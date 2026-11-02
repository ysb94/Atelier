import assert from 'node:assert/strict'
import { overtimeApprovalReady } from './overtime-approval-preview.ts'

assert.equal(overtimeApprovalReady('overtime', '2026-10-26', '2026-10-27', false), false, '과거 야근은 조회 실패 시 승인 차단')
assert.equal(overtimeApprovalReady('overtime', '2026-10-26', '2026-10-27', true), true, '조회 성공 후 과거 야근 승인 가능')
assert.equal(overtimeApprovalReady('overtime', '2026-10-27', '2026-10-27', false), true, '오늘 야근의 기존 승인 경로 유지')
assert.equal(overtimeApprovalReady('overtime', '2026-10-28', '2026-10-27', false), true, '미래 야근의 기존 승인 경로 유지')
assert.equal(overtimeApprovalReady('correction', '2026-10-26', '2026-10-27', false), true, '다른 종류에는 영향 없음')
console.log('overtime-approval-preview.verify ok')
