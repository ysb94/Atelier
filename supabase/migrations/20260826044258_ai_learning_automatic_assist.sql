-- 확정 사례 활용은 관리자가 수동 전환하지 않고 기본 동작으로 유지한다.
-- observe는 장애 대응용 내부 안전 스위치로만 남긴다.

alter table public.ai_feature_routes
  alter column learning_mode set default 'assist';

comment on column public.ai_feature_routes.learning_mode is
  '내부 안전 스위치. 일반 운영은 assist이며 observe는 장애 대응 시에만 사용한다.';

update public.ai_feature_routes
set
  learning_mode = 'assist',
  updated_at = now()
where feature_key in (
  'invoice_product_recommendation',
  'invoice_item_name_recommendation',
  'invoice_accessory_recommendation'
)
  and learning_mode is distinct from 'assist';
