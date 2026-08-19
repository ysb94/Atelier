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
| 송장 품목명 변환 기준(`invoice_name_rules`) | Supabase |
| 송장 품목명 exact 기준(`invoice_product_name_maps`) | Supabase |
| 송장 품목명 제외 기준(`invoice_product_name_exclusions`) | Supabase |
| 송장 품목명 태그 역할 사전(`invoice_product_name_tag_roles`) | Supabase |
| 송장 내품명·출고구성 기준(`invoice_option_maps` + `invoice_option_map_components`) | Supabase |
| 송장 내품명 공통·본품별·조회 키 규칙(`invoice_item_name_rules` + `invoice_item_name_rule_components`) | Supabase |
| 송장 내품명 부속품 사전(`invoice_accessory_rules`) | Supabase |
| 송장 사은품 증정 요청 건(`invoice_prefix_requests` + `invoice_prefix_items` + `invoice_prefix_item_products`, 앱 모델명 Gift) | Supabase |
| 송장 사은품 선착순 한도·배정 원장(`invoice_prefix_requests` 한도 필드 + `invoice_gift_quotas` + `invoice_gift_allocations`) | Supabase |
| 송장 작업 지시(`invoice_work_instructions` + `invoice_work_instruction_items`) | Supabase |
| 브랜드 AI 설정·사용량(`ai_feature_routes` + `ai_usage_logs`) | Supabase |

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
- 한 행 = 바코드 1건. 필수 열은 `88코드 | 바코드 상품명`이고 `M번호`는 선택이다.
- `M번호`는 쉼표·줄바꿈으로 1개 이상 적는다. 1:1·1:N 모두 가능하고 각 구성 수량은 1이다.
- `M번호`를 비우면 구성품 0개로 등록하고, 자사 바코드 화면의 `M번호 미지정` 탭에서
  행별 입력 또는 채우기 엑셀로 나중에 채운다.
- 생성만 한다. 파일 안 중복, 브랜드에 이미 있는 88코드(자사·거래처 포함),
  잘못된 체크디지트, 등록되지 않은 M번호, 같은 행의 반복 M번호는 오류로 제외하고
  나머지 정상·미지정 행만 `save_product_code_with_components`로 저장한다.
- `save_product_code_with_components`는 구성품 배열이 비어 있어도 허용한다.
- 미지정 채우기 업로드는 구성이 빈 코드만 갱신하고, 이미 M번호가 있는 코드는
  덮어쓰지 않는다.
- 바코드 엑셀의 1행 헤더는 자사 바코드 화면의 `항목 관리`에서 관리한다.
  - `88코드`, `바코드 상품명`은 식별·등록에 반드시 필요하므로 이름과 순서만 바꿀 수 있다.
  - 기본 항목(M번호·무게·규격·비고)은 삭제하면 이후 양식에서 숨기지만 기존 값은 지우지
    않는다.
  - 사용자 항목은 텍스트·숫자 유형으로 추가할 수 있고, 이름 변경·순서 변경·삭제가
    가능하다. 값은 `product_codes.values` JSONB에 `barcode_fields.id`를 키로 저장하므로
    헤더 이름을 바꿔도 기존 값이 유지된다.
- 기존 바코드 정보는 자사 바코드 화면의 `정보 일괄 수정`에서 현재 값을 XLSX로 내려받아
  수정한 뒤 다시 올린다. 88코드로 기존 행을 정확히 매칭하고, 관리 중인 헤더만 갱신한다.
  빈 칸은 기존 값을 유지하며 신규 바코드를 만들지 않는다. 바코드 상품명·M번호 변경은
  각각 단건 수정·`M번호 미지정` 흐름을 사용한다.
- 포장 규격(가로·세로·높이)의 단위는 `cm`다. DB 컬럼은 `width_cm`/`depth_cm`/`height_cm`
  (`numeric(8,1)`)이고, 0보다 큰 값만 받으며 소수 첫째 자리까지 허용한다. 무게는 정수
  `g`를 유지한다. 예전 `가로(mm)` 헤더 파일도 읽지만 값은 cm로 해석하며 단위 변환은
  하지 않는다.
- 로직: `src/lib/codes/barcode-import.ts`, 화면: `BarcodeBulkUploadPanel.tsx`,
  `PendingBarcodePanel.tsx`, `BarcodeInfoBulkPanel.tsx`, `BarcodeFieldManager.tsx`.

### 상품 연결 원칙 (M번호)

- 송장·접두어·바코드처럼 데이터 시트 상품을 가리킬 때는 이름 문자열을 저장하지 않는다.
  항상 `styles.id`(`style_id` / `target_style_id`)로 연결하고, 표시 이름은 읽을 때
  `styles.name`을 조인한다. 사람에게 보이는 번호는 `styles.style_no`(브랜드 UI에서는
  「M번호」).
- UI에서는 상품명·M번호로 검색해 고르지만, 저장 값은 `StyleRef { styleId, styleNo, name }`의
  `styleId`다. 데이터 시트에 없는 이름은 등록할 수 없다.
- FK는 `(brand_id, style_id) REFERENCES styles(brand_id, id)` 복합키를 쓴다. 연결된
  상품은 삭제가 막힌다(`product_code_components`와 동일).

### 송장 품목명 변환 기준

- `invoice_name_rules`는 사방넷 원본 식별값을 CJ 송장용 표준 품목명으로 연결한다.
  업로드한 주문 원본과 수령인·전화번호·주소는 이 테이블이나 다른 서버 저장소에 넣지 않고
  브라우저 메모리에서만 처리한다.
- 현재는 `자체품번코드` exact-match 한 단계만 실행한다. 사용자는 기준정보 화면에서
  직접 등록하거나, 주문 변환 중 미등록 코드 목록에서 처리한다. 엑셀 일괄 등록도 같은
  흐름이다.
