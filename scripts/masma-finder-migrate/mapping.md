# Masma Finder Firebase → Supabase 매핑

스냅샷과 적재 스크립트가 이 표를 기준으로 변환한다. 원본 Firebase는
검증이 끝날 때까지 삭제하지 않는다.

기본 브랜드: `atelier` / `b0000000-0000-4000-8000-000000000001`

## 식별자

| Firebase | Supabase | 규칙 |
| --- | --- | --- |
| Auth `uid` | `masma_finder_users.legacy_firebase_uid` | 이메일로 결합. `auth_user_id`는 첫 Supabase Google 로그인 때 채운다 |
| `users.email` | `masma_finder_users.email_normalized` | `lower(trim(email))`. `(brand_id, email_normalized)` 고유 |
| `users.masma_finder === true` | `status = 'active'` | false/없음은 `pending` |
| `users.masma_finder_administrator === true` | `is_admin = true` | Finder 전용. Atelier `profiles.is_admin`과 분리 |
| 작성자 uid | `created_by` + `created_by_name` + `created_by_legacy_uid` | 가입 전 이력도 이름 스냅샷으로 보존 |
| Storage `works_attachments/{taskId}/...` | `brands/{brand_id}/works/{task_id}/{kind}/{attachment_id}/{name}` | 해시·바이트·원본 경로를 메타에 보관 |

## 컬렉션

| Firestore | Supabase |
| --- | --- |
| `users` | `masma_finder_users` |
| `warehouses_works_daily/{date}` | `masma_finder_work_days` |
| `warehouses_works_daily/{date}/tasks/{id}` | `masma_finder_work_tasks` |
| 업무 `attachments[]` / `completionAttachments[]` | `masma_finder_work_attachments.kind = normal\|completion` |
| `warehouses_works_templates` | `masma_finder_work_templates` |
| `warehouse_incoming_lists/{date}/groups/{id}` | `masma_finder_incoming_groups` |
| `warehouse_incoming_lists/{date}/groups/{id}/items` | `masma_finder_incoming_items` (`is_legacy_flat = false`) |
| `warehouse_incoming_lists/{date}/items` | 같은 날짜의 `is_legacy=true` 묶음 아래 항목 |
| `warehouses_move_drafts/{uid}` | `masma_finder_move_drafts` (`finder_user_id` 또는 legacy uid) |
| `warehouse_move_history/{y}/months/{m}/days/{d}/exports` | `masma_finder_move_exports` |
| `.../exports/{id}/rows` | `masma_finder_move_export_rows` |
| `label_scans` | `masma_finder_label_scans` |
| `products.onhand` | 이전하지 않음. `firebase-product-onhand` Edge Function만 읽는다 |

## 권한 경계

- Finder 사용은 `app.can_use_masma_finder(brand_id)` 만으로 연다.
- `app.can_read_brand`는 Atelier 회사 셸용이며 여기서 넓히지 않는다.
- 창고 파인더 RPC만 `can_read_brand OR can_use_masma_finder` 로 조회한다.
- 신규 Google 로그인은 사전 이관된 이메일이면 `active`, 아니면 `pending`.

## 병합 키

재적재는 insert-only가 아니라 아래 키로 합친다. 기존 승인 사용자와
`auth_user_id`는 덮어쓰지 않는다.

| 대상 | 병합 키 |
| --- | --- |
| 사용자 | `email_normalized`. 기존 `active`/`revoked`와 관리자 플래그를 유지 |
| 업무 일자 | `(brand_id, work_date)` |
| 업무·템플릿·입고 항목·이동 이력 | `legacy_id`가 있으면 그 값, 없으면 결정적 UUID |
| 입고 묶음 | `(brand_id, work_date, legacy_group_id)` |
| 첨부 | `legacy_object_path` 또는 Storage 해시. Firestore 메타와 Storage 객체를 한 행으로 합친다 |

## 스냅샷 산출물

`outputs/masma-finder-snapshots/<stamp>/`

- `auth-users.json`
- `firestore/*.json`
- `storage/manifest.json` + `storage/objects/**`
- `mapping.json` (legacy id → 새 UUID)
- `verify-report.json`
