-- 품목명·내품명 누적학습 v2.
-- 기존 원장·규칙·변환 우선순위는 유지하고 사례 기억·기능 분리·비용 추정만 추가한다.

alter table public.ai_feature_routes
  add column if not exists learning_mode text not null default 'observe'
    check (learning_mode in ('observe', 'assist')),
  add column if not exists monthly_budget_usd numeric(12, 4);

comment on column public.ai_feature_routes.learning_mode is
  'observe=사례만 수집, assist=사례로 추천 보강. 모델 변경 시 observe로 되돌린다.';
comment on column public.ai_feature_routes.monthly_budget_usd is
  '월 소프트 예산(USD). 초과해도 호출을 막지 않고 설정 화면에만 경고한다.';

insert into public.ai_feature_routes (
  brand_id,
  feature_key,
  provider,
  model_id,
  is_active,
  recommendation_policy,
  decision_config,
  learning_mode,
  monthly_budget_usd
)
select
  brand_id,
  'invoice_item_name_recommendation',
  provider,
  model_id,
  is_active,
  recommendation_policy,
  decision_config,
  'observe',
  monthly_budget_usd
from public.ai_feature_routes
where feature_key = 'invoice_accessory_recommendation'
on conflict (brand_id, feature_key) do nothing;

comment on column public.ai_feature_routes.feature_key is
  '기능 식별자. invoice_product_recommendation, invoice_accessory_recommendation, invoice_item_name_recommendation.';

alter table public.ai_recommendation_feedback
  add column if not exists map_id uuid
    references public.invoice_product_name_maps(id) on delete set null,
  add column if not exists suggested_style_id uuid
    references public.styles(id) on delete set null,
  add column if not exists outcome text not null default 'confirmed'
    check (outcome in ('confirmed', 'corrected', 'reverted')),
  add column if not exists invalidated_at timestamptz;

comment on column public.ai_recommendation_feedback.map_id is
  '확정 저장한 품목명 원장. 되돌리면 피드백을 reverted로 표시한다.';
comment on column public.ai_recommendation_feedback.suggested_style_id is
  'AI·로컬이 처음 제안한 본품. 최종 style_id와 다르면 corrected다.';
comment on column public.ai_recommendation_feedback.outcome is
  'confirmed=제안 채택, corrected=사람이 다른 본품으로 수정, reverted=원장 되돌림.';
comment on column public.ai_recommendation_feedback.invalidated_at is
  '되돌리거나 더 이상 유효하지 않은 시각. 후보 검색은 null만 본다.';

create index if not exists ai_recommendation_feedback_valid_lookup_idx
  on public.ai_recommendation_feedback (
    brand_id,
    normalized_lookup_key,
    created_at desc
  )
  where invalidated_at is null and outcome in ('confirmed', 'corrected');

drop policy if exists ai_recommendation_feedback_update_member
  on public.ai_recommendation_feedback;
create policy ai_recommendation_feedback_update_member
on public.ai_recommendation_feedback
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant update on table public.ai_recommendation_feedback to authenticated;

create table if not exists public.ai_item_name_recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  rule_id uuid,
  cache_id uuid references public.ai_recommendation_cache(id) on delete set null,
  item_name text not null,
  normalized_item_name text not null,
  main_style_id uuid,
  product_lookup_key text not null default '',
  normalized_product_lookup_key text not null default '',
  scope text not null
    check (scope in ('global', 'main_style', 'lookup_key')),
  action text not null
    check (action in ('delete', 'components')),
  suggested_action text
    check (suggested_action is null or suggested_action in ('delete', 'components')),
  source text not null
    check (source in ('manual', 'local', 'ai')),
  outcome text not null default 'confirmed'
    check (outcome in ('confirmed', 'corrected', 'reverted')),
  provider text,
  model_id text,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_item_name_feedback_brand_id_id_key unique (brand_id, id),
  constraint ai_item_name_feedback_rule_fkey
    foreign key (brand_id, rule_id)
    references public.invoice_item_name_rules (brand_id, id)
    on delete set null,
  constraint ai_item_name_feedback_main_style_fkey
    foreign key (brand_id, main_style_id)
    references public.styles (brand_id, id)
);

comment on table public.ai_item_name_recommendation_feedback is
  '내품명 규칙 저장에 성공한 확정 사례. AI 출력 자체는 학습하지 않는다.';

create index if not exists ai_item_name_feedback_item_idx
  on public.ai_item_name_recommendation_feedback (
    brand_id,
    normalized_item_name,
    created_at desc
  )
  where invalidated_at is null and outcome in ('confirmed', 'corrected');

create index if not exists ai_item_name_feedback_lookup_idx
  on public.ai_item_name_recommendation_feedback (
    brand_id,
    main_style_id,
    normalized_product_lookup_key,
    normalized_item_name
  )
  where invalidated_at is null and outcome in ('confirmed', 'corrected');