- `action = rename`이면 `target_style_id`에 데이터 시트 상품을 저장한다. 결과 품목명은
  조인한 현재 `styles.name`을 쓴다. `target_name`은 표시용 캐시일 뿐 진짜 연결이 아니다.
  `action = exception`이면 `target_style_id`/`target_name`은 null이고 원본 품목명을 유지한다.
- 원본 문자열은 그대로 보존하고, 조회 키만 앞뒤·연속 공백과 영문 대소문자를 정규화한다.
  `(brand_id, match_type, normalized_source_value)`를 유일하게 만들어 같은 단계의 모순된
  결과가 저장되지 않게 한다.
- RLS는 `app.can_read_brand` / `app.can_edit_brand`를 사용한다. 임의 샘플 규칙은
  DB와 앱 코드 어디에도 두지 않는다. 직접 저장한 실제 기준만 `is_test = false`로
  관리한다.
- 마이그레이션:
  `20260811080000_create_invoice_name_rules.sql`,
  `20260811080100_seed_invoice_name_rule_tests.sql`,
  `20260811083000_add_invoice_name_rule_actions.sql`,
  `20260811090000_remove_invoice_sample_data.sql`,
  `20260813100000_invoice_links_by_style.sql`.

### 송장 품목명 exact 기준

- `invoice_product_name_maps`는 사방넷 원본 품목명(+내품명 문맥)을 본품 `styles.id`로만
  연결한다. 내품명 문자열을 출력하지 않는다. 세트 구성품은 같은 화면에서
  `invoice_option_maps`에 따로 저장한다.
- 키는 두 가지다. 조합 키는
  `(brand_id, normalized_mall_name, normalized_product_name, normalized_item_name_context)`,
  기존 원장 키는 `lookup_key` 한 열이며 `(brand_id, normalized_lookup_key)`가 unique다.
  `item_name_context`는 조회 키일 뿐 출력값이 아니다.
- `lookup_key`는 기존 시트 수식이 만든 문자열 그대로다. 내품명·쇼핑몰 열이 없는
  `변경전 → 변경후` 원장은 변경전 값을 `lookup_key`로 넣는다.
- 품목명 원장 양식은 `조회 키` · `본품 M번호` 2열이다. M번호를 `styles.id`로
  연결하고 공식 명칭은 조인한 현재 `styles.name`을 쓴다. 상품명이 바뀌어도 원장을
  고치지 않는다. 예전 `변경전 / 변경후` 공식명 원장도 호환용으로 계속 읽는다.
  양식에 `작성안내`와 `조회키만드는법` 시트를 함께 넣는다.
- `현재 원장 내려받기`는 DB에 실제 저장된 활성·중지 기준을 모두 내리고, 현재
  `styles.style_no`·`styles.name`과 활성 상태를 함께 적어 등록 여부를 확인하게 한다.
- 쇼핑몰·내품명 열이 있는 원장이나 사례집은 조합 방식으로 읽는다. 한 파일에 `조회 키`를
  채운 행과 비운 행이 섞여도 행마다 갈라 처리한다.
- 조회 키와 본품은 1:1이다. 한 키가 두 `styles.id`를 가리키면 unique 인덱스가 막고,
  가져오기에서는 충돌로 남긴다. 서로 다른 키가 같은 본품을 가리키는 것은 허용한다.
- 후보 문자열은 `src/lib/invoice/product-name-patterns.ts`가 아래 순서로 만든다.
  내품명 구간은 괄호를 보지 않고 항상 첫 구분자에서만 자른다. 원문 품목명 후보를
  먼저 만들고, 저장된 태그 역할이 상품 구성이 아니면 그 태그를 뺀 품목명 후보를
  뒤에 추가한다. 비교 키는 HTML 엔티티를 푼 뒤 NFKC·소문자화하고 공백·특수기호를
  제거한 압축 키다. 조회 키 원장과 조합 원장에 같은 우선순위를 적용한다.
  자체상품코드는 파일 확인·참고용으로만 두고 품목명 조회 키 후보에 넣지 않는다.
  1. `품목명` 단독
  2. `품목명 + " " + 내품명 전체`
  3. `품목명 + " " + 내품명 첫 / 앞`
  4. `품목명 + " " + 내품명 첫 , 앞`
  5. `품목명 + " " + "Color: 값"` (`Color:` 라벨을 키에 남긴다)
  6. `품목명 + " " + 내품명 첫 : 앞`
  7. `내품명 첫 / 앞` 단독
  8. `내품명 첫 , 앞` 단독
  9. `내품명 전체` 단독
- 옵션값 단독·SSG `/` 뒷부분은 오탐이 커서 자동 후보로 만들지 않는다. 7·8번은
  구분자 앞·뒤가 모두 있을 때만 만든다. 왼쪽 후보가 먼저 맞으면 그 값이 정답이다.
  같은 압축 키가 서로 다른 M번호를 가리키면 충돌로 남긴다. 후보가 하나여도 기준을
  자동 저장하지 않는다.
- 7·8번이 품목명 원장과 맞으면 사용한 앞부분과 구분자를 소비하고 남은 suffix를
  내품명 단계 입력으로 넘긴다. 9번 내품명 전체가 `lookup_key`와 맞으면 본품을
  확정하고 내품명을 빈 값으로 소비한다. 품목명과 결합된 후보나 `styles.name` 직접
  후보는 내품명을 바꾸지 않는다. 전체 소비된 행은 내품명 검토 목록에 나타나지
  않는다.
- 제품군·색상·사이즈를 분해해 짜맞추는 매칭은 쓰지 않는다. 색상 토큰 하나만 걸려도
  다른 상품을 확정해 오탐이 잦았다. 그 자리는 AI 추천이 맡고, 확정은 원장 등록으로만
  한다.
