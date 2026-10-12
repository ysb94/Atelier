# 송장작업 화면 구조

송장작업을 수정할 때 개발용 구조도에서 아래 파일과 직접 연결된 계산·패널을 먼저 확인한다.

| 역할 | 파일 | 수정 범위 |
| --- | --- | --- |
| 페이지 진입 | `src/features/logistics/InvoiceWorkPage.tsx` | 브랜드 진입과 페이지 진단, 제어 훅·화면 연결 |
| 기준 조회 | `src/features/logistics/useInvoiceWorkCriteria.ts` | 조회 키, 활성화 조건, 사전 조회와 스냅샷 캐시 정책 |
| 작업 제어 | `src/features/logistics/useInvoiceWorkController.ts` | 파일 세대·취소, 단계 계산, 검수·확정 조건, 단계 이동, 출고반영 |
| 화면 구성 | `src/features/logistics/InvoiceWorkView.tsx` | 단계별 기존 패널과 대화상자 배치, 이벤트 연결 |
| 공통 화면 요소 | `src/features/logistics/InvoiceWorkPanels.tsx` | 보기 탭, 기준 관리, 단계 진행·로딩·오류·스냅샷 표시 |
| 단계 정의 | `src/features/logistics/invoice-work-steps.ts` | 보기·단계 이름과 순서, 공통 초기값 |

기준 조회 훅은 계산에 필요한 입력이 만들어지는 **기존 위치**에서 각각 호출한다. 조회를 한곳으로 이동하거나 조건부로 훅을 호출하지 않는다. 작업 중 스냅샷 캐시와 브랜드별 조회 키를 유지한다.

M번호는 색상·사이즈까지 구분하는 SKU다. 품목명과 내품명 모두 동일한 검수 강도를 유지한다. 파일 형식, 쇼핑몰 연결, 기존 백업 주문 제외 승인, 저장 대기, 계산 완료·AI 완료 및 출고반영 차단 조건을 화면 구성 변경 과정에서 완화하지 않는다. 실제 판정은 기존 `src/lib/invoice/` 계산 함수와 작업 제어 훅에서 수행한다.

처리 기준과 단계 제어를 바꾸면 `npm run verify:invoice-work-pipeline`, `npm run verify:invoice-step-compute`와 관련 영역 검증을 실행한다. 페이지·대량 패널 진단은 `npm run verify:diagnostics`로 확인한다. 코드 변경 후 `npm run structure:map`으로 개발용 구조도를 갱신한다.
