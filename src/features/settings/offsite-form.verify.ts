import assert from 'node:assert/strict'
import { offsiteSubmission } from './offsite-form.ts'
import { DEFAULT_REMINDER_BASIS, validateRequest, type RequestForm } from './personal-requests.ts'

const form: RequestForm = { kind: 'offsite', from: '2026-11-04', to: '2026-11-05', start: '09:00', end: '03:00', place: '거래처', note: '' }
const original = structuredClone(form)
const night = offsiteSubmission(Object.freeze(form))
assert.equal(night.error, '')
assert.equal(night.minutes, 18 * 60)
assert.equal(night.request?.to, '2026-11-04')
assert.equal(night.request?.endNextDay, true)
assert.deepEqual(form, original, '화면의 실제 종료 날짜를 저장용 날짜로 덮어쓰지 않음')
assert.equal(validateRequest(night.request!, [], DEFAULT_REMINDER_BASIS), '')
const day = offsiteSubmission({ ...form, to: form.from, end: '18:00' })
assert.equal(day.minutes, 9 * 60)
assert.equal(day.request?.endNextDay, false)
assert.equal(offsiteSubmission({ ...form, end: '09:00' }).minutes, 1440)
assert.match(offsiteSubmission({ ...form, end: '09:01' }).error, /24시간/)
assert.match(offsiteSubmission({ ...form, to: '2026-11-06' }).error, /24시간/)
assert.match(offsiteSubmission({ ...form, to: form.from }).error, /늦어야/)
assert.match(offsiteSubmission({ ...form, to: form.from, end: form.start }).error, /늦어야/)
assert.match(offsiteSubmission({ ...form, to: '2026-11-03' }).error, /늦어야/)
assert.match(offsiteSubmission({ ...form, start: '' }).error, /입력/)
assert.match(offsiteSubmission({ ...form, end: '24:00' }).error, /입력/)
assert.match(offsiteSubmission({ ...form, from: '2026-02-30' }).error, /입력/)
assert.equal(offsiteSubmission({ ...form, from: '2028-02-28', to: '2028-02-29' }).request?.endNextDay, true)
assert.equal(offsiteSubmission({ ...form, from: '2026-12-31', to: '2027-01-01' }).request?.endNextDay, true)
const annual: RequestForm = { ...form, kind: 'annual' }
assert.equal(offsiteSubmission(annual).request, annual, '다른 신청 종류는 변환하지 않음')
const legacy = Object.freeze({ ...form, id: 'old', to: '2026-11-06', start: '09:00', end: '18:00', status: 'approved' as const, createdAt: '2026-11-01' })
assert.match(validateRequest(night.request!, [legacy], DEFAULT_REMINDER_BASIS), /같은 시간/)
assert.equal(legacy.to, '2026-11-06', '기존 여러 날 반복 외근 원본 보존')
console.info('Offsite form: explicit dates → existing same-day/overnight payload; 24h, midnight/month/year/leap boundaries, invalid input and immutable legacy records passed')