- 공식명 후보가 `styles`에 없으면 `M번호 발급 필요`, 둘 이상이면 충돌, 고를 수 없으면
  검토 필요로 남긴다.
- RLS는 `app.can_read_brand` / `app.can_edit_brand`를 사용한다.
- 마이그레이션: `20260813190000_invoice_product_name_maps.sql`,
  `20260813200000_invoice_product_name_lookup_key.sql`.

### 송장 품목명 제외 기준

- `invoice_product_name_exclusions`는 특정 쇼핑몰의 원본 품목명·내품명 exact
  조합을 최종 송장·출고 처리에서만 빼는 기준이다. 본품 `styles.id`를 두지 않으며
  상품 연결 원장과 섞지 않는다.
- 고유 키는 `(brand_id, normalized_mall_name, normalized_product_name,
  normalized_item_name)`이다. 쇼핑몰명을 비운 모든 쇼핑몰 규칙은 허용하지 않는다.
- 주문번호·수취인·주소 같은 개인정보는 저장하지 않는다. 원본 쇼핑몰명·품목명·
  내품명, 활성 상태, 메모만 둔다. `선택안함` 같은 값은 시드하지 않고 송장 검토
  화면에서 사용자가 저장한다.
- 원본 업로드 행은 보존한다. 변환은 먼저 기존 본품 판정을 한 뒤 제외 규칙을
  겹친다. 같은 주문(`쇼핑몰 + 고객주문번호 + 주문일시`)에 `mapped` 또는
  `candidate` 본품 행이 있을 때만 `송장 제외`로 확정한다. 고객주문번호가 없거나
  정상 형제 행이 없으면 `제외 보류`로 원문을 유지하고 검토 건수에 남긴다.
- 내품명이 실제 상품명인 조합은 키가 다르므로 제외되지 않고 기존 본품 탐색을
  계속 사용한다. 최종 CJ 13열과 출고구성에서만 확정 제외 행을 빼고,
  `sourceRowNumber`는 보존한 채 출력 `rowNumber`만 다시 매긴다.
- RLS는 `app.can_read_brand` / `app.can_edit_brand`를 사용한다.
- 마이그레이션: `20260819140000_invoice_product_name_exclusions.sql`.

### 송장 품목명 태그 역할 사전

- `invoice_product_name_tag_roles`는 브랜드별 품목명 맨 앞 `[태그]` 역할 사전이다.
  사방넷 원본 품목명과 태그 원문은 덮어쓰지 않는다. 역할은 상품 인식 후보만 조정한다.
- 고유 범위는 `(brand_id, normalized_tag)`다. `normalized_tag`는 앱
  `normalizeInvoiceText`와 같은 exact 비교 키이거나, 날짜만 다른 예약배송처럼
  묶는 계열 키(`family:reservation_shipping_date`)다.
- `[8/21예약배송]`, `[8/21 예약배송]`, `[8월 21일 예약배송]`은 같은 예약배송
  계열이다. 한 번 역할을 저장하면 다른 날짜에도 재사용한다. 예전 exact 행
  (`[8/14예약배송]`)도 같은 계열로 읽는다. 원문 태그는 덮어쓰지 않는다.
- 역할은 다섯 가지다.
  - `product_composition`: `[SET]`·세트·실제 포함 구성. 상품 인식 비교에 남긴다.
  - `event_marketing`: 행사·마케팅·예약배송. 상품 인식 후보에서 제외한다.
  - `composition_gift`: 증정·사은. 상품 인식 후보에서 제외하고 메타데이터로만
    보존한다. 출고구성·사은품·작업 지시와 연결하지 않는다.
  - `identity_condition`: 리퍼브 등 상품 특징·상태. 상품 인식 후보에서 제외한다.
  - `unknown`: 미분류. 사용자가 역할을 저장하기 전에는 원문을 유지한다.
- 예약배송·`1+1`·증정·세트·리퍼브 같은 휴리스틱은 화면 추천에만 쓴다. 사용자가
  역할을 저장하기 전에는 매칭에 반영하지 않는다.
- 매칭은 압축 키 우선순위 후보로 조회 키 원장과 조합 원장을 함께 본다. 서로 다른
  상품이 맞으면 자동 확정하지 않고 충돌로 남긴다.
- RLS는 `app.can_read_brand` / `app.can_edit_brand`를 사용한다.
- 로직: `src/lib/invoice/product-name-tags.ts`.
  저장소: `src/lib/supabase/invoice-product-name-tag-roles.ts`.
-   마이그레이션: `20260814035922_invoice_product_name_tag_roles.sql`,
  `20260814041855_invoice_product_name_tag_role_family.sql`,
  `20260818090000_invoice_product_name_tag_product_composition.sql`.

### 송장 내품명 공통·본품별·조회 키 규칙

- `invoice_item_name_rules`는 품목명 단계가 소비하고 남은 유효 내품명을 지우거나
  출고 구성품 M번호로 연결한다. 쇼핑몰·원본 품목명은 보지 않는다.
- `scope`는 `global`(브랜드 전체 공통), `main_style`(확정 본품 `styles.id`별, 호환
  유지), `lookup_key`(확정 본품 + 품목명 단계 조회 키 exact)다. 본품이 아직
  확정되지 않은 행에는 `main_style`·`lookup_key` 규칙을 적용하지 않는다.
- `lookup_key`는 `product_lookup_key` / `normalized_product_lookup_key`를 채운다.
  조회 키가 다른 행은 독립 규칙이다. 같은 조회 키가 다른 본품으로 재연결되면
  기존 exact 규칙을 적용하지 않고 다시 검토 대상으로 돌아온다.
- 화면의 새 저장 경로는 `global`과 `lookup_key`다. `main_style`은 기존 규칙을
  읽기 위해 유지하고, 신규 저장 UI에서는 만들지 않는다. 기존 본품 전체 규칙
  `M0885` + `Color: [신상]하트 레오파드 모브블루_RB` + 지우기는
  `docs/backups/invoice-item-name-rule-m0885-pre-20260819.xlsx`로 백업한 뒤
  삭제하지 않고 `is_active=false`로 중지했다.
