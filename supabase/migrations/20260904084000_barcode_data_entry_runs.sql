-- 바코드 출고 데이터입력: 등록 1건을 이력 1행으로 남긴다.
-- 예전에는 source_ref가 'barcode-data-entry:<업체키>' 하나뿐이라 같은 업체·출고일을
-- 다시 등록하면 앞 등록이 사라졌다. 이제 등록마다 run 행을 만들고
-- source_ref = 'barcode-data-entry:<run_id>'로 두어 등록끼리 섞이지 않게 한다.
-- 등록자·등록시각은 run 행에만 두며 수정해도 최초 값을 유지한다.

create table if not exists public.barcode_data_entry_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  company_key text not null
    check (btrim(company_key) <> ''),
  shipped_on date not null,
  note text not null default '',
  worker_label text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barcode_data_entry_runs_brand_id_id_key unique (brand_id, id)
);

comment on table public.barcode_data_entry_runs is
  '바코드 출고 데이터입력 등록 1건. outbound_shipments.source_ref = barcode-data-entry:<id>로 연결한다.';
comment on column public.barcode_data_entry_runs.company_key is
  'outbound_partner_groups.id 또는 legacy:<code_usage_targets.id>.';
comment on column public.barcode_data_entry_runs.worker_label is
  '등록 시점 등록자 이름 스냅샷. 프로필 이름이 바뀌어도 이력은 그대로 둔다.';
comment on column public.barcode_data_entry_runs.registered_at is
  '최초 등록 시각. 수량을 수정해도 갱신하지 않는다.';

create index if not exists barcode_data_entry_runs_brand_shipped_idx
  on public.barcode_data_entry_runs (brand_id, shipped_on desc, registered_at desc);

drop trigger if exists barcode_data_entry_runs_set_updated_at
  on public.barcode_data_entry_runs;
create trigger barcode_data_entry_runs_set_updated_at
before update on public.barcode_data_entry_runs
for each row execute function public.set_updated_at();

alter table public.barcode_data_entry_runs enable row level security;

drop policy if exists barcode_data_entry_runs_all_member
  on public.barcode_data_entry_runs;
create policy barcode_data_entry_runs_all_member
on public.barcode_data_entry_runs
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.barcode_data_entry_runs
to authenticated;

-- ---------------------------------------------------------------------------
-- 기존 반영분 이전: (업체키, 출고일) 묶음 하나를 등록 1건으로 본다.
-- ---------------------------------------------------------------------------

do $$
declare
  rec record;
  v_run_id uuid;
begin
  for rec in
    select
      brand_id,
      source_ref,
      shipped_on,
      min(created_at) as first_created,
      coalesce(max(nullif(note, '')), '') as note
    from public.outbound_shipments
    where source = 'bulk'
      and source_ref like 'barcode-data-entry:%'
      and length(btrim(substring(source_ref from 20))) > 0
    group by brand_id, source_ref, shipped_on
  loop
    insert into public.barcode_data_entry_runs (
      brand_id, company_key, shipped_on, note, worker_label,
      registered_at, created_at
    ) values (
      rec.brand_id,
      btrim(substring(rec.source_ref from 20)),
      rec.shipped_on,
      rec.note,
      '',
      rec.first_created,
      rec.first_created
    )
    returning id into v_run_id;

    update public.outbound_shipments
    set source_ref = 'barcode-data-entry:' || v_run_id::text
    where brand_id = rec.brand_id
      and source = 'bulk'
      and source_ref = rec.source_ref
      and shipped_on = rec.shipped_on;
  end loop;
end;
$$;

-- 이전한 등록 건의 등록자는 기록이 없다. 2026-09-01 교보문고 건은 김지선 사용자가
-- 등록한 것이 확인되어 이름만 채운다.
update public.barcode_data_entry_runs r
set worker_label = coalesce(nullif(btrim(p.display_name), ''), p.email),
    created_by = p.id
from public.profiles p
where p.email = 'js4725212@gmail.com'
  and r.worker_label = ''
  and r.shipped_on = date '2026-09-01';

