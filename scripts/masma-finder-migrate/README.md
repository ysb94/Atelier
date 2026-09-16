# Masma Finder 이전 스크립트

적재 대상은 기존 `Atelier` 프로젝트다. 새 Supabase 프로젝트를 만들지 않는다.
Firebase 원본과 로컬 스냅샷은 검증이 끝나도 삭제하지 않는다.

1. 현재 Atelier Finder 테이블을 로컬에 백업한다.
2. Firebase 서비스 계정으로 Auth·Works·입고·이동·라벨·첨부 스냅샷을 남긴다.
3. 이메일·날짜·첨부 경로 기준으로 기존 행과 충돌 없이 병합한다.
4. 건수·FK·날짜별 건수·Storage 바이트·SHA-256 대조가 끝나면 짧은 쓰기 중지 후
   증분 스냅샷을 한 번 더 받는다.

```bash
# 0) 현재 Supabase 백업
set SUPABASE_URL=https://pmzgdqvtzwfwqmvhzcyo.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=...
node scripts/masma-finder-migrate/backup-supabase.mjs

# 1) Firebase 스냅샷
set GOOGLE_APPLICATION_CREDENTIALS=scripts/masma-finder-migrate/service-account.json
node scripts/masma-finder-migrate/export-firebase.mjs

# 2) 기존 Atelier 병합 적재
set MASMA_FINDER_SNAPSHOT=outputs/masma-finder-snapshots/<stamp>
node scripts/masma-finder-migrate/import-supabase.mjs
node scripts/masma-finder-migrate/verify-parity.mjs

# 병합 헬퍼 단위 테스트
node --test scripts/masma-finder-migrate/lib.test.mjs
```

`service-account.json`과 `outputs/masma-finder-snapshots/**`는 저장소에 올리지 않는다.
매핑 규칙은 `mapping.md`를 본다.

전환 전 Dashboard에서 Google OAuth를 켜고, Edge Function secret
`GEMINI_API_KEY`·`FIREBASE_SERVICE_ACCOUNT_JSON`을 넣는다. Firebase 원본은
검증이 끝날 때까지 삭제하지 않는다. 롤백은 masma_finder 이전 배포로 되돌린다.
