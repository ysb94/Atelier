# Claude 작업 지침

이 저장소에서는 먼저 `AGENTS.md`를 따른다.

Cursor·Claude·Codex는 모두 원래 폴더
`C:\Users\dbstj\OneDrive\바탕 화면\Masmarulez\코딩\Atelier`의 `261027-1`에서 작업한다.
새 브랜치·worktree·별도 clone·복사 폴더를 임의로 만들지 않는다. 각자 맡은 파일·구간만 수정하고
다른 담당의 미커밋·스테이징 변경은 보존한다. 같은 파일이 겹칠 때만 작업 순서를 조율한다.
시작 시 경로·브랜치·상태를 확인하고, 안전한 경우에만 fetch → 지정 브랜치 확인 →
`git pull --ff-only`로 동기화한다. 충돌·분기·push 거절은 임의로 합치거나 되돌리지 말고
멈춰 알린다. 일반 작업의 커밋·push는 자기 변경만 순서대로 수행하며 `main`은 건드리지 않는다.

`test`에는 작업 전체를 모아 검수한다. `main`에는 검증·빌드 통과와 사용자의 화면 확인 및
해당 기능의 운영 반영 승인이 끝난 기능만 하나씩 공개한다. test 전체를 main에 일괄 병합하지
않으며 승인 기능과 필수 의존성만 분리한다. 과거 배포 승인은 이후 기능의 공개 승인이 아니다.
두 브랜치의 DB는 현재 공유되므로 test에서도 운영 데이터 변경은 별도 승인 범위를 지킨다.

사용자가 새 브랜치나 지정 브랜치에 저장해 달라고 요청하면 **작성 AI와 관계없이 현재
Atelier 폴더의 전체 로컬 변경**을 커밋·push한다. 이때 다른 담당의 미커밋·스테이징도
포함하되 비밀값·백업·실행 기록·Git 제외 대상은 빼고, 명시적으로 요청받은 새 브랜치만
현재 HEAD에서 만든다. 저장 후 새 공유 브랜치를 유지하고 세 도구 지침의 브랜치 표기도
함께 바꾼다. 세부 절차는 `AGENTS.md`의 「전체 로컬 저장 요청」을 따른다.

코드 탐색 시 전체 검색보다 `dev-tools/structure-map/generated/ai-index.md`(`offset: 1, limit: 85`)를 먼저 읽어 파일·심볼 줄 번호를 좁히고, 코드 변경 뒤에는 `npm run structure:map`(또는 `npm run dev` 자동 감시)으로 목차를 최신화한다.

Supabase, PostgreSQL, Auth, Storage, RLS, MCP 또는 데이터 이전 작업 전에는 반드시
`docs/architecture/SUPABASE.md`를 읽고 해당 결정을 유지한다.