- `action`은 `delete`(최종 내품명 빈칸, 구성품 없음) 또는 `components`(구성품
  M번호·역할·수량을 저장 순서대로 연결)다. 구성품 모드의 최종 내품명은 각 구성품의
  최신 `styles.name`을 `공식명×수량 + 공식명` 형식으로 붙인다. 수량 1은 `×1`을 쓰지
  않는다.
- 구성품 `role`은 출고 행 개수·수량·최종 품목명·최종 내품명 어디에도 쓰이지 않고
  출고구성 XLSX의 `역할` 열 표시에만 쓰인다. 업체마다 기준이 달라 작업자가 외울 수
  없으므로 화면에서 역할 드롭다운을 없애고 신규 저장은 모두 `included`로 넣는다.
  컬럼과 출고구성 `역할` 열은 예전에 `required`·`paid_add`로 저장된 건과 본품·사은품·
  포장재 구분을 위해 그대로 유지한다. 화면에서 남는 입력은 M번호와 나가는 수량이다.
- 적용 우선순위는 `조회 키 exact → 기존 본품 전체 → 공통 → 기존 invoice_option_maps
  → 부속품 사전 → 원문 유지`다. 사람이 박은 규칙이 항상 사전보다 앞선다. 기존 7개
  `invoice_option_maps` 행은 백필하지 않고 dual-read로만 읽는다.

### 송장 내품명 부속품 사전

- `invoice_accessory_rules`는 옵션 문구에서 태슬·스트랩·키링 같은 부속품
  M번호를 찾는 사전이다. 인식 결과는 저장하지 않고 매 파일마다 다시 계산한다.
- `rule_type`은 `label`(라벨 별칭→종류), `color`(색상 별칭→한글 색상),
  `token`(문구→`styles.id`), `ignore`(버릴 조각), `default`(라벨이 없을 때 본품
  조회 키로 종류를 정함)다.
- `label`/`default`는 `accessory_kind`와 `name_prefix`를 가진다. 색상을 붙인
  이름(`태슬 - 레드`, `컬러스트랩 블랙`)으로 `styles.name`을 찾는다.
- 활성 유일은 `(brand_id, rule_type, normalized_pattern)`이다.
- 인식한 부속품이 확정 본품과 같고 가격 꼬리표가 없으면 되풀이로 보고 버린다.
  가격 꼬리표(`(+3300)`)가 있으면 추가로 본다. 같은 M번호가 여러 슬롯에 있으면
  수량으로 합친다. 값이 조회 키에 이미 있으면 본품 속성으로 버린다.
- 모르는 조각이 하나라도 있으면 자동 적용하지 않고 검토로 남긴다. 지우기 규칙은
  저장하지 않는다. 조각이 전부 본품 속성이면 내품명을 비운다.
- 초기값은 마이그레이션에 넣지 않는다. 기준정보 `부속품 사전` 탭의 「권장 사전
  등록」으로 실측 목록을 확인한 뒤 넣는다.
- RLS는 `app.can_read_brand` / `app.can_edit_brand`를 사용한다.
- 로직: `src/lib/invoice/accessory-resolve.ts`.
  저장소: `src/lib/supabase/invoice-accessory-rules.ts`.
  화면: `InvoiceAccessoryRuleTable`.
- 마이그레이션: `20260819180000_invoice_accessory_rules.sql`.
- 조회 키 선택 저장은 체크한 행만 제한된 동시성으로 저장하고, React Query 캐시는
  마지막에 한 번만 갱신한다. 부분 실패 시 성공/실패 건수와 실패 조회 키를 남긴다.
- 건수가 많으면 엑셀로 일괄 등록한다. 양식은 8열이다.
  `1 확정 본품 M번호 · 2 조회 키 · 3 옵션명 · 4 조회 키 선택 · 5 지우기 ·
  6 구성품 M번호 · 7 메모 · 8 대상 행`.
- 4·5열은 Y 한 글자만 보는 플래그다. 업체마다 기준이 다른 낱말을 작업자가 외우지
  않도록 `적용 범위`·`동작` 같은 자유 문자열 열을 두지 않는다. 4열이 Y면
  `lookup_key`, 비면 `global`이다. 5열이 Y면 `delete`, 비면 `components`다.
  `Y·y·O·ㅇ·예·V·1·true·✓`를 참으로 읽는다.
- 4열을 비워 공통 규칙으로 바꿀 때 1·2열에 값이 남아 있어도 오류로 막지 않고
  무시한다. 검토 목록에서 내려온 값을 일일이 지우게 하지 않는다.
- 5열과 6열을 모두 비운 행은 `안 정함`으로 건너뛴다. 오류가 아니다. 검토 목록은 한
  번에 수백 행이 내려오므로 필요한 행만 채워 올리는 것이 정상 흐름이다.
- 구성품이 여러 개면 6열 한 칸에 `M1999,M1999,M2000`처럼 쉼표로 나열하고 **같은
  M번호를 반복한 횟수가 수량**이다. 행을 복사해 늘리지 않는다. 8열 `대상 행`은
  참고용이며 올릴 때 무시한다.
- 1·2·3·4열이 같은 여러 행은 한 규칙으로 합치고 구성품을 누적한다. 그 그룹에
  지우기와 구성품이 섞이면 오류로 막는다. 미등록 M번호, 4열이 Y인데 1·2열 누락,
  5열과 6열 동시 기입, 6열에 유효한 M번호가 없는 구성품 규칙도 오류다.
