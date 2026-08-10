# Atelier AI 작업 지침

## Supabase 작업

Supabase, PostgreSQL, 데이터 모델, Auth, Storage, RLS, MCP, 마이그레이션 또는 백엔드
이전과 관련된 작업을 시작하기 전에 반드시
[`docs/architecture/SUPABASE.md`](docs/architecture/SUPABASE.md)를 읽고 따른다.

핵심 결정:

- 회사 소유 Organization 하나를 사용한다.
- Project는 브랜드별이 아니라 환경별(`prod`, `staging`)로 나눈다.
- 현재는 `E&J` 조직의 `Atelier` 프로젝트 하나로 운영하고, staging은 전체 데이터를 처음
  적재하기 직전에 만든다.
- 여러 브랜드는 한 DB에서 `brand_id`로 엄격히 구분한다.
- UUID, 브랜드별 고유 제약, 브랜드 경로 Storage와 RLS를 사용해 향후 독립 이전이
  가능하게 유지한다.
- staging 이후에는 MCP를 staging 우선으로 쓴다. 단일 프로젝트 기간에는 조회를 우선하고
  파괴적 작업 전에 XLSX 스냅샷을 남긴다.
- 파괴적 작업은 사용자 승인과 백업 없이 실행하지 않는다.
- 위 경계나 권한 모델을 바꾸기 전에 사용자에게 영향과 이전 계획을 설명하고 승인받는다.