-- ---------------------------------------------------------------------------
-- save_barcode_data_entry_run: 등록 1건의 원장을 통째로 교체한다.
-- ---------------------------------------------------------------------------

create or replace function public.save_barcode_data_entry_run(
  p_brand_id uuid,
  p_run_id uuid,
  p_company_key text,
  p_shipped_on date,
  p_note text,
  p_worker_label text,
  p_entries jsonb
) returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  item jsonb;
  v_run_id uuid;
  v_company_key text;
  v_note text;
  v_source_ref text;
  v_style_id uuid;
  v_target_id uuid;
  v_qty integer;
  v_key text;
  v_seen text[] := array[]::text[];
  v_inserted integer := 0;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;

  v_company_key := btrim(coalesce(p_company_key, ''));
  if v_company_key = '' then
    raise exception '출고업체 정보가 올바르지 않습니다.';
  end if;
  if p_shipped_on is null then
    raise exception '출고일을 확인하세요.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_entries) = 0 then
    raise exception '반영할 출고 행이 없습니다.';
  end if;

  v_note := coalesce(p_note, '');

  for item in select value from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        raise exception '상품 정보가 올바르지 않습니다.';
    end;
    begin
      v_target_id := (item->>'usageTargetId')::uuid;
    exception
      when invalid_text_representation then
        raise exception '출고업체 정보가 올바르지 않습니다.';
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);

    if v_style_id is null then
      raise exception '상품 정보가 올바르지 않습니다.';
    end if;
    if v_target_id is null then
      raise exception '출고업체 정보가 올바르지 않습니다.';
    end if;
    if v_qty <= 0 then
      raise exception '출고 수량은 1 이상이어야 합니다.';
    end if;
    if not exists (
      select 1 from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      raise exception '같은 브랜드의 상품만 반영할 수 있습니다.';
    end if;
    if not exists (
      select 1 from public.code_usage_targets
      where id = v_target_id and brand_id = p_brand_id
    ) then
      raise exception '같은 브랜드의 출고업체만 반영할 수 있습니다.';
    end if;

    v_key := v_style_id::text || '|' || v_target_id::text;
    if v_key = any (v_seen) then
      raise exception '같은 상품·지점이 두 번 들어 있습니다.';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;

  if p_run_id is null then
    insert into public.barcode_data_entry_runs (
      brand_id, company_key, shipped_on, note, worker_label,
      created_by, registered_at
    ) values (
      p_brand_id, v_company_key, p_shipped_on, v_note,
      coalesce(p_worker_label, ''), auth.uid(), now()
    )
    returning id into v_run_id;
  else
    update public.barcode_data_entry_runs
    set shipped_on = p_shipped_on,
        note = v_note
    where brand_id = p_brand_id
      and id = p_run_id
    returning id into v_run_id;

    if v_run_id is null then
      raise exception '등록 이력을 찾지 못했습니다.';
    end if;
  end if;

  v_source_ref := 'barcode-data-entry:' || v_run_id::text;

  perform 1
    from public.outbound_shipments
   where brand_id = p_brand_id
     and source = 'bulk'
     and source_ref = v_source_ref
   for update;

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and source_ref = v_source_ref;

  for item in
    select value
      from jsonb_array_elements(p_entries)
     order by value->>'usageTargetId', value->>'styleId'
  loop
    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      (item->>'styleId')::uuid,
      (item->>'usageTargetId')::uuid,
      p_shipped_on,
      (item->>'quantity')::int,
      'bulk',
      v_source_ref,
      v_note
    );
    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted = 0 then
    raise exception '반영할 출고 행이 없습니다.';
  end if;

  return v_run_id;
end;
$function$;

comment on function public.save_barcode_data_entry_run(
  uuid, uuid, text, date, text, text, jsonb
) is
  '바코드 출고 데이터입력 등록 1건과 그 출고 원장을 한 트랜잭션에서 저장한다. 다른 등록 건은 건드리지 않고 재고도 바꾸지 않는다.';

