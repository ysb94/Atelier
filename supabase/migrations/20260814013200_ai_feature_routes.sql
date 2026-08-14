-- 브랜드별 AI 기능 라우트, 최소 사용량 로그, 유사 상품 후보 RPC.
-- 기존 업무 데이터는 변경하지 않는다.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.ai_feature_routes (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  feature_key text not null
    check (feature_key ~ '^[a-z][a-z0-9_]*$'),
  provider text not null
    check (provider in ('openai', 'anthropic', 'gemini')),
  model_id text not null
    check (length(btrim(model_id)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_feature_routes_brand_feature_key unique (brand_id, feature_key),
  constraint ai_feature_routes_brand_id_id_key unique (brand_id, id)
);

comment on table public.ai_feature_routes is
  '브랜드·기능별 AI 제공자와 모델. API 키는 두지 않고 Edge Function Secret만 쓴다.';
comment on column public.ai_feature_routes.feature_key is
  '기능 식별자. 첫 값은 invoice_product_recommendation이며 이후 파트가 재사용한다.';
comment on column public.ai_feature_routes.provider is
  'openai | anthropic | gemini. 모델 ID는 코드에 고정하지 않는다.';

create trigger ai_feature_routes_set_updated_at
before update on public.ai_feature_routes
for each row execute function public.set_updated_at();

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  feature_key text not null,
  provider text not null
    check (provider in ('openai', 'anthropic', 'gemini')),
  model_id text not null,
  action text not null default 'recommend_product',
  status text not null
    check (status in ('ok', 'error')),
  input_tokens integer,
  output_tokens integer,
  error_code text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.ai_usage_logs is
  'AI 호출 최소 사용량. 토큰과 성공/실패만 남기고 프롬프트·응답 원문은 저장하지 않는다.';

create index if not exists ai_usage_logs_brand_created_idx
  on public.ai_usage_logs (brand_id, created_at desc);

create index if not exists invoice_product_name_maps_lookup_trgm_idx
  on public.invoice_product_name_maps
  using gin (normalized_lookup_key extensions.gin_trgm_ops)
  where is_active and normalized_lookup_key <> '';

create index if not exists styles_name_trgm_idx
  on public.styles
  using gin (name extensions.gin_trgm_ops);

create index if not exists styles_style_no_trgm_idx
  on public.styles
  using gin (style_no extensions.gin_trgm_ops);

alter table public.ai_feature_routes enable row level security;
alter table public.ai_usage_logs enable row level security;

drop policy if exists ai_feature_routes_select_member
  on public.ai_feature_routes;
create policy ai_feature_routes_select_member
on public.ai_feature_routes
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists ai_feature_routes_write_lead
  on public.ai_feature_routes;
create policy ai_feature_routes_write_lead
on public.ai_feature_routes
for all
to authenticated
using (app.is_admin() or app.is_brand_lead(brand_id))
with check (app.is_admin() or app.is_brand_lead(brand_id));

drop policy if exists ai_usage_logs_select_member
  on public.ai_usage_logs;
create policy ai_usage_logs_select_member
on public.ai_usage_logs
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists ai_usage_logs_insert_member
  on public.ai_usage_logs;
create policy ai_usage_logs_insert_member
on public.ai_usage_logs
for insert
to authenticated
with check (app.can_read_brand(brand_id));

grant select, insert, update, delete
on table public.ai_feature_routes
to authenticated;

grant select, insert
on table public.ai_usage_logs
to authenticated;

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
  score double precision
)
language plpgsql
stable
security invoker
set search_path = public, extensions
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

  perform set_config('pg_trgm.similarity_threshold', '0.15', true);

  return query
  with queries as (
    select distinct left(lower(btrim(regexp_replace(t, '\s+', ' ', 'g'))), 200) as q
    from unnest(coalesce(p_texts, array[]::text[])) as t
    where length(btrim(t)) > 0
  ),
  lookup_hits as (
    select
      'lookup_key'::text as hit_source,
      m.lookup_key as hit_lookup_key,
      m.style_id as hit_style_id,
      s.style_no as hit_style_no,
      s.name as hit_style_name,
      max(similarity(m.normalized_lookup_key, q.q))::double precision as hit_score
    from public.invoice_product_name_maps m
    join public.styles s
      on s.id = m.style_id
     and s.brand_id = m.brand_id
    cross join queries q
    where m.brand_id = p_brand_id
      and m.is_active
      and m.normalized_lookup_key <> ''
      and (
        m.normalized_lookup_key % q.q
        or m.normalized_lookup_key like '%' || q.q || '%'
      )
    group by m.lookup_key, m.style_id, s.style_no, s.name
  ),
  style_hits as (
    select
      'style_name'::text as hit_source,
      s.name as hit_lookup_key,
      s.id as hit_style_id,
      s.style_no as hit_style_no,
      s.name as hit_style_name,
      max(greatest(
        similarity(lower(s.name), q.q),
        similarity(lower(s.style_no), q.q)
      ))::double precision as hit_score
    from public.styles s
    cross join queries q
    where s.brand_id = p_brand_id
      and (
        lower(s.name) % q.q
        or lower(s.style_no) % q.q
        or lower(s.name) like '%' || q.q || '%'
        or lower(s.style_no) like '%' || q.q || '%'
      )
    group by s.id, s.style_no, s.name
  ),
  combined as (
    select * from lookup_hits
    union all
    select * from style_hits
  )
  select
    c.hit_source,
    c.hit_lookup_key,
    c.hit_style_id,
    c.hit_style_no,
    c.hit_style_name,
    c.hit_score
  from combined c
  order by c.hit_score desc, c.hit_style_no
  limit v_limit;
end;
$$;

comment on function public.search_invoice_product_candidates(uuid, text[], integer) is
  '브랜드 안에서 조회 키 원장과 공식 상품명으로 유사 후보를 고른다. RLS를 그대로 탄다.';

revoke all on function public.search_invoice_product_candidates(uuid, text[], integer)
  from public;
grant execute on function public.search_invoice_product_candidates(uuid, text[], integer)
  to authenticated;