- 올린 결과는 `신규`·`덮어쓰기`·`변화없음`·`안 정함`·`오류`로 갈라 보여주고 사람이
  확인한 뒤 신규·덮어쓰기만 반영한다. 이미 같은 동작·구성품으로 저장돼 있으면
  `변화없음`으로 두고 저장 호출을 하지 않는다. 조회 키·옵션명 비교는 정규화 키를
  쓴다. 미리보기는 `안 정함`을 뒤로 밀어 처리 대상이 먼저 보이게 한다.
- 내품명 변환 단계의 `검토 목록 내려받기`는 검색·필터에 걸린 모든 내품명의 조회 키
  중 본품이 확정됐고 아직 규칙이 없는 건만 양식 형태로 내린다. 1·2·3열과 4열 `Y`,
  8열 `대상 행`을 채워 두고 5·6·7열만 비운다. 열은 헤더 이름으로 찾으므로 열 순서가
  달라도 읽는다.
- 구성품 규칙은 기존 세트 구성품과 병합한다. 같은 M번호가 겹치면 한 번만 출고하고
  규칙 쪽 수량을 쓴다. 펼친 CJ 행과 출고구성 XLSX의 관련 구성행에는 같은 최종
  내품명을 복사한다.
- 처음부터 빈 내품명과 품목명 단계에서 전체를 소비한 내품명은 규칙을 보지 않고
  검토 목록에서 뺀다.
- 활성 공통 규칙은 `(brand_id, normalized_item_name)`, 활성 본품별 규칙은
  `(brand_id, main_style_id, normalized_item_name)`, 활성 조회 키 규칙은
  `(brand_id, main_style_id, normalized_item_name, normalized_product_lookup_key)`에서
  하나만 허용한다.
- RLS는 `app.can_read_brand` / `app.can_edit_brand`를 사용한다.
- 마이그레이션: `20260818120000_invoice_item_name_rules.sql`,
  `20260819153000_invoice_item_name_rule_lookup_key.sql`,
  `20260819180000_invoice_accessory_rules.sql`.

### 송장 내품명·출고구성 기준

- `invoice_option_maps`는 품목명·내품명 단계에서 출고구성을 저장한다. 품목명 원장
  (`invoice_product_name_maps`)은 대표 본품 1개만 두고, 복수 M번호는 이 테이블의
  구성품으로 저장한다. 신규 내품명 규칙이 있으면 그 규칙이 우선한다. 주문 원본과
  수령인 개인정보는 저장하지 않는다.
- 구성은 `invoice_option_map_components.style_id`로만 연결한다. 역할은 `main`(본품 1개),
  `included`(기본포함), `required`(필수옵션), `paid_add`(유료추가)다. 수량은 주문 1행당
  구성 수이고, 최종 CJ 수량과 출고구성 수량은 모두 `내품수량 × 구성 수량`이다.
- `display_item_name`이 있을 때만 CJ 내품명을 바꾼다. 비우면 원문을 유지하며 `-`나
  `포함:M번호...`로 덮지 않는다. 품목명 원장이 내품명 전체 단독으로 본품을 확정한
  행만 내품명을 비운다. 원본·유효 내품명이 처음부터 비어 있으면 빈칸으로 통과하고
  검토 목록에 넣지 않는다. 내품명 `/`·`,` 앞부분 단독으로 맞춘 행은 남은 suffix를
  내품명 기준으로 쓰고, 없으면 원문 조합 원장을 fallback한다. 세트 구성 저장만으로는
  내품명을 바꾸거나 비우지 않는다.
- unique는 `(brand_id, normalized_mall_name, normalized_product_name, normalized_item_name)`이다.
  쇼핑몰명을 비우면 모든 쇼핑몰에 적용한다. 자체상품코드는 참고용이며 단독 정답이 아니다.
- 매칭은 쇼핑몰+품목+내품 exact-match, 없으면 전쇼핑몰+품목+내품이다. 승인된
  `display_item_name`이 없으면 원문 유지/검토 필요로 남긴다. 처음부터 비어 있는
  내품명은 예외로 빈칸 통과한다. 구성만 저장된 기준은 세트 행 확장에만 쓰고
  내품명 완료로 보지 않는다. 빈 내품명에 구성만 있으면 구성은 펼치고 검토는 생략한다.
- 일반 상품은 원본 주문 1행이 CJ 13열 1행이다. 추가 구성품이 있으면 본품 다음에
  구성품 저장 순서대로 행을 펼친다. 각 행은 수령인·주소·전화·주문번호 등 원본
  13열을 복사하고, 품목명만 해당 M번호의 현재 공식명으로 바꾼다. 변환된 내품명은
  모든 구성행에 동일하게 복사한다. 사은품은 그 세트 블록 뒤에 한 번만 삽입한다.
  M번호별 출고구성 XLSX도 같은 수량 규칙을 쓴다.
- `품목명 변환` 단계 스냅샷부터 저장된 구성품을 여러 행으로 펼친다. 내품명 전체로
  본품을 찾아 소비한 행은 이 단계부터 내품명을 비우고, 앞부분만 소비한 행은 suffix를
  보여 주며, 나머지는 원문을 유지한다. `내품명 변환` 단계부터 승인된 변환 내품명을
  모든 구성행에 적용한다.
- RLS는 `app.can_read_brand` / `app.can_edit_brand`를 사용한다.
- 마이그레이션: `20260813180000_invoice_option_maps.sql`,
  `20260818120000_invoice_item_name_rules.sql`,
  `20260819153000_invoice_item_name_rule_lookup_key.sql`,
  `20260813190000_invoice_product_name_maps.sql`,
  `20260813200000_invoice_product_name_lookup_key.sql`.

### 브랜드별 AI 설정

- `ai_feature_routes`는 브랜드·기능마다 제공자(`openai|anthropic|gemini`)와
  모델 ID만 저장한다. API 키는 DB·Git·브라우저에 두지 않고 Edge Function
  Secret(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)에만 둔다.
