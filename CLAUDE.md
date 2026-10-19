# Claude 작업 지침

이 저장소에서는 먼저 `AGENTS.md`를 따른다.
코드 탐색 시 전체 검색보다 `dev-tools/structure-map/generated/ai-index.md`(`offset: 1, limit: 85`)를 먼저 읽어 파일·심볼 줄 번호를 좁히고, 코드 변경 뒤에는 `npm run structure:map`(또는 `npm run dev` 자동 감시)으로 목차를 최신화한다.

Supabase, PostgreSQL, Auth, Storage, RLS, MCP 또는 데이터 이전 작업 전에는 반드시
`docs/architecture/SUPABASE.md`를 읽고 해당 결정을 유지한다.
