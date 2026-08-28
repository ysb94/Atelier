-- 사방넷 CJ 최종 다운로드의 비개인정보 작업 이력과 사이트별 출고 집계.
-- 원본 주문·수령인·전화·주소는 넣지 않는다.
-- 같은 파일 지문은 한 작업으로 갱신해 중복 다운로드가 통계를 부풀리지 않게 한다.
-- 출고업체 별칭은 통째 교체 없이 한 표기만 원자 추가한다.

create table if not exists public.invoice_work_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  file_fingerprint text not null
    check (length(btrim(file_fingerprint)) > 0),
  source_file_name text not null default '',
  completed_by uuid references public.profiles (id) on delete set null,
  worker_label text not null default '',
  completed_at timestamptz not null default now(),
  source_row_count integer not null default 0
    check (source_row_count >= 0),
  source_order_count integer not null default 0
    check (source_order_count >= 0),
  exported_row_count integer not null default 0
    check (exported_row_count >= 0),
  review_row_count integer not null default 0
    check (review_row_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_work_runs_brand_id_id_key unique (brand_id, id),
  constraint invoice_work_runs_brand_fingerprint_key
    unique (brand_id, file_fingerprint)
);

comment on table public.invoice_work_runs is
  '사방넷 출고 작업 1회. 비개인정보 파일 지문과 결과 수치만 둔다.';
comment on column public.invoice_work_runs.file_fingerprint is
  '수령인·전화·주소를 뺀 원본 열의 SHA-256. 같은 파일은 한 행으로 갱신한다.';
comment on column public.invoice_work_runs.worker_label is
  '완료 시점의 표시 이름 스냅샷. 프로필을 바꿔도 이력을 유지한다.';

create index if not exists invoice_work_runs_brand_completed_idx
  on public.invoice_work_runs (brand_id, completed_at desc);

create index if not exists invoice_work_runs_completed_by_idx
  on public.invoice_work_runs (completed_by);

drop trigger if exists invoice_work_runs_set_updated_at
  on public.invoice_work_runs;
create trigger invoice_work_runs_set_updated_at
before update on public.invoice_work_runs
for each row execute function public.set_updated_at();

alter table public.invoice_work_runs enable row level security;

drop policy if exists invoice_work_runs_all_member
  on public.invoice_work_runs;
create policy invoice_work_runs_all_member
on public.invoice_work_runs
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_work_runs
to authenticated;