- 기본 정책은 `hybrid_auto`다. 확정 원장·등록 이력·유사도 1위가 충분하면
  AI를 건너뛰고, 후보가 없거나 저신뢰 1개면 수동 확인, 2개 이상이 애매할
  때만 상위 6개를 AI에 보낸다. 임계값은 로컬 정밀도 검증으로 맞추며 일반
  화면에서는 직접 고치지 않는다.
- `ai_recommendation_cache`는 브랜드·모델·입력 fingerprint로 추천을 공유한다.
  `ai_recommendation_feedback`는 기존 `등록`이 성공한 결과만 남긴다.
  원장 저장과 피드백은 `save_invoice_product_name_map_with_feedback` 한
  트랜잭션으로 처리한다. 등록은 관련 조회 키 캐시만 지운다. 다른 조합은
  후보 fingerprint가 바뀌면 키가 달라져 자연히 무효가 된다. 모델·정책
  변경처럼 전체 초기화가 필요할 때만 1인자
  `app.invalidate_ai_recommendation_cache(brand_id)`를 쓴다.
- `ai_usage_logs`는 토큰, `resolution_source`, 캐시 적중, AI 생략 여부를
  남긴다. 프롬프트·응답 원문과 주문자 개인정보는 저장하지 않는다.
- 본품 확인 화면의 `AI 추천 일괄 검토`는 추천을 모으는 단계와 원장에 쓰는
  단계를 나눈다. `추천 모으기`는 남은 내품명을 순회해 추천 1순위를 목록으로만
  만들고 원장을 건드리지 않는다. 사람이 목록에서 고른 항목만 `등록`으로
  저장한다. AI가 스스로 원장을 바꾸는 경로는 두지 않는다.
- 확실도 `decision_config.high` 이상이면 기본 선택하고, 미만이면 선택을 풀어
  둔 채 보여준다. 사람이 직접 체크하면 미달 항목도 등록할 수 있고 그때는
  검토 사유에 남긴다. 추천을 못 받은 항목은 이유와 함께 목록 밖에 남긴다.
- 한 번의 등록에서 같은 조회 키는 한 번만 저장해 원장 중복을 막는다. 목록에도
  중복을 표시하고 기본 선택에서 뺀다.
- 추천은 펼친 그룹에서만 계산되므로 최종 품목명에 곧바로 흘려보내지 않는다.
  출력은 언제나 원장에 등록된 값만 쓰고, 등록은 사람이 승인한 일괄 검토나
  개별 `등록`을 거친다. 등록 내역은 최근 저장 목록에서 되돌릴 수 있다.
  로직: `src/features/logistics/useInvoiceProductNameBulkAiApply.ts`.
- 유사 후보는 `app.search_invoice_product_candidates_core`가 브랜드 권한을
  한 번만 검사한 뒤 exact → 원장 trigram → 상품명 trigram 순으로 고른다.
  `public.search_invoice_product_candidates`는 기존 시그니처의 래퍼다.
- 읽기는 `app.can_read_brand`, 설정 쓰기는
  `app.is_admin() or app.is_brand_lead(brand_id)`다. 일반 멤버는 선택된
  설정으로 추천만 요청한다.
- 게이트웨이는 `supabase/functions/ai-gateway` 하나다. 앱 API는
  `src/lib/supabase/ai-settings.ts`, `ai-gateway.ts`, `ai-candidates.ts`다.
- 부속품 사전 추천은 별도 `feature_key = invoice_accessory_recommendation`이다.
  처음에는 품목명 추천 라우트를 한 번 복사하고, 이후 AI 설정에서 따로 바꿀 수
  있다. action은 `recommend_accessory_rules`다. 미인식 조각의 후보를 모아
  사람이 체크·수정한 항목만 저장한다. AI가 사전을 직접 바꾸는 경로는 두지
  않는다. 제공한 상품 후보 밖의 M번호와 효과 없는 후보는 보류한다.
  `ignore` 후보는 기본 선택하지 않는다.
- 전역 사전(`invoice_accessory_rules`)은 모든 본품·조회 키에 같은 조각 규칙이
  안전할 때만 쓴다. dry-run은 문맥별로 미인식이 늘거나 기존 결과가 깨지면
  통과시키지 않는다. `Pink` 같은 단색 단어 token, 일부 문맥만 해결하는 규칙,
  문맥별 결과가 다른 규칙은 기본 선택하지 않는다.
- 전역 규칙이 위험하면 같은 검토 목록에 `lookup_key` exact 내품명 규칙 초안을
  올린다. 고유 키는 `(itemName, mainStyleId, productLookupKey)`이고 기존 활성
  규칙은 덮어쓰기 대상이다. 저장은 사람이 고른 전역 후보는
  `saveInvoiceAccessoryRules`, 조회 키 후보는 `saveInvoiceItemNameRules`로
  나눈다. 같은 문맥에 둘 다 고르면 조회 키 규칙만 남긴다.
  로직: `src/lib/invoice/accessory-suggest.ts`,
  `src/features/logistics/useInvoiceAccessoryBulkAiApply.ts`.
- 마이그레이션: `20260814013200_ai_feature_routes.sql`,
  `20260814025900_ai_hybrid_recommendation.sql`,
  `20260814033319_ai_cache_lookup_invalidate.sql`,
  `20260819190000_invoice_accessory_ai_route.sql`.

### 송장 사은품 증정 · 작업 지시

사은품 증정과 작업 지시(예: 전체 선물포장)는 역할이 다르다. 물리 테이블
`invoice_prefix_*`는 이번 단계에서 rename/drop 하지 않고, 앱 모델만
`InvoiceGiftRequest`로 부른다.

#### 사은품 증정 (`invoice_prefix_*`)