create table if not exists public.ai_item_name_recommendation_feedback_components (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  feedback_id uuid not null,
  style_id uuid not null,
  quantity integer not null default 1
    check (quantity >= 1),
  kind text not null default 'confirmed'
    check (kind in ('confirmed', 'suggested')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint ai_item_name_feedback_components_parent_fkey
    foreign key (brand_id, feedback_id)
    references public.ai_item_name_recommendation_feedback (brand_id, id)
    on delete cascade,
  constraint ai_item_name_feedback_components_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
);

comment on table public.ai_item_name_recommendation_feedback_components is
  '내품명 확정·제안 구성품. confirmed는 최종 정답, suggested는 처음 추천이다.';

create index if not exists ai_item_name_feedback_components_parent_idx
  on public.ai_item_name_recommendation_feedback_components (
    feedback_id,
    kind,
    sort_order
  );

alter table public.ai_item_name_recommendation_feedback enable row level security;
alter table public.ai_item_name_recommendation_feedback_components enable row level security;

drop policy if exists ai_item_name_feedback_select_member
  on public.ai_item_name_recommendation_feedback;
create policy ai_item_name_feedback_select_member
on public.ai_item_name_recommendation_feedback
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists ai_item_name_feedback_write_member
  on public.ai_item_name_recommendation_feedback;
create policy ai_item_name_feedback_write_member
on public.ai_item_name_recommendation_feedback
for all
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists ai_item_name_feedback_components_select_member
  on public.ai_item_name_recommendation_feedback_components;
create policy ai_item_name_feedback_components_select_member
on public.ai_item_name_recommendation_feedback_components
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists ai_item_name_feedback_components_write_member
  on public.ai_item_name_recommendation_feedback_components;
create policy ai_item_name_feedback_components_write_member
on public.ai_item_name_recommendation_feedback_components
for all
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.ai_item_name_recommendation_feedback
to authenticated;

grant select, insert, update, delete
on table public.ai_item_name_recommendation_feedback_components
to authenticated;

create table if not exists public.ai_model_pricing (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (provider in ('openai', 'anthropic', 'gemini')),
  model_id_prefix text not null,
  input_usd_per_1m numeric(12, 6) not null check (input_usd_per_1m >= 0),
  output_usd_per_1m numeric(12, 6) not null check (output_usd_per_1m >= 0),
  pricing_version text not null,
  effective_from date not null,
  effective_to date,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint ai_model_pricing_prefix_version_key
    unique (provider, model_id_prefix, pricing_version, effective_from)
);

comment on table public.ai_model_pricing is
  '앱 추정 비용용 가격표. 공식 청구액은 각 제공자 대시보드다.';

alter table public.ai_model_pricing enable row level security;

drop policy if exists ai_model_pricing_select_member
  on public.ai_model_pricing;
create policy ai_model_pricing_select_member
on public.ai_model_pricing
for select
to authenticated
using (true);

grant select on table public.ai_model_pricing to authenticated;

insert into public.ai_model_pricing (
  provider, model_id_prefix, input_usd_per_1m, output_usd_per_1m,
  pricing_version, effective_from, note
) values
  ('openai', 'gpt-5.6-sol', 5, 30, '2026-08-26', '2026-07-30', 'OpenAI list, short context'),
  ('openai', 'gpt-5.6-terra', 2, 12, '2026-08-26', '2026-07-30', 'OpenAI list'),
  ('openai', 'gpt-5.6-luna', 0.2, 1.2, '2026-08-26', '2026-07-30', 'OpenAI list'),
  ('openai', 'gpt-5.6', 2, 12, '2026-08-26', '2026-07-30', 'OpenAI mid default'),
  ('openai', 'gpt-5.4-mini', 0.75, 4.5, '2026-08-26', '2026-01-01', 'OpenAI list'),
  ('openai', 'gpt-5.4', 2.5, 15, '2026-08-26', '2026-01-01', 'OpenAI list'),
  ('openai', 'gpt-5', 2.5, 15, '2026-08-26', '2026-01-01', 'OpenAI fallback'),
  ('openai', 'gpt-4.1-mini', 0.4, 1.6, '2026-08-26', '2025-04-14', 'OpenAI list'),
  ('openai', 'gpt-4.1', 2, 8, '2026-08-26', '2025-04-14', 'OpenAI list'),
  ('openai', 'gpt-4o-mini', 0.15, 0.6, '2026-08-26', '2024-07-18', 'OpenAI list'),
  ('openai', 'gpt-4o', 2.5, 10, '2026-08-26', '2024-05-13', 'OpenAI list'),
  ('anthropic', 'claude-fable', 10, 50, '2026-08-26', '2026-01-01', 'Anthropic list'),
  ('anthropic', 'claude-opus-5', 5, 25, '2026-08-26', '2026-01-01', 'Anthropic list'),
  ('anthropic', 'claude-opus-4', 15, 75, '2026-08-26', '2025-01-01', 'Anthropic list'),
  ('anthropic', 'claude-sonnet-5', 2, 10, '2026-08-26', '2026-01-01', 'Anthropic promo through 2026-08-31'),
  ('anthropic', 'claude-sonnet-4', 3, 15, '2026-08-26', '2025-01-01', 'Anthropic list'),
  ('anthropic', 'claude-haiku-4', 1, 5, '2026-08-26', '2025-01-01', 'Anthropic list'),
  ('anthropic', 'claude-3-5-haiku', 0.8, 4, '2026-08-26', '2024-11-01', 'Anthropic list'),
  ('anthropic', 'claude-3-5-sonnet', 3, 15, '2026-08-26', '2024-06-20', 'Anthropic list'),
  ('anthropic', 'claude-3-haiku', 0.25, 1.25, '2026-08-26', '2024-03-01', 'Anthropic list'),
  ('gemini', 'gemini-3.7-flash', 0.75, 3.75, '2026-08-26', '2026-01-01', 'Google intro through 2026-12-31'),
  ('gemini', 'gemini-3.6-flash', 1.5, 7.5, '2026-08-26', '2026-01-01', 'Google list'),
  ('gemini', 'gemini-3.5-flash-lite', 0.3, 2.5, '2026-08-26', '2026-01-01', 'Google list'),
  ('gemini', 'gemini-3.5-flash', 1.5, 9, '2026-08-26', '2026-01-01', 'Google list'),
  ('gemini', 'gemini-3.1-pro', 2, 12, '2026-08-26', '2026-01-01', 'Google list <=200k'),
  ('gemini', 'gemini-3-flash', 0.5, 3, '2026-08-26', '2026-01-01', 'Google list'),
  ('gemini', 'gemini-2.5-pro', 1.25, 10, '2026-08-26', '2025-01-01', 'Google list <=200k'),
  ('gemini', 'gemini-2.5-flash-lite', 0.1, 0.4, '2026-08-26', '2025-01-01', 'Google list'),
  ('gemini', 'gemini-2.5-flash', 0.3, 2.5, '2026-08-26', '2025-01-01', 'Google list'),
  ('gemini', 'gemini-2.0-flash', 0.1, 0.4, '2026-08-26', '2025-01-01', 'Google list')
on conflict (provider, model_id_prefix, pricing_version, effective_from) do nothing;

alter table public.ai_usage_logs
  add column if not exists estimated_cost_usd numeric(14, 8),
  add column if not exists pricing_version text;

comment on column public.ai_usage_logs.estimated_cost_usd is
  '앱 추정 USD. 가격표를 모르면 null이며 호출을 막지 않는다.';
comment on column public.ai_usage_logs.pricing_version is
  '추정에 쓴 ai_model_pricing.pricing_version.';

create or replace function app.invalidate_ai_recommendation_cache(p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception 'not allowed';
  end if;
  delete from public.ai_recommendation_cache
  where brand_id = p_brand_id;
end;
$$;

create or replace function app.invalidate_ai_recommendation_cache(
  p_brand_id uuid,
  p_feature_key text,
  p_normalized_lookup_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception 'not allowed';
  end if;
  if coalesce(btrim(p_feature_key), '') = '' then
    delete from public.ai_recommendation_cache
    where brand_id = p_brand_id;
    return;
  end if;

  select coalesce(array_agg(distinct k), array[]::text[])
  into v_keys
  from (
    select app.normalize_invoice_lookup_key(t) as k
    from unnest(coalesce(p_normalized_lookup_keys, array[]::text[])) as t
  ) n
  where n.k <> '';

  if coalesce(array_length(v_keys, 1), 0) = 0 then
    delete from public.ai_recommendation_cache c
    where c.brand_id = p_brand_id
      and c.feature_key = p_feature_key;
    return;
  end if;

  delete from public.ai_recommendation_cache c
  where c.brand_id = p_brand_id
    and c.feature_key = p_feature_key
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(c.lookup_keys, '[]'::jsonb)) as t(cached_key)
      where app.normalize_invoice_lookup_key(t.cached_key) = any (v_keys)
    );
end;
$$;

revoke all on function app.invalidate_ai_recommendation_cache(uuid, text, text[])
  from public;
grant execute on function app.invalidate_ai_recommendation_cache(uuid, text, text[])
  to authenticated;

create or replace function public.invalidate_ai_recommendation_cache_for_feature(
  p_brand_id uuid,
  p_feature_key text
)
returns void
language plpgsql
security invoker
set search_path = public, app
as $$
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 AI 캐시를 지울 권한이 없습니다.';
  end if;
  perform app.invalidate_ai_recommendation_cache(
    p_brand_id,
    p_feature_key,
    array[]::text[]
  );
end;
$$;

revoke all on function public.invalidate_ai_recommendation_cache_for_feature(uuid, text)
  from public;
grant execute on function public.invalidate_ai_recommendation_cache_for_feature(uuid, text)
  to authenticated;

create or replace function public.estimate_ai_usage_cost(
  p_provider text,
  p_model_id text,
  p_input_tokens integer,
  p_output_tokens integer
)
returns table (
  estimated_cost_usd numeric,
  pricing_version text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    round(
      (
        coalesce(p_input_tokens, 0)::numeric * p.input_usd_per_1m
        + coalesce(p_output_tokens, 0)::numeric * p.output_usd_per_1m
      ) / 1000000.0,
      8
    ) as estimated_cost_usd,
    p.pricing_version
  from public.ai_model_pricing p
  where p.provider = p_provider
    and p.effective_from <= current_date
    and (p.effective_to is null or p.effective_to >= current_date)
    and (
      p.model_id_prefix = ''
      or lower(coalesce(p_model_id, '')) like lower(p.model_id_prefix) || '%'
    )
  order by length(p.model_id_prefix) desc, p.effective_from desc
  limit 1;
$$;

revoke all on function public.estimate_ai_usage_cost(text, text, integer, integer)
  from public;
grant execute on function public.estimate_ai_usage_cost(text, text, integer, integer)
  to authenticated;

create or replace function app.search_invoice_product_candidates_core(
  p_brand_id uuid,
  p_texts text[],
  p_limit integer default 20
)
returns table (
  source text,
  lookup_key text,
  style_id uuid,
  style_no text,
  style_name text,
  score double precision,
  rank integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 40));
begin
  if p_brand_id is null then
    raise exception 'brand_id is required';
  end if;
  if not app.can_read_brand(p_brand_id) then
    raise exception 'not allowed';
  end if;

  perform set_config('pg_trgm.similarity_threshold', '0.2', true);

  return query
  with queries as (
    select distinct app.normalize_invoice_lookup_key(t) as q
    from unnest(coalesce(p_texts, array[]::text[])) as t
    where length(app.normalize_invoice_lookup_key(t)) >= 3
  ),
  latest_feedback as (
    select distinct on (f.normalized_lookup_key)
      f.lookup_key,
      f.normalized_lookup_key,
      f.style_id,
      f.suggested_style_id,
      f.outcome,
      f.created_at
    from public.ai_recommendation_feedback f
    where f.brand_id = p_brand_id
      and f.invalidated_at is null
      and f.outcome in ('confirmed', 'corrected')
    order by f.normalized_lookup_key, f.created_at desc
  ),
  exact_hits as (
    select
      'ledger_exact'::text as hit_source,
      m.lookup_key as hit_lookup_key,
      m.style_id as hit_style_id,
      s.style_no as hit_style_no,
      s.name as hit_style_name,
      1.0::double precision as hit_score
    from queries q
    join public.invoice_product_name_maps m
      on m.brand_id = p_brand_id
     and m.is_active
     and m.normalized_lookup_key = q.q
    join public.styles s
      on s.id = m.style_id
     and s.brand_id = m.brand_id
  ),
  history_hits as (
    select
      'history'::text as hit_source,
      f.lookup_key as hit_lookup_key,
      f.style_id as hit_style_id,
      s.style_no as hit_style_no,
      s.name as hit_style_name,
      0.95::double precision as hit_score
    from queries q
    join latest_feedback f
      on f.normalized_lookup_key = q.q
    join public.styles s
      on s.id = f.style_id
     and s.brand_id = p_brand_id
    where not exists (
      select 1
      from exact_hits e
      where e.hit_style_id = f.style_id
    )
  ),
  lookup_hits as (
    select
      'lookup_key'::text as hit_source,
      hits.hit_lookup_key,
      hits.hit_style_id,
      hits.hit_style_no,
      hits.hit_style_name,
      hits.hit_score
    from queries q
    cross join lateral (
      select
        m.lookup_key as hit_lookup_key,
        m.style_id as hit_style_id,
        s.style_no as hit_style_no,
        s.name as hit_style_name,
        extensions.similarity(m.normalized_lookup_key, q.q)::double precision as hit_score
      from public.invoice_product_name_maps m
      join public.styles s
        on s.id = m.style_id
       and s.brand_id = m.brand_id
      where m.brand_id = p_brand_id
        and m.is_active
        and m.normalized_lookup_key <> ''
        and m.normalized_lookup_key operator(extensions.%) q.q
      order by hit_score desc
      limit 12
    ) hits
  ),
  style_hits as (
    select
      'style_name'::text as hit_source,
      hits.hit_lookup_key,
      hits.hit_style_id,
      hits.hit_style_no,
      hits.hit_style_name,
      hits.hit_score
    from queries q
    cross join lateral (
      select
        s.name as hit_lookup_key,
        s.id as hit_style_id,
        s.style_no as hit_style_no,
        s.name as hit_style_name,
        greatest(
          extensions.similarity(lower(s.name), q.q),
          extensions.similarity(lower(s.style_no), q.q)
        )::double precision as hit_score
      from public.styles s
      where s.brand_id = p_brand_id
        and (
          lower(s.name) operator(extensions.%) q.q
          or lower(s.style_no) operator(extensions.%) q.q
        )
      order by hit_score desc
      limit 8
    ) hits
  ),
  combined as (
    select * from exact_hits
    union all
    select * from history_hits
    union all
    select * from lookup_hits
    union all
    select * from style_hits
  ),
  context_boost as (
    select
      f.style_id,
      least(
        0.08::double precision,
        0.05 * max(extensions.similarity(f.normalized_lookup_key, q.q))::double precision
      ) as boost
    from queries q
    join latest_feedback f
      on f.normalized_lookup_key operator(extensions.%) q.q
     and f.normalized_lookup_key <> q.q
    group by f.style_id
  ),
  correction_penalty as (
    select
      f.suggested_style_id as style_id,
      (-0.06)::double precision as penalty
    from queries q
    join latest_feedback f
      on (
        f.normalized_lookup_key = q.q
        or f.normalized_lookup_key operator(extensions.%) q.q
      )
    where f.outcome = 'corrected'
      and f.suggested_style_id is not null
      and f.suggested_style_id is distinct from f.style_id
    group by f.suggested_style_id
  ),
  best as (
    select
      picked.hit_source,
      picked.hit_lookup_key,
      picked.hit_style_id,
      picked.hit_style_no,
      picked.hit_style_name,
      least(
        1.0,
        greatest(
          0::double precision,
          picked.hit_score
            + coalesce(cb.boost, 0)
            + coalesce(cp.penalty, 0)
        )
      ) as hit_score
    from (
      select distinct on (c.hit_style_id)
        c.hit_source,
        c.hit_lookup_key,
        c.hit_style_id,
        c.hit_style_no,
        c.hit_style_name,
        c.hit_score
      from combined c
      order by
        c.hit_style_id,
        c.hit_score desc,
        case c.hit_source
          when 'ledger_exact' then 1
          when 'history' then 2
          when 'lookup_key' then 3
          else 4
        end
    ) picked
    left join context_boost cb on cb.style_id = picked.hit_style_id
    left join correction_penalty cp on cp.style_id = picked.hit_style_id
  ),
  ranked as (
    select
      b.*,
      row_number() over (
        order by b.hit_score desc, b.hit_style_no
      )::integer as hit_rank
    from best b
  )
  select
    r.hit_source,
    r.hit_lookup_key,
    r.hit_style_id,
    r.hit_style_no,
    r.hit_style_name,
    r.hit_score,
    r.hit_rank
  from ranked r
  where r.hit_rank <= v_limit
  order by r.hit_rank;
end;
$$;

drop function if exists public.record_ai_recommendation_feedback(uuid, text, uuid, text, uuid, integer, text, text);

create or replace function public.record_ai_recommendation_feedback(
  p_brand_id uuid,
  p_lookup_key text,
  p_style_id uuid,
  p_source text,
  p_cache_id uuid default null,
  p_shown_rank integer default null,
  p_provider text default null,
  p_model_id text default null,
  p_map_id uuid default null,
  p_suggested_style_id uuid default null,
  p_outcome text default 'confirmed'
)
returns void
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_outcome text := coalesce(nullif(btrim(p_outcome), ''), 'confirmed');
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 품목명 기준을 저장할 권한이 없습니다.';
  end if;
  if p_lookup_key is null or btrim(p_lookup_key) = '' or p_style_id is null then
    return;
  end if;
  if p_source not in ('manual', 'local', 'ai') then
    raise exception '지원하지 않는 피드백 출처입니다.';
  end if;
  if v_outcome not in ('confirmed', 'corrected', 'reverted') then
    raise exception '지원하지 않는 피드백 결과입니다.';
  end if;

  insert into public.ai_recommendation_feedback (
    brand_id,
    user_id,
    cache_id,
    map_id,
    lookup_key,
    normalized_lookup_key,
    style_id,
    suggested_style_id,
    shown_rank,
    source,
    outcome,
    provider,
    model_id
  ) values (
    p_brand_id,
    auth.uid(),
    p_cache_id,
    p_map_id,
    btrim(p_lookup_key),
    app.normalize_invoice_lookup_key(p_lookup_key),
    p_style_id,
    p_suggested_style_id,
    p_shown_rank,
    p_source,
    v_outcome,
    p_provider,
    p_model_id
  );

  perform app.invalidate_ai_recommendation_cache(
    p_brand_id,
    'invoice_product_recommendation',
    array[app.normalize_invoice_lookup_key(p_lookup_key)]
  );
end;
$$;

revoke all on function public.record_ai_recommendation_feedback(uuid, text, uuid, text, uuid, integer, text, text, uuid, uuid, text)
  from public;
grant execute on function public.record_ai_recommendation_feedback(uuid, text, uuid, text, uuid, integer, text, text, uuid, uuid, text)
  to authenticated;

create or replace function public.save_invoice_product_name_map_with_feedback(
  p_brand_id uuid,
  p_row jsonb,
  p_map_id uuid default null,
  p_feedback jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_id uuid;
  v_lookup text := coalesce(btrim(p_row->>'lookup_key'), '');
  v_norm_lookup text := coalesce(btrim(p_row->>'normalized_lookup_key'), '');
  v_old_norm text := '';
  v_source text;
  v_keys text[];
  v_outcome text;
  v_suggested uuid;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 품목명 기준을 저장할 권한이 없습니다.';
  end if;
  if coalesce(btrim(p_row->>'product_name'), '') = '' or (p_row->>'style_id') is null then
    raise exception '원본 품목명과 본품을 입력하세요.';
  end if;

  if p_map_id is not null then
    v_id := p_map_id;
  elsif v_norm_lookup <> '' then
    select m.id into v_id
    from public.invoice_product_name_maps m
    where m.brand_id = p_brand_id
      and m.normalized_lookup_key = v_norm_lookup
    limit 1;
  else
    select m.id into v_id
    from public.invoice_product_name_maps m
    where m.brand_id = p_brand_id
      and m.normalized_mall_name = coalesce(p_row->>'normalized_mall_name', '')
      and m.normalized_product_name = coalesce(p_row->>'normalized_product_name', '')
      and m.normalized_item_name_context = coalesce(p_row->>'normalized_item_name_context', '')
      and m.normalized_lookup_key = ''
    limit 1;
  end if;

  if v_id is not null then
    select coalesce(m.normalized_lookup_key, '')
    into v_old_norm
    from public.invoice_product_name_maps m
    where m.id = v_id
      and m.brand_id = p_brand_id;
  end if;

  if v_id is null then
    insert into public.invoice_product_name_maps (
      brand_id,
      mall_name,
      normalized_mall_name,
      product_name,
      normalized_product_name,
      item_name_context,
      normalized_item_name_context,
      own_product_code,
      normalized_own_product_code,
      lookup_key,
      normalized_lookup_key,
      style_id,
      is_active,
      note
    ) values (
      p_brand_id,
      coalesce(p_row->>'mall_name', ''),
      coalesce(p_row->>'normalized_mall_name', ''),
      btrim(p_row->>'product_name'),
      coalesce(p_row->>'normalized_product_name', ''),
      coalesce(p_row->>'item_name_context', ''),
      coalesce(p_row->>'normalized_item_name_context', ''),
      coalesce(p_row->>'own_product_code', ''),
      coalesce(p_row->>'normalized_own_product_code', ''),
      v_lookup,
      v_norm_lookup,
      (p_row->>'style_id')::uuid,
      coalesce((p_row->>'is_active')::boolean, true),
      coalesce(p_row->>'note', '')
    )
    returning id into v_id;
  else
    update public.invoice_product_name_maps
    set
      mall_name = coalesce(p_row->>'mall_name', ''),
      normalized_mall_name = coalesce(p_row->>'normalized_mall_name', ''),
      product_name = btrim(p_row->>'product_name'),
      normalized_product_name = coalesce(p_row->>'normalized_product_name', ''),
      item_name_context = coalesce(p_row->>'item_name_context', ''),
      normalized_item_name_context = coalesce(p_row->>'normalized_item_name_context', ''),
      own_product_code = coalesce(p_row->>'own_product_code', ''),
      normalized_own_product_code = coalesce(p_row->>'normalized_own_product_code', ''),
      lookup_key = v_lookup,
      normalized_lookup_key = v_norm_lookup,
      style_id = (p_row->>'style_id')::uuid,
      is_active = coalesce((p_row->>'is_active')::boolean, true),
      note = coalesce(p_row->>'note', '')
    where id = v_id
      and brand_id = p_brand_id;
  end if;

  v_keys := array_remove(
    array[
      nullif(v_norm_lookup, ''),
      nullif(v_old_norm, ''),
      nullif(app.normalize_invoice_lookup_key(v_lookup), ''),
      nullif(app.normalize_invoice_lookup_key(p_row->>'product_name'), '')
    ],
    null
  );

  v_source := nullif(btrim(coalesce(p_feedback->>'source', '')), '');
  v_suggested := nullif(p_feedback->>'suggested_style_id', '')::uuid;
  v_outcome := coalesce(nullif(btrim(p_feedback->>'outcome'), ''), 'confirmed');
  if v_source is not null and v_suggested is not null
     and v_suggested is distinct from (p_row->>'style_id')::uuid
     and v_outcome = 'confirmed' then
    v_outcome := 'corrected';
  end if;

  if v_source is not null then
    perform public.record_ai_recommendation_feedback(
      p_brand_id,
      case when v_lookup <> '' then v_lookup else btrim(p_row->>'product_name') end,
      (p_row->>'style_id')::uuid,
      v_source,
      nullif(p_feedback->>'cache_id', '')::uuid,
      nullif(p_feedback->>'shown_rank', '')::integer,
      nullif(p_feedback->>'provider', ''),
      nullif(p_feedback->>'model_id', ''),
      v_id,
      v_suggested,
      v_outcome
    );
    if v_old_norm <> '' and v_old_norm is distinct from v_norm_lookup then
      perform app.invalidate_ai_recommendation_cache(
        p_brand_id,
        'invoice_product_recommendation',
        array[v_old_norm]
      );
    end if;
  else
    perform app.invalidate_ai_recommendation_cache(
      p_brand_id,
      'invoice_product_recommendation',
      v_keys
    );
  end if;

  return v_id;
end;
$$;

create or replace function public.undo_invoice_product_name_map(
  p_brand_id uuid,
  p_map_id uuid,
  p_expected_updated_at timestamptz,
  p_previous jsonb default null
)
returns text
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_current public.invoice_product_name_maps%rowtype;
  v_norm_lookup text := '';
  v_old_norm text := '';
  v_keys text[];
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 품목명 기준을 되돌릴 권한이 없습니다.';
  end if;

  select *
  into v_current
  from public.invoice_product_name_maps m
  where m.id = p_map_id
    and m.brand_id = p_brand_id
  for update;

  if not found then
    raise exception '되돌릴 품목명 기준을 찾지 못했습니다.';
  end if;

  if v_current.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 곳에서 이미 바뀐 항목이라 되돌릴 수 없습니다.';
  end if;

  v_old_norm := coalesce(v_current.normalized_lookup_key, '');

  update public.ai_recommendation_feedback
  set
    outcome = 'reverted',
    invalidated_at = now()
  where id = (
    select f.id
    from public.ai_recommendation_feedback f
    where f.brand_id = p_brand_id
      and f.invalidated_at is null
      and (f.map_id = p_map_id or f.normalized_lookup_key = v_old_norm)
    order by f.created_at desc
    limit 1
  );

  if p_previous is null then
    delete from public.invoice_product_name_maps
    where id = p_map_id
      and brand_id = p_brand_id
      and updated_at is not distinct from p_expected_updated_at;

    if not found then
      raise exception '다른 곳에서 이미 바뀐 항목이라 되돌릴 수 없습니다.';
    end if;

    perform app.invalidate_ai_recommendation_cache(
      p_brand_id,
      'invoice_product_recommendation',
      array_remove(array[nullif(v_old_norm, '')], null)
    );
    return 'deleted';
  end if;

  if coalesce(btrim(p_previous->>'product_name'), '') = ''
     or (p_previous->>'style_id') is null then
    raise exception '복원할 원장 스냅샷이 올바르지 않습니다.';
  end if;

  v_norm_lookup := coalesce(btrim(p_previous->>'normalized_lookup_key'), '');

  update public.invoice_product_name_maps
  set
    mall_name = coalesce(p_previous->>'mall_name', ''),
    normalized_mall_name = coalesce(p_previous->>'normalized_mall_name', ''),
    product_name = btrim(coalesce(p_previous->>'product_name', '')),
    normalized_product_name = coalesce(p_previous->>'normalized_product_name', ''),
    item_name_context = coalesce(p_previous->>'item_name_context', ''),
    normalized_item_name_context = coalesce(
      p_previous->>'normalized_item_name_context',
      ''
    ),
    own_product_code = coalesce(p_previous->>'own_product_code', ''),
    normalized_own_product_code = coalesce(
      p_previous->>'normalized_own_product_code',
      ''
    ),
    lookup_key = coalesce(p_previous->>'lookup_key', ''),
    normalized_lookup_key = v_norm_lookup,
    style_id = (p_previous->>'style_id')::uuid,
    is_active = coalesce((p_previous->>'is_active')::boolean, true),
    note = coalesce(p_previous->>'note', '')
  where id = p_map_id
    and brand_id = p_brand_id
    and updated_at is not distinct from p_expected_updated_at;

  if not found then
    raise exception '다른 곳에서 이미 바뀐 항목이라 되돌릴 수 없습니다.';
  end if;

  v_keys := array_remove(
    array[
      nullif(v_norm_lookup, ''),
      nullif(v_old_norm, '')
    ],
    null
  );
  perform app.invalidate_ai_recommendation_cache(
    p_brand_id,
    'invoice_product_recommendation',
    v_keys
  );
  return 'restored';
end;
$$;

create or replace function app.search_invoice_item_name_cases_core(
  p_brand_id uuid,
  p_contexts jsonb,
  p_limit integer default 5
)
returns table (
  context_id text,
  source text,
  scope text,
  item_name text,
  product_lookup_key text,
  main_style_id uuid,
  action text,
  score double precision,
  components jsonb,
  rule_id uuid,
  feedback_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 8));
begin
  if p_brand_id is null then
    raise exception 'brand_id is required';
  end if;
  if not app.can_read_brand(p_brand_id) then
    raise exception 'not allowed';
  end if;

  perform set_config('pg_trgm.similarity_threshold', '0.2', true);

  return query
  with contexts as (
    select
      coalesce(nullif(btrim(c->>'contextId'), ''), '') as context_id,
      btrim(coalesce(c->>'itemName', '')) as item_name,
      app.normalize_invoice_lookup_key(c->>'itemName') as item_q,
      nullif(btrim(c->>'mainStyleId'), '')::uuid as main_style_id,
      app.normalize_invoice_lookup_key(c->>'productLookupKey') as lookup_q
    from jsonb_array_elements(coalesce(p_contexts, '[]'::jsonb)) as c
    where length(app.normalize_invoice_lookup_key(c->>'itemName')) >= 2
  ),
  rule_hits as (
    select
      ctx.context_id,
      'rule'::text as hit_source,
      r.scope as hit_scope,
      r.item_name as hit_item_name,
      r.product_lookup_key as hit_lookup_key,
      r.main_style_id as hit_main_style_id,
      r.action as hit_action,
      case
        when r.normalized_item_name = ctx.item_q
          and r.scope = 'lookup_key'
          and r.main_style_id is not distinct from ctx.main_style_id
          and r.normalized_product_lookup_key = ctx.lookup_q
          then 1.0
        when r.normalized_item_name = ctx.item_q
          and r.scope = 'main_style'
          and r.main_style_id is not distinct from ctx.main_style_id
          then 0.92
        when r.normalized_item_name = ctx.item_q
          and r.scope = 'global'
          then 0.88
        when r.normalized_item_name = ctx.item_q
          and r.main_style_id is not distinct from ctx.main_style_id
          then 0.86
        when r.normalized_item_name operator(extensions.%) ctx.item_q
          and r.main_style_id is not distinct from ctx.main_style_id
          then 0.55 + 0.3 * extensions.similarity(r.normalized_item_name, ctx.item_q)
        when r.normalized_item_name operator(extensions.%) ctx.item_q
          then 0.4 + 0.25 * extensions.similarity(r.normalized_item_name, ctx.item_q)
        else 0.0
      end::double precision as hit_score,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'styleId', c.style_id,
              'styleNo', s.style_no,
              'name', s.name,
              'quantity', c.quantity
            )
            order by c.sort_order
          ),
          '[]'::jsonb
        )
        from public.invoice_item_name_rule_components c
        join public.styles s
          on s.id = c.style_id
         and s.brand_id = c.brand_id
        where c.rule_id = r.id
      ) as hit_components,
      r.id as hit_rule_id,
      null::uuid as hit_feedback_id
    from contexts ctx
    join public.invoice_item_name_rules r
      on r.brand_id = p_brand_id
     and r.is_active
     and (
       r.normalized_item_name = ctx.item_q
       or r.normalized_item_name operator(extensions.%) ctx.item_q
     )
  ),
  latest_feedback as (
    select distinct on (
      f.normalized_item_name,
      coalesce(f.main_style_id::text, ''),
      f.normalized_product_lookup_key
    )
      f.id,
      f.item_name,
      f.normalized_item_name,
      f.main_style_id,
      f.product_lookup_key,
      f.normalized_product_lookup_key,
      f.scope,
      f.action
    from public.ai_item_name_recommendation_feedback f
    where f.brand_id = p_brand_id
      and f.invalidated_at is null
      and f.outcome in ('confirmed', 'corrected')
    order by
      f.normalized_item_name,
      coalesce(f.main_style_id::text, ''),
      f.normalized_product_lookup_key,
      f.created_at desc
  ),
  feedback_hits as (
    select
      ctx.context_id,
      'history'::text as hit_source,
      f.scope as hit_scope,
      f.item_name as hit_item_name,
      f.product_lookup_key as hit_lookup_key,
      f.main_style_id as hit_main_style_id,
      f.action as hit_action,
      case
        when f.normalized_item_name = ctx.item_q
          and f.main_style_id is not distinct from ctx.main_style_id
          and f.normalized_product_lookup_key = ctx.lookup_q
          then 0.97
        when f.normalized_item_name = ctx.item_q
          and f.scope = 'global'
          then 0.86
        when f.normalized_item_name = ctx.item_q
          and f.main_style_id is not distinct from ctx.main_style_id
          then 0.84
        when f.normalized_item_name operator(extensions.%) ctx.item_q
          and f.main_style_id is not distinct from ctx.main_style_id
          then 0.52 + 0.28 * extensions.similarity(f.normalized_item_name, ctx.item_q)
        when f.normalized_item_name operator(extensions.%) ctx.item_q
          then 0.38 + 0.22 * extensions.similarity(f.normalized_item_name, ctx.item_q)
        else 0.0
      end::double precision as hit_score,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'styleId', c.style_id,
              'styleNo', s.style_no,
              'name', s.name,
              'quantity', c.quantity
            )
            order by c.sort_order
          ),
          '[]'::jsonb
        )
        from public.ai_item_name_recommendation_feedback_components c
        join public.styles s
          on s.id = c.style_id
         and s.brand_id = c.brand_id
        where c.feedback_id = f.id
          and c.kind = 'confirmed'
      ) as hit_components,
      null::uuid as hit_rule_id,
      f.id as hit_feedback_id
    from contexts ctx
    join latest_feedback f
      on (
        f.normalized_item_name = ctx.item_q
        or f.normalized_item_name operator(extensions.%) ctx.item_q
      )
  ),
  combined as (
    select * from rule_hits where hit_score > 0
    union all
    select * from feedback_hits where hit_score > 0
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        partition by c.context_id
        order by c.hit_score desc, c.hit_item_name
      ) as hit_rank
    from combined c
  )
  select
    r.context_id,
    r.hit_source,
    r.hit_scope,
    r.hit_item_name,
    r.hit_lookup_key,
    r.hit_main_style_id,
    r.hit_action,
    r.hit_score,
    r.hit_components,
    r.hit_rule_id,
    r.hit_feedback_id
  from ranked r
  where r.hit_rank <= v_limit
  order by r.context_id, r.hit_rank;
