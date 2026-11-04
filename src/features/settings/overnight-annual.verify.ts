import assert from 'node:assert/strict'
import { validateRequest, DEFAULT_REMINDER_BASIS, type PersonalRequest, type RequestForm } from './personal-requests.ts'
const annual: RequestForm = { kind: 'annual', from: '2026-11-05', to: '2026-11-05', start: '09:00', end: '18:00', note: '', place: '' }
const night: RequestForm = { kind: 'offsite', from: '2026-11-04', to: '2026-11-04', start: '16:00', end: '05:00', endNextDay: true, note: '', place: '외근' }
const stored = (form: RequestForm): PersonalRequest => ({ ...form, id: 'example', status: 'approved', createdAt: '' })
for (const first of ['annual','offsite']) for (const start of ['09:00','10:00']) for (const end of ['05:00','09:00','09:30','10:00','10:01']) {
  const offsite = { ...night, end }
  const result = first === 'annual' ? validateRequest(offsite, [stored(annual)], DEFAULT_REMINDER_BASIS, undefined, { '2026-11-05': start }) : validateRequest(annual, [stored(offsite)], DEFAULT_REMINDER_BASIS, undefined, { '2026-11-05': start })
  assert.equal(result === '', end <= start, `${first}: ${end} / ${start}`)
}
assert.notEqual(validateRequest(annual, [stored(night)], DEFAULT_REMINDER_BASIS, undefined, { '2026-11-05': null }), '')
assert.equal(validateRequest(annual, [stored({ ...night, from: '2026-11-03', to: '2026-11-05', endNextDay: false, offsiteContinuous: true })], DEFAULT_REMINDER_BASIS, undefined, { '2026-11-05': '09:00' }), '')
assert.notEqual(validateRequest({ ...annual, kind: 'official', note: '공가' }, [stored(night)], DEFAULT_REMINDER_BASIS, undefined, { '2026-11-05': '09:00' }), '')
console.info('Overnight annual UI validation: both orders, exact boundary, shifted/unknown basis, continuous and official distinction passed')
