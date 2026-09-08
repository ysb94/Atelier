-- 회사 AI 도우미 기능을 품목명 추천 설정에서 한 번만 복사한다.
-- 이미 있으면 덮어쓰지 않는다. 기존 추천 경로는 변경하지 않는다.

insert into public.ai_feature_routes (
  brand_id,
  feature_key,
  provider,
  model_id,
  is_active,
  recommendation_policy,
  learning_mode,
  monthly_budget_usd,
  decision_config
)
select
  brand_id,
  'company_assistant',
  provider,
  model_id,
  is_active,
  'always_ai',
  learning_mode,
  2,
  decision_config
from public.ai_feature_routes
where feature_key = 'invoice_product_recommendation'
on conflict (brand_id, feature_key) do nothing;

comment on column public.ai_feature_routes.feature_key is
  '기능 식별자. invoice_* 추천과 company_assistant.';