end;
$$;

revoke all on function app.search_invoice_item_name_cases_core(uuid, jsonb, integer)
  from public;
grant execute on function app.search_invoice_item_name_cases_core(uuid, jsonb, integer)
  to authenticated;

create or replace function public.search_invoice_item_name_cases(
  p_brand_id uuid,
  p_contexts jsonb,
  p_limit integer default 5
)
returns table (
  context_id text,
  source text,
  scope text,
  item_name text,
  product_lookup_key text,
  main_style_id uuid,
  action text,
  score double precision,
  components jsonb,
  rule_id uuid,
  feedback_id uuid
)
language sql
stable
security invoker
set search_path = public, app
as $$
  select *
  from app.search_invoice_item_name_cases_core(p_brand_id, p_contexts, p_limit);
$$;

revoke all on function public.search_invoice_item_name_cases(uuid, jsonb, integer)
  from public;
grant execute on function public.search_invoice_item_name_cases(uuid, jsonb, integer)
  to authenticated;

create or replace function public.record_ai_item_name_recommendation_feedback(
  p_brand_id uuid,
  p_rule_id uuid,
  p_item_name text,
  p_scope text,
  p_action text,
  p_source text,
  p_main_style_id uuid default null,
  p_product_lookup_key text default '',
  p_cache_id uuid default null,
  p_provider text default null,
  p_model_id text default null,
  p_outcome text default 'confirmed',
  p_suggested_action text default null,
  p_components jsonb default '[]'::jsonb,
  p_suggested_components jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_id uuid;
  v_outcome text := coalesce(nullif(btrim(p_outcome), ''), 'confirmed');
  v_lookup text := coalesce(p_product_lookup_key, '');
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 내품명 기준을 저장할 권한이 없습니다.';
  end if;
  if p_item_name is null or btrim(p_item_name) = '' then
    return null;
  end if;
  if p_scope not in ('global', 'main_style', 'lookup_key')
     or p_action not in ('delete', 'components')
     or p_source not in ('manual', 'local', 'ai')
     or v_outcome not in ('confirmed', 'corrected', 'reverted') then
    raise exception '지원하지 않는 내품명 피드백 값입니다.';
  end if;

  insert into public.ai_item_name_recommendation_feedback (
    brand_id,
    user_id,
    rule_id,
    cache_id,
    item_name,
    normalized_item_name,
    main_style_id,
    product_lookup_key,
    normalized_product_lookup_key,
    scope,
    action,
    suggested_action,
    source,
    outcome,
    provider,
    model_id
  ) values (
    p_brand_id,
    auth.uid(),
    p_rule_id,
    p_cache_id,
    btrim(p_item_name),
    app.normalize_invoice_lookup_key(p_item_name),
    p_main_style_id,
    v_lookup,
    app.normalize_invoice_lookup_key(v_lookup),
    p_scope,
    p_action,
    nullif(btrim(coalesce(p_suggested_action, '')), ''),
    p_source,
    v_outcome,
    p_provider,
    p_model_id
  )
  returning id into v_id;

  insert into public.ai_item_name_recommendation_feedback_components (
    brand_id, feedback_id, style_id, quantity, kind, sort_order
  )
  select
    p_brand_id,
    v_id,
    (item->>'styleId')::uuid,
    greatest(1, coalesce((item->>'quantity')::integer, 1)),
    'confirmed',
    ordinality - 1
  from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) with ordinality as t(item, ordinality)
  where nullif(item->>'styleId', '') is not null;

  insert into public.ai_item_name_recommendation_feedback_components (
    brand_id, feedback_id, style_id, quantity, kind, sort_order
  )
  select
    p_brand_id,
    v_id,
    (item->>'styleId')::uuid,
    greatest(1, coalesce((item->>'quantity')::integer, 1)),
    'suggested',
    ordinality - 1
  from jsonb_array_elements(coalesce(p_suggested_components, '[]'::jsonb)) with ordinality as t(item, ordinality)
  where nullif(item->>'styleId', '') is not null;

  perform app.invalidate_ai_recommendation_cache(
    p_brand_id,
    'invoice_item_name_recommendation',
    array_remove(
      array[
        app.normalize_invoice_lookup_key(p_item_name),
        app.normalize_invoice_lookup_key(v_lookup)
      ],
      ''
    )
  );

  return v_id;