- 요청 건(`invoice_prefix_requests`)과 대상 품목(`invoice_prefix_items`) 두 단계다.
  요청 건은 제목·쇼핑몰·행사 기간(분 단위)·산정 단위(`count_basis`)·합포장
  처리(`merge_basis`)를 갖고, 항목은 원본 품목명·랜덤 여부를 담는다.
  `invoice_prefix_items.prefix`는 데이터 보존용으로 남기되 빈 값을 허용하며
  deprecated다. 나가는 제품은 `invoice_prefix_item_products.style_id`만 사용한다.
- 항목의 `product_name`은 사방넷 원본 품목명 완전 일치 키다. 데이터 시트 연결이 아니다.
- 행사 기간은 `starts_at` / `ends_at`의 `timestamp`(시간대 없음)이다. 사방넷 주문일시가
  시간대 없는 한국 벽시계 문자열(`2026-08-08 20:54`)이라 `timestamptz`를 쓰면 UTC로
  밀릴 수 있다. 앱 표준은 `YYYY-MM-DD HH:MM`이고 양끝 포함으로 비교한다.
- 매칭은 쇼핑몰명 + 원본 품목명 완전 일치이고, 주문일시가 행사 기간 안일 때만 적용한다.
  원 주문 품목명에는 접두어를 붙이지 않는다.
- 사은품 개수는 `count_basis`로 센다. `per_order`는 같은 합포장에서 주문일시가 같은
  행을 한 주문건으로 보고 1개, `per_product`는 (주문건, 품목명)당 1개,
  `per_quantity`는 내품수량 합이다. `merge_basis`가 `per_shipment`이면 합포장당
  1개로 줄인다. 합포장 키는 받는분성명 + 전화번호(숫자만) + 주소 + 쇼핑몰명이다.
- 배정 결과는 합포장마다 `사은품(1) : 현재 styles.name`부터 번호를 매긴 별도 행이다.
  수량 1, 자체품번코드 빈 값, 배송·주문 필드는 근거 원 주문 행에서 복사한다.
  품절 제외 키는 `style_id`다. M번호 상품명을 바꾸면 다음 배정부터 새 공식명이 반영된다.
- 기간이 겹치는 요청 건이 둘 이상이면 오늘 작업의 **사은품 추가** 단계에서 충돌로
  보여주고 사용자가 고른 요청 건을 쓴다.

#### 사은품 선착순 원장

- `invoice_prefix_requests.uses_first_come`이 켜진 요청만 원장을 쓴다.
- 한도 방식은 요청별 `first_come_limit_mode`로 고른다.
  - `per_style`: `invoice_gift_quotas`의
    `(brand_id, request_id, style_id)`별 행사 배정수량을 쓴다. 같은 M번호가 여러
    대상 품목에 쓰여도 요청 안에서 한 quota를 공유한다.
  - `shared_total`: `first_come_total_limit`을 쓰며, 선택한 모든 M번호에서 실제로
    나가는 사은품 수의 합계가 이 수량에 도달하면 종료한다. 예를 들어 여러 종류의
    사은품을 섞어도 전체 100개가 확정되면 끝난다.
- `invoice_gift_allocations`는 실제 사은품 1개당 1행이다. 사용량·잔여는 활성
  배정 합계로 계산하며 별도 가변 카운터를 두지 않는다.
- 주문 식별은 쇼핑몰명 + 고객주문번호 + 주문일시 + 멱등 지문(`order_fingerprint`,
  `allocation_key`)만 저장한다. 수령인·전화번호·주소 등 PII는 원장에 넣지 않는다.
  주문번호가 없으면 브라우저에서 만든 비가역 익명 지문을 쓴다.
  `allocation_key`는 fingerprint·item·style·slot을 US(`0x1f`)로 이은 문자열이다
  (Postgres text에 null byte를 넣을 수 없다).
- 두 한도 방식 모두 카운트 단위는 **실제 사은품 1개**다. 고정 세트는 M번호별
  잔여가 모두 있거나 전체 합계 잔여가 세트 크기 이상일 때만 원자 배정한다.
  랜덤은 M번호별 모드에서는 잔여가 있는 M번호 중에서, 전체 합계 모드에서는 선택된
  M번호 중에서 기존 행사 배정 수가 고르게 되도록 고른다. 이미 확정된 M번호는
  재추첨하지 않는다.
- 미리보기는 DB를 바꾸지 않는다. 사은품 행/최종 XLSX 다운로드 직전에
  `confirm_invoice_gift_allocations` RPC로 원자 확정한다. 동일 파일 재실행은
  멱등키로 재사용하며 중복 차감하지 않는다. 취소된 주문은 자동 재배정하지 않는다.
- 주문 단위 해제는 `cancel_invoice_gift_allocations`다. 배정 이력이 있는 요청은
  삭제·구조 변경을 막고, 제목·메모·활성·한도 증가만 허용한다.
- 재고·예약발송 연결 원칙은 [`INVENTORY.md`](./INVENTORY.md)를 본다. 향후
  `stock_reservations`가 allocation을 참조할 수 있게 경계를 둔다.

#### 작업 지시 (`invoice_work_instructions`)

- 지시(`invoice_work_instructions`)와 대상 원본 품목명
  (`invoice_work_instruction_items`)으로 나눈다. 쇼핑몰 조건은 없다.
  적용 기간(`starts_at` / `ends_at`, `timestamp` 시간대 없음)은 선택이다.
  둘 다 null이면 중지 전까지 항상 적용하고, 있으면 사은품과 같이 주문일시가
  양끝 포함 기간 안일 때만 적용한다.
- 활성 지시만, 원본 품목명 exact-match로 모든 쇼핑몰에 적용한다. 같은 원본
  품목명은 한 지시 안에서만 unique이고, 기간이 겹치지 않으면 여러 지시에 둘 수
  있다. 기간 있는 지시와 기간 없는 지시가 겹치면 기간 있는 쪽을 쓰고, 같은
  종류의 지시가 둘 이상 맞으면 오늘 작업에서 충돌로 보여 붙이지 않는다.
