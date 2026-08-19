-- 부속품 사전 추천 기능을 품목명 추천 설정에서 한 번만 복사한다.
-- 이미 있으면 덮어쓰지 않는다.

insert into public.ai_feature_routes (
  brand_id,
  feature_key,
  provider,
  model_id,
  is_active,
  recommendation_policy,
  decision_config
)
select
  brand_id,
  'invoice_accessory_recommendation',
  provider,
  model_id,
  is_active,
  recommendation_policy,
  decision_config
from public.ai_feature_routes
where feature_key = 'invoice_product_recommendation'
on conflict (brand_id, feature_key) do nothing;

comment on column public.ai_feature_routes.feature_key is
  '기능 식별자. invoice_product_recommendation 또는 invoice_accessory_recommendation.';