end;
$$;

revoke all on function public.record_ai_item_name_recommendation_feedback(uuid, uuid, text, text, text, text, uuid, text, uuid, text, text, text, text, jsonb, jsonb)
  from public;
grant execute on function public.record_ai_item_name_recommendation_feedback(uuid, uuid, text, text, text, text, uuid, text, uuid, text, text, text, text, jsonb, jsonb)
  to authenticated;

create or replace function public.save_invoice_item_name_rule_with_feedback(
  p_brand_id uuid,
  p_row jsonb,
  p_rule_id uuid default null,
  p_feedback jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_id uuid;
  v_scope text := coalesce(p_row->>'scope', '');
  v_item text := btrim(coalesce(p_row->>'item_name', ''));
  v_norm_item text := coalesce(
    nullif(btrim(p_row->>'normalized_item_name'), ''),
    app.normalize_invoice_lookup_key(v_item)
  );
  v_main uuid := nullif(p_row->>'main_style_id', '')::uuid;
  v_lookup text := coalesce(p_row->>'product_lookup_key', '');
  v_norm_lookup text := coalesce(
    nullif(btrim(p_row->>'normalized_product_lookup_key'), ''),
    app.normalize_invoice_lookup_key(v_lookup)
  );
  v_action text := coalesce(p_row->>'action', '');
  v_source text;
  v_outcome text;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 내품명 기준을 저장할 권한이 없습니다.';
  end if;
  if v_item = '' or v_scope not in ('global', 'main_style', 'lookup_key')
     or v_action not in ('delete', 'components') then
    raise exception '내품명 규칙 값이 올바르지 않습니다.';
  end if;
  if v_scope = 'global' then
    v_main := null;
    v_lookup := '';
    v_norm_lookup := '';
  elsif v_scope = 'main_style' then
    v_lookup := '';
    v_norm_lookup := '';
  end if;

  if p_rule_id is not null then
    v_id := p_rule_id;
  else
    select r.id into v_id
    from public.invoice_item_name_rules r
    where r.brand_id = p_brand_id
      and r.is_active
      and r.scope = v_scope
      and r.normalized_item_name = v_norm_item
      and r.main_style_id is not distinct from v_main
      and r.normalized_product_lookup_key = v_norm_lookup
    limit 1;
  end if;

  if v_id is null then
    insert into public.invoice_item_name_rules (
      brand_id,
      scope,
      main_style_id,
      item_name,
      normalized_item_name,
      product_lookup_key,
      normalized_product_lookup_key,
      action,
      is_active,
      note
    ) values (
      p_brand_id,
      v_scope,
      v_main,
      v_item,
      v_norm_item,
      v_lookup,
      v_norm_lookup,
      v_action,
      coalesce((p_row->>'is_active')::boolean, true),
      coalesce(p_row->>'note', '')
    )
    returning id into v_id;
  else
    update public.invoice_item_name_rules
    set
      scope = v_scope,
      main_style_id = v_main,
      item_name = v_item,
      normalized_item_name = v_norm_item,
      product_lookup_key = v_lookup,
      normalized_product_lookup_key = v_norm_lookup,
      action = v_action,
      is_active = coalesce((p_row->>'is_active')::boolean, true),
      note = coalesce(p_row->>'note', '')
    where id = v_id
      and brand_id = p_brand_id;
  end if;

  delete from public.invoice_item_name_rule_components
  where rule_id = v_id
    and brand_id = p_brand_id;

  insert into public.invoice_item_name_rule_components (
    brand_id, rule_id, style_id, role, quantity, sort_order
  )
  select
    p_brand_id,
    v_id,
    (item->>'styleId')::uuid,
    coalesce(nullif(item->>'role', ''), 'included'),
    greatest(1, coalesce((item->>'quantity')::integer, 1)),
    ordinality - 1
  from jsonb_array_elements(coalesce(p_row->'components', '[]'::jsonb))
    with ordinality as t(item, ordinality)
  where v_action = 'components'
    and nullif(item->>'styleId', '') is not null;

  v_source := nullif(btrim(coalesce(p_feedback->>'source', '')), '');
  v_outcome := coalesce(nullif(btrim(p_feedback->>'outcome'), ''), 'confirmed');
  if v_source is not null then
    perform public.record_ai_item_name_recommendation_feedback(
      p_brand_id,
      v_id,
      v_item,
      v_scope,
      v_action,
      v_source,
      v_main,
      v_lookup,
      nullif(p_feedback->>'cache_id', '')::uuid,
      nullif(p_feedback->>'provider', ''),
      nullif(p_feedback->>'model_id', ''),
      v_outcome,
      nullif(p_feedback->>'suggested_action', ''),
      coalesce(p_row->'components', '[]'::jsonb),
      coalesce(p_feedback->'suggested_components', '[]'::jsonb)
    );
  else
    perform app.invalidate_ai_recommendation_cache(
      p_brand_id,
      'invoice_item_name_recommendation',
      array_remove(array[v_norm_item, v_norm_lookup], '')
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_invoice_item_name_rule_with_feedback(uuid, jsonb, uuid, jsonb)
  from public;
grant execute on function public.save_invoice_item_name_rule_with_feedback(uuid, jsonb, uuid, jsonb)
  to authenticated;
