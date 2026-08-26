-- ai_learning_v2 배포 후 advisor 보완.
-- 새 외래키의 삭제 동작과 covering index, 중복 SELECT RLS 정책을 정리한다.

alter table public.ai_item_name_recommendation_feedback
  drop constraint if exists ai_item_name_feedback_rule_fkey;

alter table public.ai_item_name_recommendation_feedback
  add constraint ai_item_name_feedback_rule_fkey
  foreign key (brand_id, rule_id)
  references public.invoice_item_name_rules (brand_id, id)
  on delete set null (rule_id);

create index if not exists ai_item_name_feedback_rule_idx
  on public.ai_item_name_recommendation_feedback (brand_id, rule_id)
  where rule_id is not null;

create index if not exists ai_item_name_feedback_user_idx
  on public.ai_item_name_recommendation_feedback (user_id)
  where user_id is not null;

create index if not exists ai_item_name_feedback_cache_idx
  on public.ai_item_name_recommendation_feedback (cache_id)
  where cache_id is not null;

create index if not exists ai_item_name_feedback_components_brand_parent_idx
  on public.ai_item_name_recommendation_feedback_components (
    brand_id,
    feedback_id
  );

create index if not exists ai_item_name_feedback_components_brand_style_idx
  on public.ai_item_name_recommendation_feedback_components (
    brand_id,
    style_id
  );

create index if not exists ai_recommendation_feedback_map_idx
  on public.ai_recommendation_feedback (map_id)
  where map_id is not null;

create index if not exists ai_recommendation_feedback_suggested_style_idx
  on public.ai_recommendation_feedback (suggested_style_id)
  where suggested_style_id is not null;

drop policy if exists ai_item_name_feedback_write_member
  on public.ai_item_name_recommendation_feedback;

drop policy if exists ai_item_name_feedback_insert_member
  on public.ai_item_name_recommendation_feedback;
create policy ai_item_name_feedback_insert_member
on public.ai_item_name_recommendation_feedback
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

drop policy if exists ai_item_name_feedback_update_member
  on public.ai_item_name_recommendation_feedback;
create policy ai_item_name_feedback_update_member
on public.ai_item_name_recommendation_feedback
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists ai_item_name_feedback_delete_member
  on public.ai_item_name_recommendation_feedback;
create policy ai_item_name_feedback_delete_member
on public.ai_item_name_recommendation_feedback
for delete
to authenticated
using (app.can_edit_brand(brand_id));

drop policy if exists ai_item_name_feedback_components_write_member
  on public.ai_item_name_recommendation_feedback_components;

drop policy if exists ai_item_name_feedback_components_insert_member
  on public.ai_item_name_recommendation_feedback_components;
create policy ai_item_name_feedback_components_insert_member
on public.ai_item_name_recommendation_feedback_components
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

drop policy if exists ai_item_name_feedback_components_update_member
  on public.ai_item_name_recommendation_feedback_components;
create policy ai_item_name_feedback_components_update_member
on public.ai_item_name_recommendation_feedback_components
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists ai_item_name_feedback_components_delete_member
  on public.ai_item_name_recommendation_feedback_components;
create policy ai_item_name_feedback_components_delete_member
on public.ai_item_name_recommendation_feedback_components
for delete
to authenticated
using (app.can_edit_brand(brand_id));
