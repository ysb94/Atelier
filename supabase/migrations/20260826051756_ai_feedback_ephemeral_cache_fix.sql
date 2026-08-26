-- 추천 캐시는 원장 저장 직후 삭제되는 일시 데이터다.
-- 한 캐시 응답에서 만든 여러 규칙을 병렬 저장하면 첫 저장이 캐시를 삭제하고,
-- 뒤 저장이 같은 cache_id FK를 참조해 실패한다. 피드백은 영구 원장이므로
-- cache_id를 선택적 추적 UUID로만 보존하고 일시 캐시에 FK로 묶지 않는다.

alter table public.ai_recommendation_feedback
  drop constraint if exists ai_recommendation_feedback_cache_id_fkey;

alter table public.ai_item_name_recommendation_feedback
  drop constraint if exists ai_item_name_recommendation_feedback_cache_id_fkey;

comment on column public.ai_recommendation_feedback.cache_id is
  '추천 캐시 추적 UUID. 캐시는 저장 직후 삭제될 수 있어 의도적으로 FK를 두지 않는다.';

comment on column public.ai_item_name_recommendation_feedback.cache_id is
  '추천 캐시 추적 UUID. 캐시는 저장 직후 삭제될 수 있어 의도적으로 FK를 두지 않는다.';