revoke all on function public.save_barcode_data_entry_run(
  uuid, uuid, text, date, text, text, jsonb
) from public;
grant execute on function public.save_barcode_data_entry_run(
  uuid, uuid, text, date, text, text, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_barcode_data_entry_run: 등록 1건과 그 출고 원장만 지운다.
-- ---------------------------------------------------------------------------

create or replace function public.delete_barcode_data_entry_run(
  p_brand_id uuid,
  p_run_id uuid
) returns integer
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_source_ref text;
  v_deleted integer := 0;
begin
  if p_brand_id is null or p_run_id is null then
    raise exception '등록 이력을 찾지 못했습니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;

  perform 1
    from public.barcode_data_entry_runs
   where brand_id = p_brand_id
     and id = p_run_id
   for update;

  v_source_ref := 'barcode-data-entry:' || p_run_id::text;

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and source_ref = v_source_ref;
  get diagnostics v_deleted = row_count;

  delete from public.barcode_data_entry_runs
  where brand_id = p_brand_id
    and id = p_run_id;

  return v_deleted;
end;
$function$;

comment on function public.delete_barcode_data_entry_run(uuid, uuid) is
  '바코드 출고 데이터입력 등록 1건과 같은 등록 ID의 출고 원장을 지운다. 재고는 건드리지 않는다.';

revoke all on function public.delete_barcode_data_entry_run(uuid, uuid) from public;
grant execute on function public.delete_barcode_data_entry_run(uuid, uuid)
  to authenticated;

comment on column public.outbound_shipments.source_ref is
  'bulk면 job id 또는 barcode-data-entry:<barcode_data_entry_runs.id>. invoice면 비개인정보 파일 SHA-256 지문.';

-- ---------------------------------------------------------------------------
-- 구버전 앱 호환: replace_barcode_data_entry_shipments는 남기되, 같은 출고일의
-- 다른 barcode-data-entry 반영분까지 지우던 범위를 없앤다. 배포 직후 열려 있던
-- 예전 탭이 새 등록 건을 지우지 못하게 한다.
-- ---------------------------------------------------------------------------

create or replace function public.replace_barcode_data_entry_shipments(
  p_brand_id uuid,
  p_source_ref text,
  p_shipped_on date,
  p_note text,
  p_usage_target_ids uuid[],
  p_entries jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  item jsonb;
  v_style_id uuid;
  v_target_id uuid;
  v_qty integer;
  v_count integer := 0;
  v_shipped_on date;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_source_ref is null or btrim(p_source_ref) = '' then
    raise exception '출고 출처가 올바르지 않습니다.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;

  v_shipped_on := coalesce(p_shipped_on, (timezone('Asia/Seoul', now()))::date);

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and shipped_on = v_shipped_on
    and source_ref = p_source_ref;

  for item in select * from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        v_style_id := null;
    end;
    begin
      v_target_id := (item->>'usageTargetId')::uuid;
    exception
      when invalid_text_representation then
        v_target_id := null;
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);
    if v_style_id is null or v_target_id is null or v_qty <= 0 then
      continue;
    end if;
    if not exists (
      select 1
      from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      continue;
    end if;
    if not exists (
      select 1
      from public.code_usage_targets
      where id = v_target_id and brand_id = p_brand_id
    ) then
      continue;
    end if;

    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      v_style_id,
      v_target_id,
      v_shipped_on,
      v_qty,
      'bulk',
      p_source_ref,
      coalesce(p_note, '')
    )
    on conflict (
      brand_id, source, source_ref, style_id, usage_target_id, shipped_on
    )
    do update set
      quantity = excluded.quantity,
      note = excluded.note,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

comment on function public.replace_barcode_data_entry_shipments(
  uuid, text, date, text, uuid[], jsonb
) is
  '구버전 앱 호환용. 같은 source_ref·출고일 반영분만 교체하며 다른 등록 건은 건드리지 않는다. 신규 저장은 save_barcode_data_entry_run을 쓴다.';
