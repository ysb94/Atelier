# Supabase 데이터 아키텍처 원칙

이 문서는 Atelier 사내 상품 운영 시스템의 Supabase 기준 문서다.
Supabase, PostgreSQL, Auth, Storage, RLS, MCP 또는 데이터 이전 작업 전 반드시 읽는다.

## 확정한 방향

- Supabase Organization은 특정 브랜드나 개인이 아니라 회사가 소유한다.
- Organization 이름은 법인 또는 변하지 않는 회사 영문명을 사용한다.
- 프로젝트는 브랜드가 아니라 환경별로 나눈다.
- 하나의 운영 프로젝트에서 여러 브랜드를 `brand_id`로 구분한다.
- 브랜드별 프로젝트 분리는 법적 격리, 매각, 독립 운영 등이 실제로 필요해질 때 수행한다.
- **IndexedDB는 더 이상 업무 데이터 저장소가 아니다.** 업무 원본은 Supabase다.
  브라우저 UI 설정(사이드바 접힘, 탭 상태 등)만 `localStorage`에 남긴다.
  예전 브라우저 IndexedDB 데이터는 앱이 열지 않으며, 화면과 다른 브라우저에 영향을 주지 않는다.

## 현재 운영 상태

- Organization: `E&J` (Free 플랜)
- Project: `Atelier` (ref `pmzgdqvtzwfwqmvhzcyo`, region `ap-northeast-2`, PostgreSQL 17)
- 이 프로젝트를 앞으로의 운영(prod)으로 본다.
- 지금은 스키마와 소량 실사용 입력 단계이므로 프로젝트 하나로 운영한다.
- staging 프로젝트는 전체 데이터를 처음 적재하기 직전에 만든다. 그 시점부터
  스키마 변경과 대량 작업은 staging에서 먼저 검증한다.
