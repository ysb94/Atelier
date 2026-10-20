# 업체별 헤더 저장소 운영 적용 검증 — 2026-10-20

대상은 기존 E&J의 Atelier 프로젝트다. 사용자가 이 대화에서 기존 데이터는 유지하고 추가형 변경만 적용하도록 승인했다. Supabase MCP `apply_migration`으로 적용했으며, 브라우저 SQL 실행이나 Cursor MCP의 읽기 전용 설정 변경은 하지 않았다.

## 적용한 내용

- 이력: `20261020091506_usage_partner_headers`.
- 파일: `supabase/migrations/20261020091506_usage_partner_headers.sql`.
- 추가 테이블: `usage_partner_columns`, `usage_partner_values`, `usage_partner_editors`.
- 이 테이블 전용 RLS, 조회/저장 RPC와 검증 트리거를 추가했다.
- 기존 전역 권한 함수·테이블 정의·업무 원본 행은 변경하지 않았다. 기존 헤더를 복사하거나 담당자를 자동 지정하지 않았다.
- 최초 로컬 파일명은 `20261020065641`이었으나 MCP가 기록한 실제 버전과 일치하도록 파일명만 조정했다. SQL 내용은 동일하다.

## 기존 데이터 전후 비교

각 테이블에서 행 전체를 JSON으로 직렬화해 행별 MD5를 구하고, 정렬한 행 지문을 다시 MD5로 비교했다. 개수뿐 아니라 값과 연결 키를 함께 확인하기 위한 검사다.

| 테이블 | 적용 전·후 건수 | 전후 지문 |
| --- | ---: | --- |
| `styles` | 2,445 | 동일 |
| `product_codes` | 2,173 | 동일 |
| `product_code_components` | 2,502 | 동일 |
| `code_usage_targets` | 189 | 동일 |
| `code_usage_assignments` | 5 | 동일 |
| `usage_code_columns` | 5 | 동일 |

## 운영 DB 역할 검증

`SET LOCAL ROLE authenticated`와 실제 활성 프로필 식별자를 사용했다. 관리자 권한으로 단순 우회한 쿼리만 검사하지 않고, 실제 RLS와 SECURITY INVOKER RPC를 실행했다. 기존 업체와 코드의 연결은 조회만 하고 테스트 항목·값·담당자 지정은 신규 테이블 안에서만 만들었다.

확인한 동작:

1. 관리자 설정·담당자 관리 권한 조회.
2. 기존 헤더 UUID를 유지한 업체별 설정과 전용 항목 저장.
3. 전용 값 저장 후 조회.
4. 공통 필드 값 쓰기 거부.
5. 항목 숨김 및 다시 표시 시 값 유지.
6. 활성 담당자 후보 조회.
7. 담당자가 아닌 일반 직원은 읽기만 가능하고 저장은 거부.
8. 관리자가 지정한 담당자의 저장 허용.
9. 담당자의 다른 업체 값 수정 거부.
10. 담당자 자기 지정/다른 업체 권한 확대 거부.
11. 담당자 지정 회수 후 편집 권한 제거.
12. 지연 제약 조건을 즉시 검사해 필수 헤더와 고유성 검증.

모든 입력은 하나의 트랜잭션에서 검사한 뒤 `ROLLBACK`했다. 완료 후 신규 테이블 3개는 모두 0행이고, 위 기존 6개 테이블의 지문도 여전히 동일하다.

신규 테이블 3개는 RLS가 활성화되어 있다. 공개 RPC 5개는 모두 SECURITY INVOKER이고 `anon` 실행 권한이 없다.

## 보안 진단의 기존 항목

Supabase 보안 진단에는 이번에 추가한 `usage_partner_*` 테이블·함수에 대한 항목이 없었다. 다음은 이번 변경 범위 밖의 기존 객체/설정에서 관찰된 내용이다. 사용자 요청 범위를 유지하기 위해 해당 객체나 권한을 변경하지 않았다.

- `chat_attachment_downloads`: RLS 활성화 상태에 정책이 없다는 정보 항목. [진단 설명](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- 기존 공개 SECURITY DEFINER 함수: 익명 실행 가능 6개와 로그인 사용자 실행 가능 47개를 권한 검토 대상으로 보고했다. 함수 내부 검사를 포함한 개별 검토가 필요하며, 이 경고만으로 실제 무단 접근 가능성을 확정하지 않는다. [익명 실행 진단](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [로그인 사용자 실행 진단](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- 유출 비밀번호 차단 비활성화 경고. [설정 설명](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 코드 반영 상태

업체별 헤더 화면은 `task-261020-usage-headers` 브랜치와 PR #32에 있다. 운영 `main`에는 병합하지 않았다. 기존 Cursor 작업 폴더도 변경하지 않았다. 구조도는 이 브랜치의 최신 코드 기준으로 생성했으며 생성물은 기존 규칙대로 Git에 넣지 않는다.