create table if not exists public.invoice_work_site_summaries (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  run_id uuid not null,
  usage_target_id uuid not null,
  source_mall_names text not null default '',
  order_count integer not null default 0
    check (order_count >= 0),
  source_row_count integer not null default 0
    check (source_row_count >= 0),
  source_quantity integer not null default 0
    check (source_quantity >= 0),
  cj_order_row_count integer not null default 0
    check (cj_order_row_count >= 0),
  cj_order_quantity integer not null default 0
    check (cj_order_quantity >= 0),
  cj_gift_row_count integer not null default 0
    check (cj_gift_row_count >= 0),
  cj_gift_quantity integer not null default 0
    check (cj_gift_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_work_site_summaries_brand_id_id_key unique (brand_id, id),
  constraint invoice_work_site_summaries_run_target_key
    unique (brand_id, run_id, usage_target_id),
  constraint invoice_work_site_summaries_run_fkey
    foreign key (brand_id, run_id)
    references public.invoice_work_runs (brand_id, id) on delete cascade,
  constraint invoice_work_site_summaries_target_fkey
    foreign key (brand_id, usage_target_id)
    references public.code_usage_targets (brand_id, id) on delete restrict
);

comment on table public.invoice_work_site_summaries is
  '출고 작업의 공식 사이트별 주문·수량 집계. 주문 식별값은 넣지 않는다.';
comment on column public.invoice_work_site_summaries.source_mall_names is
  '이 공식 사이트에 묶인 원본 쇼핑몰 표기. 별칭이 여러 개면 쉼표로 잇는다.';

create index if not exists invoice_work_site_summaries_run_idx
  on public.invoice_work_site_summaries (brand_id, run_id);

create index if not exists invoice_work_site_summaries_target_idx
  on public.invoice_work_site_summaries (brand_id, usage_target_id);

drop trigger if exists invoice_work_site_summaries_set_updated_at
  on public.invoice_work_site_summaries;
create trigger invoice_work_site_summaries_set_updated_at
before update on public.invoice_work_site_summaries
for each row execute function public.set_updated_at();

alter table public.invoice_work_site_summaries enable row level security;

drop policy if exists invoice_work_site_summaries_all_member
  on public.invoice_work_site_summaries;
create policy invoice_work_site_summaries_all_member
on public.invoice_work_site_summaries
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_work_site_summaries
to authenticated;

create or replace function public.record_invoice_work_completion(
  p_brand_id uuid,
  p_file_fingerprint text,
  p_source_file_name text,
  p_worker_label text,
  p_source_row_count integer,
  p_source_order_count integer,
  p_exported_row_count integer,
  p_review_row_count integer,
  p_sites jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run_id uuid;
  v_site jsonb;
  v_target_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_target_ids uuid[] := array[]::uuid[];
  v_locked integer;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 출고 이력을 저장할 권한이 없습니다.';
  end if;
  if length(btrim(coalesce(p_file_fingerprint, ''))) = 0 then
    raise exception '파일 지문이 필요합니다.';
  end if;
  if p_sites is null or jsonb_typeof(p_sites) <> 'array' then
    raise exception '사이트 집계 목록이 필요합니다.';
  end if;
  if coalesce(p_source_row_count, 0) < 0
     or coalesce(p_source_order_count, 0) < 0
     or coalesce(p_exported_row_count, 0) < 0
     or coalesce(p_review_row_count, 0) < 0 then
    raise exception '집계 수치는 0 이상이어야 합니다.';
  end if;

  for v_site in
    select value from jsonb_array_elements(p_sites)
  loop
    v_target_id := (v_site->>'usage_target_id')::uuid;
    if v_target_id is null then
      raise exception 'usage_target_id가 필요합니다.';
    end if;
    if v_target_id = any (v_seen) then
      raise exception '같은 사이트가 두 번 들어 있습니다.';
    end if;
    if coalesce((v_site->>'order_count')::integer, 0) < 0
       or coalesce((v_site->>'source_row_count')::integer, 0) < 0
       or coalesce((v_site->>'source_quantity')::integer, 0) < 0
       or coalesce((v_site->>'cj_order_row_count')::integer, 0) < 0
       or coalesce((v_site->>'cj_order_quantity')::integer, 0) < 0
       or coalesce((v_site->>'cj_gift_row_count')::integer, 0) < 0
       or coalesce((v_site->>'cj_gift_quantity')::integer, 0) < 0 then
      raise exception '사이트 집계 수치는 0 이상이어야 합니다.';
    end if;
    v_seen := array_append(v_seen, v_target_id);
    v_target_ids := array_append(v_target_ids, v_target_id);
  end loop;

  if coalesce(array_length(v_target_ids, 1), 0) > 0 then
    select count(*)
      into v_locked
      from public.code_usage_targets t
     where t.brand_id = p_brand_id
       and t.id = any (v_target_ids);

    if v_locked <> coalesce(array_length(v_target_ids, 1), 0) then
      raise exception '같은 브랜드의 출고업체만 집계할 수 있습니다.';
    end if;

    perform 1
      from public.code_usage_targets t
     where t.brand_id = p_brand_id
       and t.id = any (v_target_ids)
     order by t.id
       for update;
  end if;

  perform 1
    from public.invoice_work_runs r
   where r.brand_id = p_brand_id
     and r.file_fingerprint = btrim(p_file_fingerprint)
     for update;

  insert into public.invoice_work_runs (
    brand_id,
    file_fingerprint,
    source_file_name,
    completed_by,
    worker_label,
    completed_at,
    source_row_count,
    source_order_count,
    exported_row_count,
    review_row_count
  )
  values (
    p_brand_id,
    btrim(p_file_fingerprint),
    coalesce(p_source_file_name, ''),
    auth.uid(),
    coalesce(p_worker_label, ''),
    now(),
    coalesce(p_source_row_count, 0),
    coalesce(p_source_order_count, 0),
    coalesce(p_exported_row_count, 0),
    coalesce(p_review_row_count, 0)
  )
  on conflict (brand_id, file_fingerprint)
  do update set
    source_file_name = excluded.source_file_name,
    completed_by = excluded.completed_by,
    worker_label = excluded.worker_label,
    completed_at = excluded.completed_at,
    source_row_count = excluded.source_row_count,
    source_order_count = excluded.source_order_count,
    exported_row_count = excluded.exported_row_count,
    review_row_count = excluded.review_row_count
  returning id into v_run_id;

  delete from public.invoice_work_site_summaries
   where brand_id = p_brand_id
     and run_id = v_run_id;

  for v_site in
    select value
      from jsonb_array_elements(p_sites)
     order by value->>'usage_target_id'
  loop
    insert into public.invoice_work_site_summaries (
      brand_id,
      run_id,
      usage_target_id,
      source_mall_names,
      order_count,
      source_row_count,
      source_quantity,
      cj_order_row_count,
      cj_order_quantity,
      cj_gift_row_count,
      cj_gift_quantity
    )
    values (
      p_brand_id,
      v_run_id,
      (v_site->>'usage_target_id')::uuid,
      coalesce(v_site->>'source_mall_names', ''),
      coalesce((v_site->>'order_count')::integer, 0),
      coalesce((v_site->>'source_row_count')::integer, 0),
      coalesce((v_site->>'source_quantity')::integer, 0),
      coalesce((v_site->>'cj_order_row_count')::integer, 0),
      coalesce((v_site->>'cj_order_quantity')::integer, 0),
      coalesce((v_site->>'cj_gift_row_count')::integer, 0),
      coalesce((v_site->>'cj_gift_quantity')::integer, 0)
    );
  end loop;

  return v_run_id;
end;
$$;

comment on function public.record_invoice_work_completion(
  uuid, text, text, text, integer, integer, integer, integer, jsonb
) is
  '파일 지문으로 출고 작업을 upsert하고 사이트 집계를 한 트랜잭션에서 교체한다.';

revoke all on function public.record_invoice_work_completion(
  uuid, text, text, text, integer, integer, integer, integer, jsonb
) from public;

grant execute on function public.record_invoice_work_completion(
  uuid, text, text, text, integer, integer, integer, integer, jsonb
) to authenticated;

create or replace function public.add_outbound_partner_alias(
  p_brand_id uuid,
  p_target_id uuid,
  p_alias text,
  p_normalized_alias text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_target public.code_usage_targets%rowtype;
  v_alias text;
  v_key text;
  v_existing uuid;
begin
  if p_brand_id is null or p_target_id is null then
    raise exception 'brand_id와 target_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  v_alias := btrim(coalesce(p_alias, ''));
  v_key := coalesce(p_normalized_alias, '');
  if v_alias = '' then
    raise exception '연결할 이름을 입력하세요.';
  end if;
  if v_key = '' then
    raise exception '이름에 글자나 숫자가 있어야 합니다.';
  end if;

  select *
    into v_target
    from public.code_usage_targets
   where brand_id = p_brand_id
     and id = p_target_id
     for update;

  if not found then
    raise exception '업체를 찾을 수 없습니다.';
  end if;

  if not v_target.active then
    raise exception '비활성 업체에는 연결할 수 없습니다. 출고업체에서 다시 켜세요.';
  end if;

  if v_target.normalized_name = v_key then
    return v_target.id;
  end if;

  if exists (
    select 1
      from public.code_usage_targets t
     where t.brand_id = p_brand_id
       and t.id <> p_target_id
       and t.normalized_name = v_key
  ) then
    raise exception '이미 다른 업체의 정식명입니다.';
  end if;

  select id
    into v_existing
    from public.code_usage_target_aliases
   where brand_id = p_brand_id
     and target_id = p_target_id
     and normalized_alias = v_key;

  if v_existing is not null then
    return v_existing;
  end if;

  if exists (
    select 1
      from public.code_usage_target_aliases a
     where a.brand_id = p_brand_id
       and a.target_id <> p_target_id
       and a.normalized_alias = v_key
  ) then
    raise exception '이미 다른 업체에 등록된 별칭입니다.';
  end if;

  insert into public.code_usage_target_aliases (
    brand_id,
    target_id,
    alias,
    normalized_alias
  )
  values (
    p_brand_id,
    p_target_id,
    v_alias,
    v_key
  )
  returning id into v_existing;

  return v_existing;
end;
$$;

comment on function public.add_outbound_partner_alias(uuid, uuid, text, text) is
  '출고업체에 별칭 한 표기만 원자 추가한다. 기존 별칭은 지우지 않는다.';

revoke all on function public.add_outbound_partner_alias(uuid, uuid, text, text)
  from public;

grant execute on function public.add_outbound_partner_alias(uuid, uuid, text, text)
  to authenticated;