- 앱 연결은 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_PUBLISHABLE_KEY`를 `.env.local`에 두고
  `src/lib/supabase/client.ts`에서 읽는다. 연결 확인은 `npm run check:supabase`로 한다.
- 현재 운영 브랜드는 **ATELIER 하나**다.
  - `atelier`: `b0000000-0000-4000-8000-000000000001`

## 이전 진행 상황

업무 데이터 원본은 Supabase로 옮겼다. 앱은 IndexedDB 업무 경로를 쓰지 않는다.

| 데이터 | 현재 위치 |
| --- | --- |
| 회사, 브랜드, 팀(조직도), 프로필, 브랜드 멤버 | Supabase |
| 출시 기획(`seasons`), 브랜드 항목(`brand_fields`), 상품(`styles`) | Supabase |
| 기획안(`product_drafts` + `draft_colors` + `draft_options`) | Supabase |
| 코드·사용처(`product_codes`, `product_code_components`, `code_usage_targets`, `code_usage_assignments`) | Supabase |

- 상품·출시 기획·기획안·코드·사용처는 **0건으로 시작**한다. 자동 목업 시드를 넣지 않는다.
- `brand_fields`만 품번·상품명 등 실행에 필요한 시스템 항목 구조를 브랜드별로 깐다.
  목업 상품 값은 넣지 않는다.
- 브랜드 카드의 SKU 수는 `styles` COUNT로 `src/lib/api/index.ts`가 붙인다.
- 앱 저장소는 `src/lib/supabase/*.ts`다. 공개 API 이름은 `src/lib/api/index.ts`에 유지한다.
- 원자 작업 RPC: `save_product_draft`, `promote_product_draft`,
  `save_product_code_with_components`. `issue_draft_no`는 내부용이며 authenticated 직접 호출을 막는다.
- 브랜드 로고는 지금 `logo_url`에 data URL로 저장한다. 이후 `brands/{brand_id}/...`
  Storage 경로로 옮긴다.

## 로그인과 계정

- 로그인은 Google OAuth가 기본이다. 회사 도메인이 없어 모든 Google 계정을 받고,
  `profiles.status`가 `active`일 때만 작업장에 들어간다.
- 신규 사용자는 팀·직책·담당 브랜드를 직접 신청한다. 해당 브랜드 팀장 또는 관리자가
  승인한다. 조직도의 `운영진` 팀과 관리자 권한(`profiles.is_admin`)은 별개다.
- 팀은 Flow 조직도를 `public.departments`에 그대로 둔다. 상품 데이터 파트
  (`planning|design|md|logistics`)와는 다른 축이다.
- 권한 판별 함수는 PostgREST에 노출되지 않는 `app` 스키마의 security definer로 둔다.
  업무 행은 `app.can_read_brand` / `app.can_edit_brand`로 담당 멤버·관리자만 허용한다.
- `brands` SELECT는 로그인 사용자 전체(신청 화면용). 브랜드 목록 화면은 앱에서
  담당 브랜드만 걸러 보여 준다. INSERT/DELETE는 관리자, UPDATE는 관리자 또는 해당
  브랜드 팀장이다. `companies` SELECT는 승인된 사용자만.
- 가입 화면은 두지 않는다. Google 신규 사용자도 Auth 가입 경로를 쓰므로 자체 가입은
  켜 두고, 외부인 차단은 승인 단계가 담당한다.
- 개발 중에는 `DEV LOGIN` 버튼(`dev@atelier.local`)을 쓴다. 배포 전에
  `LoginPage` 버튼, `.env.local`의 `VITE_DEV_LOGIN_*`, Supabase 개발 계정을 지운다.
- 세션·프로필은 `src/lib/supabase/auth.tsx`, 멤버 승인은
  `src/features/settings/MembersPage.tsx`다.

## 첫 입력 흐름

앞으로 새로 기획하는 상품은 기획 단계를 거친다.

```
출시 기획 → 기획안 → 출시 확정 상품 → 데이터 시트 / 코드·사용처
```

이미 판매 중인 기존 상품은 기획 단계를 거치지 않고 먼저 적재한다.

```
일괄 업로드 → 상품(기획 미지정) → 나중에 실제 출시 기획으로 옮김
```

- `styles.season_id`는 NOT NULL이다. 그래서 시즌을 적지 않은 상품은 코드
  `UNASSIGNED`, 이름 `기획 미지정`인 보관용 `seasons` 행에 담는다. 이 행은 일괄
  업로드가 필요할 때 자동으로 만든다(`ensureUnassignedSeason`).
- 보관용 기획은 임시 보관함이다. 실제 출시 묶음이 생기면 상품의 시즌 열을 바꿔
  옮기고, 비면 지운다.
- 출시 기획이 없어도 일괄 업로드와 한건 등록을 막지 않는다.
- 코드·사용처는 상품이 생기기 전까지 빈 상태와 안내만 보여 준다.

### 자사 바코드 일괄 등록

회사에서 이미 발급한 13자리 88코드를 엑셀로 올려 자사 바코드 마스터를 채운다.
앱에서 바코드를 자동 발급하지 않는다.

- 진입점: 자사 바코드 화면의 `일괄 등록`, 또는 `데이터 · 일괄 업로드`의 자사 바코드 탭.
- 한 행 = 바코드 1건. 필수 열은 `88코드 | 바코드 상품명 | M번호`다.
- `M번호`는 쉼표·줄바꿈으로 1개 이상 적는다. 1:1·1:N 모두 가능하고 각 구성 수량은 1이다.
- 생성만 한다. 파일 안 중복, 브랜드에 이미 있는 88코드(자사·거래처 포함),
  잘못된 체크디지트, 등록되지 않은 M번호, 같은 행의 반복 M번호는 오류로 제외하고
  나머지 정상 행만 `save_product_code_with_components`로 저장한다.
- 로직: `src/lib/codes/barcode-import.ts`, 화면: `BarcodeBulkUploadPanel.tsx`.

### 수천 건 적재

- 상품 조회(`listStyles`)는 PostgREST 응답 상한에 걸리지 않도록 1000건씩 이어 읽는다.
- 일괄 업로드는 행마다 왕복하지 않는다. 기존 상품을 한 번만 읽고 메모리에서 병합한 뒤
  삽입·저장·삭제를 200건씩 묶어 보낸다. 묶음이 실패하면 그 묶음만 한 건씩 다시 시도해
  문제 행을 골라낸다.

### 데이터 시트는 읽기 전용이다

데이터 시트(`DataSheetPage`)는 값을 보여 주기만 한다. 값 수정은 내보내기 → 엑셀 →
일괄 업로드 한 경로로만 한다. 칸마다 편집·선택 상태를 들던 예전 표는 상품 2,400건
기준으로 방향키 한 번에 약 47ms가 걸려 느렸다.

- 시트는 화면에 보이는 만큼만 읽는다(`listStylesPage`). 개수는 같은 요청의
  `count: 'exact'`로 함께 받아 요청을 한 번으로 끝낸다.
- 그래서 검색·시즌·상태 필터는 브라우저가 아니라 SQL에서 걸러야 한다. 검색은
  `style_no`과 `name` 부분 일치다. `or()` 문법이 쉼표·괄호로 끊기므로 검색어에서
  문법을 깨는 문자를 지운 뒤 넘긴다.
- 내보내기는 화면 밖 행까지 필요하므로 같은 조건으로 전부 읽는 별도 경로
  (`listStylesFiltered`)를 쓴다.
- 열을 늘리거나 이름을 바꾸는 일은 시트가 아니라 항목 관리(`FieldsSettingsPage`)에서
  한다.

## 상품 대표 이미지

대표 이미지는 Supabase Storage에 올리지 않는다. 이미 운영 중인 Cloudflare R2 CDN
(`cdn2.auchee.com`)을 그대로 쓰고 DB에는 공개 주소만 둔다.

- 새 컬럼을 만들지 않는다. 주소는 `styles.values`의 이미지 항목 키에 담는다. 덕분에
  내보내기 양식과 일괄 업로드가 추가 작업 없이 그대로 동작한다.
- `brand_fields.type`에 `image`를 허용한다. 시스템 이미지 항목은 두 개다.
  - `imageUrl`(표시 이름 `대표이미지`, 공통): 품번 바로 뒤에 둔다.
  - `logisticsImageUrl`(표시 이름 `물류이미지`, 물류): 물류 열 묶음 끝에 둔다.
  - 항목 관리에서 표시 이름을 바꿀 수 있고 `image` 유형으로 열을 더 만들 수도 있다.
- 주소는 품번으로 계산한다. 규칙은 `src/lib/products/product-image.ts`의 `IMAGE_RULES`
  한 곳에 시스템 키별로 둔다. 이미지 항목마다 폴더가 다르기 때문이다. 상품 수천 건에
  값을 넣지 않아도 적용되고, 폴더나 도메인이 바뀌면 이 상수만 고친다.
  - `imageUrl` 폴더: `https://cdn2.auchee.com/Prod_Images/Clean`
  - 파일 이름: 대문자 품번 그대로(`M0001`). 소문자는 열리지 않는다.
  - 확장자: `jpg`를 먼저 시도하고 실패하면 `png`를 시도한다. 같은 폴더에 두 형식이
    섞여 있어서 하나로 고정할 수 없다.
  - 규칙이 없는 이미지 항목은 계산하지 않고 직접 넣은 주소만 쓴다.
- 칸에 직접 넣은 주소가 규칙보다 우선한다. 규칙에서 벗어난 파일이나 기존 라이브러리
  사진을 재활용할 때 쓴다. `http`로 시작하지 않는 값은 무시한다.
- 기존 R2 라이브러리(`product/`, `image/`)는 카테고리와 영문 상품명으로 경로가 짜여 있어
  품번으로 주소를 만들 수 없다. 대표 이미지는 `Prod_Images/Clean`만 쓴다.
- 파일이 없으면 CDN이 404를 주고 화면은 대체 표시로 넘어간다. 상품마다 값을 넣지 않아도
  깨진 이미지가 보이지 않는다.
- R2 목록은 `r2-worker.masmarulez-upload.workers.dev/list?type=Prod_Images`로 조회할 수
  있고 CORS가 열려 있다. 다만 1000건 초과 시 잘릴 수 있어 화면 표시에는 쓰지 않는다.
  어떤 상품에 사진이 없는지 집계하는 용도로만 검토한다.

## 단일 프로젝트 기간의 백업 방침

staging이 없는 동안에는 되돌릴 수단을 작업 전에 확보한다.

- 스키마 변경, 대량 수정 또는 삭제 전에 현재 데이터를 XLSX로 내려 스냅샷을 남긴다.
- 스냅샷 파일명에 날짜와 작업 목적을 적고 어떤 작업 직전 상태인지 알 수 있게 한다.
- 되돌릴 수 없는 작업(DROP, TRUNCATE, 조건 없는 UPDATE·DELETE)은 사용자 승인 없이
  실행하지 않는다.
- 파괴적 작업은 트랜잭션 또는 마이그레이션 파일로 남겨 재현과 역방향 절차를 확인한다.

앱 안의 대량 삭제도 같은 방침을 따른다. 데이터 · 일괄 업로드에서 `_작업` 열에 삭제로
표시한 행은 반영 직전에 대상 행이 XLSX 스냅샷으로 내려가고, 사용자가 삭제 건수를 입력해
확인해야 실행된다. 스냅샷은 내보내기와 같은 열 구성이라 그대로 다시 올리면 값이 복구된다.
다만 삭제된 `_id`는 남지 않으므로 복구된 행은 새 UUID를 받는다.

## 소유권과 인수인계

- 회사 이메일, 회사 결제수단 및 회사 비밀번호 관리 체계를 사용한다.
- 개인 이메일이나 개인 GitHub 계정 한 명에게만 소유권을 두지 않는다.
- 최소 두 명의 Organization Owner를 두고 모두 2단계 인증을 사용한다.
- 복구 코드, 도메인, 결제 정보와 관리자 계정의 인수인계 위치를 문서화한다.

## 데이터 경계

- 앱 DB에는 Supabase Organization과 별개로 `companies -> brands` 구조를 둔다.
- 상품, SKU, 기획안, 출시 기획, 브랜드 필드, 코드 및 감사 이력 등 브랜드 소유 행에는
  `brand_id NOT NULL`을 둔다.
- 기본키는 프로젝트를 옮겨도 유지되는 UUID를 사용한다.
- 사용자에게 보이는 번호는 고유 범위를 명시한다.
  - 브랜드별 품번: `UNIQUE (brand_id, style_no)`
  - 브랜드별 기획안 번호: `UNIQUE (brand_id, draft_no)`
  - 브랜드별 코드값: `UNIQUE (brand_id, code)`
- 자식 테이블은 `brand_id`를 함께 두고 `(brand_id, parent_id)` 복합 FK로
  상위·하위 브랜드가 같은지 강제한다.
- 코드 구성품·기획안 옵션처럼 실제 상품을 가리키는 관계는 JSON 배열로 저장하지 않는다.
- 직원, 부서, 공장, 거래처, 창고 등 회사 공통 데이터는 공통 테이블에 두고 브랜드와
  연결 테이블로 관계를 맺는다.
- 감사 이력에는 `company_id`, `brand_id`, 작업자, 시각, 대상, 변경 내용을 남긴다.

## 권한과 보안

- 사용자 권한은 프로필 승인 상태와 브랜드 멤버십으로 나눈다.
- 관리자(`is_admin`)는 전 브랜드, 브랜드 멤버는 담당 브랜드만 작업장에 들어간다.
- 브랜드 팀장(`brand_members.is_lead`)은 그 브랜드 신청을 승인할 수 있다.
- 화면에서 숨기는 것은 권한 제어가 아니다. DB 정책으로 직접 접근도 차단한다.
- 새 테이블을 만들면 `authenticated`에 필요한 GRANT를 함께 준다. RLS만으로는 부족하다.
- 품번 발급, 기획안의 상품 승격, 대량 변경 같은 원자적 작업은 DB 함수 또는
  신뢰할 수 있는 서버 작업에서 트랜잭션으로 처리한다.
- `service_role` 키와 개인 액세스 토큰을 브라우저 코드, 저장소 또는 문서에 넣지 않는다.
- staging이 생긴 뒤에는 MCP를 기본적으로 staging에 연결한다. 그전까지는 `Atelier`에
  직접 연결하되 조회를 우선하고, 스키마 변경·삭제·대량 수정은 명시적 승인과 백업 없이
  실행하지 않는다.

## Storage와 마이그레이션

- 파일 경로는 `brands/{brand_id}/drafts/...`, `brands/{brand_id}/products/...`처럼
  브랜드 경계를 드러낸다.
- 스키마, 함수, RLS 및 seed 변경은 재현 가능한 마이그레이션 파일로 버전 관리한다.
- staging이 있는 시점부터는 production 변경 전 staging에서 마이그레이션과 복구를 검증한다.
  단일 프로젝트 기간에는 위 백업 방침의 스냅샷으로 대체한다.
- 정기 백업과 복구 절차를 마련하고, 데이터 건수·관계·파일을 검증하는 체크리스트를 둔다.

## 브랜드를 독립 프로젝트로 분리할 때

Supabase에는 한 프로젝트에서 특정 브랜드만 버튼으로 떼는 기능이 없다. 다음 순서로
새 프로젝트에 이전한다.

1. 인수 회사 소유의 Organization과 Project를 만든다.
2. 같은 마이그레이션으로 스키마, 함수와 RLS를 배포한다.
3. 대상 `brand_id` 행과 참조하는 공통 데이터만 UUID를 유지해 복사한다.
4. 해당 Storage 파일을 복사한다.
5. Auth 사용자를 새 프로젝트에 초대하고 기존 프로필·역할과 매핑한다.
6. 행 개수, FK, 품번, 바코드, 권한, 감사 이력과 파일을 검증한다.
7. 짧은 쓰기 중단 후 연결을 전환하고 기존 데이터는 합의한 기간 동안 읽기 전용 보관한다.

## 변경 원칙

브랜드 경계, 식별자 고유 범위, 권한 모델 또는 프로젝트 분리 기준을 바꾸는 작업은
구현 전에 영향 범위와 이전 계획을 제시하고 사용자 승인을 받는다.