- 표시 문구는 자체품번 변환이 끝난 최종 공식명 앞에 붙인다. 사은품 행에는 적용하지
  않는다. 중지(`is_active = false`)한 지시는 적용하지 않는다.
- 나가는 포장재는 `invoice_work_instruction_products.style_id`로 연결한다.
  예: Gift box L(`styles`). `count_basis`는 기본 `per_shipment`(합포장당 1개)이고
  `per_order` / `per_row` / `per_quantity`도 있다. 오늘 작업에서 적용된 행만 집계한다.
  송장에 별도 행을 만들지 않으며, 실재고 테이블은 아직 없다. 이후
  `stock_reservations`가 이 집계 수량을 예약으로 받는다.

#### 오늘 작업 최종 행 순서

```
파일 올리기 → 파일 확인 → 사은품 추가 → 작업 지시 → 품목명 변환 → 내품명 변환 → 최종 행
```

1. 원본 품목명으로 사은품 적격·배정과 작업 지시 매칭을 확정한다.
   선착순이면 기존 원장을 재사용하고 잔여 한도 안에서만 이번 예정을 계산한다.
2. 품목명 단계에서만 원본 품목명을 본품 공식명으로 바꾼다. 내품명 `/`·`,` 앞부분
   단독으로 본품을 찾은 행은 앞부분을 소비하고 남은 옵션을 내품명 단계로 넘긴다.
   내품명 전체 단독으로 본품을 찾은 행은 내품명을 빈 값으로 소비한다. 그 외 후보는
   내품명 원문을 유지한다. 미등록 조합은 품목명 검토 목록에만 나타난다.
3. 내품명 단계는 확정된 본품과 유효 내품명으로 표시명·출고구성을 계산한다.
   우선순위는 조회 키 exact → 기존 본품 전체 → 공통 → 기존 `invoice_option_maps` →
   부속품 사전 → 원문 유지다.
   지우기 규칙은 내품명을 비우고, 구성품 규칙은 최신 공식명 조합을 쓴다. 품목명
   단계에서 전체를 소비한 내품명과 처음부터 빈 내품명은 빈 값으로 두고 검토
   목록에 넣지 않는다. 세트 구성만으로는 내품명을 바꾸거나 비우지 않는다.
   사은품 행(`kind = gift`)은 미변환 목록에서 제외한다.
4. 다운로드 직전에 선착순 신규 배정을 원자 확정한 뒤, 세트면 구성품별 CJ 행을
   펼치고 각 상품 행의 최종 품목명 앞에 작업 지시 문구를 붙인다. 사은품은 그
   세트 블록 뒤에 순서대로 삽입한다. CJ 13열과 M번호 출고구성 XLSX를 따로
   내려받는다. 한 단계의 실패가 다른 열을 되돌리거나 비우지 않는다.

- 로직: `src/lib/invoice/prefix-transform.ts`, `gift-assign.ts`,
  `gift-confirm.ts`, `work-instruction-transform.ts`, `product-name-patterns.ts`,
  `product-name-tags.ts`, `product-name-transform.ts`, `item-name-transform.ts`,
  `option-transform.ts`, `option-ledger-import.ts`, `invoice-output.ts`,
  `prefix-paste.ts`, `accessory-resolve.ts`.
  저장소: `invoice-prefix-requests.ts`, `invoice-gift-allocations.ts`,
  `invoice-accessory-rules.ts`,
  `invoice-work-instructions.ts`, `invoice-product-name-maps.ts`,
  `invoice-product-name-tag-roles.ts`, `invoice-option-maps.ts`,
  `invoice-item-name-rules.ts`.
  화면: `InvoicePrefixRequestPanel/Form`, `InvoiceWorkInstructionPanel/Form`,
  `InvoicePrefixStepPanel`, `InvoiceWorkInstructionStepPanel`,
  `InvoiceOptionMapRulesPanel`, `InvoiceProductNameTransformPanel`,
  `InvoiceItemNameTransformPanel`, `InvoiceItemNameLookupKeyTable`,
  `InvoiceItemNameRuleForm`, `InvoiceItemNameRuleBulkPanel`,
  `InvoiceAccessoryRuleTable`,
  `InvoiceOutputStepPanel`.
  내품명 규칙 엑셀 파싱·양식·검토 목록: `src/lib/invoice/item-name-rule-import.ts`.
- 마이그레이션: `20260812060000_create_invoice_prefix_rules.sql`,
  `20260812070000_restructure_invoice_prefix_requests.sql`,
  `20260812080000_invoice_prefix_request_period_to_minutes.sql`,
  `20260812090000_invoice_prefix_item_outgoing_products.sql`,
  `20260812100000_invoice_prefix_request_count_basis.sql`,
  `20260813100000_invoice_links_by_style.sql`,
  `20260813110000_work_instructions_and_gift_prefix_optional.sql`,
  `20260813130000_gift_first_come_allocations.sql`,
  `20260813140000_gift_style_fk_indexes.sql`,
  `20260813150000_gift_shared_total_limit.sql`,
  `20260813160000_work_instruction_period.sql`,
  `20260813170000_work_instruction_outgoing_products.sql`,
  `20260813180000_invoice_option_maps.sql`,
  `20260818120000_invoice_item_name_rules.sql`,
  `20260819153000_invoice_item_name_rule_lookup_key.sql`,
  `20260813190000_invoice_product_name_maps.sql`,
  `20260813200000_invoice_product_name_lookup_key.sql`,
  `20260814035922_invoice_product_name_tag_roles.sql`,
  `20260814041855_invoice_product_name_tag_role_family.sql`.
- 재고 원칙: [`INVENTORY.md`](./INVENTORY.md).

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
