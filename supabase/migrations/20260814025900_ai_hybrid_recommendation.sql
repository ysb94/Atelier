-- hybrid_auto 후보 검색 최적화, 공유 캐시, 확정 피드백만 학습.

alter table public.ai_feature_routes
  add column if not exists recommendation_policy text not null default 'hybrid_auto'
    check (recommendation_policy in ('hybrid_auto', 'always_ai', 'local_only')),
  add column if not exists decision_config jsonb not null default
    '{"high":0.72,"margin":0.10,"low":0.40,"aiTopN":6}'::jsonb;

comment on column public.ai_feature_routes.recommendation_policy is
  'hybrid_auto는 원장 점수가 충분하면 AI를 건너뛴다.';
comment on column public.ai_feature_routes.decision_config is
  '로컬 정밀도 검증으로 맞춘 점수·마진. 일반 화면에서는 직접 고치지 않는다.';

alter table public.ai_usage_logs
  add column if not exists resolution_source text not null default 'ai'
    check (resolution_source in ('local', 'manual', 'ai', 'cache')),
  add column if not exists skipped_ai boolean not null default false,
  add column if not exists cache_hit boolean not null default false,
  add column if not exists candidate_count integer,
  add column if not exists latency_ms integer;

create table if not exists public.ai_recommendation_cache (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  feature_key text not null,
  cache_key text not null,
  provider text,
  model_id text,
  policy text not null default 'hybrid_auto',
  lookup_keys jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  recommendation jsonb not null,
  source text not null
    check (source in ('local', 'ai', 'cache')),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint ai_recommendation_cache_brand_key unique (brand_id, feature_key, cache_key)
);

comment on table public.ai_recommendation_cache is
  '브랜드·모델·입력 fingerprint별 추천 공유 캐시. 만료 행은 읽지 않는다.';

create index if not exists ai_recommendation_cache_expires_idx
  on public.ai_recommendation_cache (brand_id, expires_at);

create table if not exists public.ai_recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  cache_id uuid references public.ai_recommendation_cache(id) on delete set null,
  lookup_key text not null,
  normalized_lookup_key text not null,
  style_id uuid not null,
  shown_rank integer,
  source text not null
    check (source in ('manual', 'local', 'ai')),
  provider text,
  model_id text,
  created_at timestamptz not null default now()
);

comment on table public.ai_recommendation_feedback is
  '등록 버튼으로 확정된 결과만 남긴다. AI 출력 자체는 학습하지 않는다.';

create index if not exists ai_recommendation_feedback_lookup_idx
  on public.ai_recommendation_feedback (brand_id, normalized_lookup_key, created_at desc);

create index if not exists styles_lower_name_trgm_idx
  on public.styles
  using gin (lower(name) extensions.gin_trgm_ops);

create index if not exists styles_lower_style_no_trgm_idx
  on public.styles
  using gin (lower(style_no) extensions.gin_trgm_ops);

create index if not exists styles_brand_id_idx
  on public.styles (brand_id);

alter table public.ai_recommendation_cache enable row level security;
alter table public.ai_recommendation_feedback enable row level security;

drop policy if exists ai_recommendation_cache_select_member
  on public.ai_recommendation_cache;
create policy ai_recommendation_cache_select_member
on public.ai_recommendation_cache
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists ai_recommendation_cache_write_member
  on public.ai_recommendation_cache;
create policy ai_recommendation_cache_write_member
on public.ai_recommendation_cache
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_read_brand(brand_id));

drop policy if exists ai_recommendation_feedback_select_member
  on public.ai_recommendation_feedback;
create policy ai_recommendation_feedback_select_member
on public.ai_recommendation_feedback
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists ai_recommendation_feedback_insert_member
  on public.ai_recommendation_feedback;
create policy ai_recommendation_feedback_insert_member
on public.ai_recommendation_feedback
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.ai_recommendation_cache
to authenticated;

grant select, insert
on table public.ai_recommendation_feedback
to authenticated;

grant usage on schema app to authenticated;

