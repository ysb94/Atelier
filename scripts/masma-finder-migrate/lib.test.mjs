import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expectedParityCounts,
  mergeAttachments,
  mergeFinderUsers,
  mergeByNaturalKey,
  uuidFromLegacy,
} from './lib.mjs'

test('사용자는 이메일로 병합하고 기존 승인·auth를 유지한다', () => {
  const existingId = '11111111-1111-4111-8111-111111111111'
  const { rows, idByLegacyUid } = mergeFinderUsers(
    [
      {
        id: uuidFromLegacy('masma-finder-user', 'a@example.com'),
        email_normalized: 'a@example.com',
        legacy_firebase_uid: 'fb-1',
        display_name: 'Firebase',
        status: 'pending',
        is_admin: false,
        auth_user_id: null,
      },
    ],
    [
      {
        id: existingId,
        email_normalized: 'a@example.com',
        legacy_firebase_uid: null,
        display_name: '',
        status: 'active',
        is_admin: true,
        auth_user_id: 'auth-1',
      },
    ],
  )

  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, existingId)
  assert.equal(rows[0].auth_user_id, 'auth-1')
  assert.equal(rows[0].status, 'active')
  assert.equal(rows[0].is_admin, true)
  assert.equal(rows[0].legacy_firebase_uid, 'fb-1')
  assert.equal(idByLegacyUid['fb-1'], existingId)
})

test('업무 일자는 (brand_id, work_date)로 기존 id를 재사용한다', () => {
  const existingId = '22222222-2222-4222-8222-222222222222'
  const { rows, idByKey } = mergeByNaturalKey(
    [{ id: 'new-id', brand_id: 'b1', work_date: '2026-09-16', updated_at: '2026-01-01T00:00:00.000Z' }],
    [{ id: existingId, brand_id: 'b1', work_date: '2026-09-16', updated_at: '2026-09-01T00:00:00.000Z' }],
    (row) => `${row.brand_id}:${row.work_date}`,
  )
  assert.equal(rows[0].id, existingId)
  assert.equal(idByKey['b1:2026-09-16'], existingId)
})

test('첨부는 Storage 객체와 Firestore 메타를 한 행으로 합친다', () => {
  const taskId = 'task-uuid'
  const rows = mergeAttachments({
    brandId: 'brand-1',
    taskIdByLegacy: { taskA: taskId },
    firestoreAttachments: [
      {
        taskLegacyId: 'taskA',
        attachmentLegacyId: 'att-1',
        kind: 'completion',
        original_name: '완료사진.jpg',
        path: 'works_attachments/taskA/completion_1.jpg',
        created_by_name: '설빈',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    storageObjects: [
      {
        path: 'works_attachments/taskA/completion_1.jpg',
        size: 12,
        sha256: 'abc',
        contentType: 'image/jpeg',
        updated: '2026-01-02T00:00:00.000Z',
      },
    ],
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].task_id, taskId)
  assert.equal(rows[0].kind, 'completion')
  assert.equal(rows[0].sha256, 'abc')
  assert.equal(rows[0].created_by_name, '설빈')
  assert.equal(rows[0].legacy_object_path, 'works_attachments/taskA/completion_1.jpg')
})

test('기대 첨부 건수는 경로 중복을 한 번만 센다', () => {
  const counts = expectedParityCounts({
    authUsers: [{ email: 'A@example.com' }, { email: 'a@example.com' }],
    firestoreUsers: [{ data: { email: 'b@example.com' } }],
    templates: [{ id: 't1' }],
    workDays: [
      {
        id: '2026-09-16',
        children: {
          tasks: [
            {
              id: 'taskA',
              data: {
                attachments: [{ path: 'works_attachments/taskA/a.jpg' }],
                completionAttachments: [{ path: 'works_attachments/taskA/a.jpg' }],
              },
            },
          ],
        },
      },
    ],
    incomingDays: [
      {
        id: '2026-09-16',
        children: {
          groups: [{ id: 'g1', children: { items: [{ id: 'i1' }] } }],
          items: [{ id: 'legacy-1' }],
        },
      },
    ],
    moveDrafts: [{ id: 'uid-1' }],
    moveHistory: [
      {
        id: '2026',
        children: {
          months: [
            {
              id: '09',
              children: {
                days: [
                  {
                    id: '16',
                    children: {
                      exports: [{ id: 'e1', children: { rows: [{ id: 'r1' }, { id: 'r2' }] } }],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
    labelScans: [{ id: 's1' }],
    storageObjects: [
      { path: 'works_attachments/taskA/a.jpg', size: 1, sha256: 'x' },
    ],
  })

  assert.equal(counts.users, 2)
  assert.equal(counts.workDays, 1)
  assert.equal(counts.workTasks, 1)
  assert.equal(counts.attachments, 1)
  assert.equal(counts.incomingGroups, 2)
  assert.equal(counts.incomingItems, 2)
  assert.equal(counts.moveExports, 1)
  assert.equal(counts.moveExportRows, 2)
  assert.equal(counts.labelScans, 1)
})