create or replace function app.normalize_invoice_lookup_key(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(lower(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'))), 200);
$$;

revoke all on function app.normalize_invoice_lookup_key(text) from public;
grant execute on function app.normalize_invoice_lookup_key(text) to authenticated;

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
    join public.ai_recommendation_feedback f
      on f.brand_id = p_brand_id
     and f.normalized_lookup_key = q.q
    join public.styles s
      on s.id = f.style_id
     and s.brand_id = f.brand_id
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
  history_boost as (
    select
      f.style_id,
      least(
        0.08::double precision,
        0.025 * ln(1 + count(*))::double precision
        + 0.03 * greatest(
          0::double precision,
          1 - extract(epoch from (now() - max(f.created_at))) / (86400.0 * 90)
        )
      ) as boost
    from public.ai_recommendation_feedback f
    where f.brand_id = p_brand_id
    group by f.style_id
  ),
  best as (
    select
      picked.hit_source,
      picked.hit_lookup_key,
      picked.hit_style_id,
      picked.hit_style_no,
      picked.hit_style_name,
      least(1.0, picked.hit_score + coalesce(hb.boost, 0)) as hit_score
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
    left join history_boost hb on hb.style_id = picked.hit_style_id
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

revoke all on function app.search_invoice_product_candidates_core(uuid, text[], integer)
  from public;
grant execute on function app.search_invoice_product_candidates_core(uuid, text[], integer)
  to authenticated;

drop function if exists public.search_invoice_product_candidates(uuid, text[], integer);

create or replace function public.search_invoice_product_candidates(
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
language sql
stable
security invoker
set search_path = public, app
as $$
  select *
  from app.search_invoice_product_candidates_core(p_brand_id, p_texts, p_limit);
$$;

revoke all on function public.search_invoice_product_candidates(uuid, text[], integer)
  from public;
grant execute on function public.search_invoice_product_candidates(uuid, text[], integer)
  to authenticated;

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
  where brand_id = p_brand_id
    and feature_key = 'invoice_product_recommendation';
end;
$$;

revoke all on function app.invalidate_ai_recommendation_cache(uuid) from public;
grant execute on function app.invalidate_ai_recommendation_cache(uuid) to authenticated;

create or replace function public.record_ai_recommendation_feedback(
  p_brand_id uuid,
  p_lookup_key text,
  p_style_id uuid,
  p_source text,
  p_cache_id uuid default null,
  p_shown_rank integer default null,
  p_provider text default null,
  p_model_id text default null
)
returns void
language plpgsql
security invoker
set search_path = public, app
as $$
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

  insert into public.ai_recommendation_feedback (
    brand_id,
    user_id,
    cache_id,
    lookup_key,
    normalized_lookup_key,
    style_id,
    shown_rank,
    source,
    provider,
    model_id
  ) values (
    p_brand_id,
    auth.uid(),
    p_cache_id,
    btrim(p_lookup_key),
    app.normalize_invoice_lookup_key(p_lookup_key),
    p_style_id,
    p_shown_rank,
    p_source,
    p_provider,
    p_model_id
  );

  perform app.invalidate_ai_recommendation_cache(p_brand_id);
end;
$$;

revoke all on function public.record_ai_recommendation_feedback(uuid, text, uuid, text, uuid, integer, text, text)
  from public;
grant execute on function public.record_ai_recommendation_feedback(uuid, text, uuid, text, uuid, integer, text, text)
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
  v_source text;
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

  v_source := nullif(btrim(coalesce(p_feedback->>'source', '')), '');
  if v_source is not null then
    perform public.record_ai_recommendation_feedback(
      p_brand_id,
      case when v_lookup <> '' then v_lookup else btrim(p_row->>'product_name') end,
      (p_row->>'style_id')::uuid,
      v_source,
      nullif(p_feedback->>'cache_id', '')::uuid,
      nullif(p_feedback->>'shown_rank', '')::integer,
      nullif(p_feedback->>'provider', ''),
      nullif(p_feedback->>'model_id', '')
    );
  else
    perform app.invalidate_ai_recommendation_cache(p_brand_id);
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_invoice_product_name_map_with_feedback(uuid, jsonb, uuid, jsonb)
  from public;
grant execute on function public.save_invoice_product_name_map_with_feedback(uuid, jsonb, uuid, jsonb)
  to authenticated;
