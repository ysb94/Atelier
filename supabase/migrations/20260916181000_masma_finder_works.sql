-- Masma Works·입고·자리이동·라벨 기록. 모든 행은 brand_id와 Finder 승인으로 가둔다.

create table if not exists public.masma_finder_work_days (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  work_date date not null,
  has_inbound boolean not null default false,
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (brand_id, id),
  unique (brand_id, work_date)
);

create table if not exists public.masma_finder_work_templates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  title text not null,
  type text not null default 'daily' check (type in ('daily', 'inbound')),
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_id text
);

create table if not exists public.masma_finder_work_tasks (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  day_id uuid not null,
  work_date date not null,
  title text not null,
  type text not null default 'adhoc',
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'skipped')),
  due_date text,
  is_urgent boolean not null default false,
  memo text,
  memo_updated_at timestamptz,
  skip_reason text,
  skipped_at timestamptz,
  started_at timestamptz,
  started_by uuid references public.masma_finder_users (id),
  started_by_name text not null default '',
  started_by_legacy_uid text,
  completed_at timestamptz,
  worker_id uuid references public.masma_finder_users (id),
  worker_name text not null default '',
  worker_legacy_uid text,
  completion_note text,
  completion_note_updated_at timestamptz,
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_by_legacy_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_id text,
  unique (brand_id, id),
  foreign key (brand_id, day_id)
    references public.masma_finder_work_days (brand_id, id)
);

create index if not exists masma_finder_work_tasks_day_idx
  on public.masma_finder_work_tasks (brand_id, work_date, created_at);

create table if not exists public.masma_finder_work_attachments (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  task_id uuid not null,
  kind text not null check (kind in ('normal', 'completion')),
  original_name text not null,
  byte_size bigint not null default 0 check (byte_size >= 0 and byte_size <= 10485760),
  content_type text not null default 'application/octet-stream',
  storage_path text not null default '',
  legacy_object_path text,
  sha256 text,
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (brand_id, id),
  foreign key (brand_id, task_id)
    references public.masma_finder_work_tasks (brand_id, id)
    on delete cascade
);

create index if not exists masma_finder_work_attachments_task_idx
  on public.masma_finder_work_attachments (brand_id, task_id, kind);

create table if not exists public.masma_finder_incoming_groups (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  work_date date not null,
  legacy_group_id text,
  label text not null,
  source text not null default '',
  expected_time text not null default '',
  memo text not null default '',
  status text not null default 'planned'
    check (status in ('planned', 'arrived', 'done')),
  kind text not null default '',
  is_legacy boolean not null default false,
  entry_completed boolean not null default false,
  apply_completed boolean not null default false,
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_by_legacy_uid text,
  updated_by uuid references public.masma_finder_users (id),
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, id)
);

create unique index if not exists masma_finder_incoming_groups_legacy_uidx
  on public.masma_finder_incoming_groups (brand_id, work_date, legacy_group_id)
  where legacy_group_id is not null;

create table if not exists public.masma_finder_incoming_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  group_id uuid not null,
  work_date date not null,
  is_legacy_flat boolean not null default false,
  product_name text not null default '',
  model_name text not null default '',
  units_per_box numeric,
  box_count numeric,
  total_quantity numeric,
  location text not null default '',
  loading_method text not null default '',
  memo text not null default '',
  shipment_date text not null default '',
  recent_location text not null default '',
  recent_location_box_count numeric,
  edited_recent_location text not null default '',
  edited_recent_location_box_count numeric,
  import_batch_id text not null default '',
  import_row integer,
  split_from_id text,
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_by_legacy_uid text,
  updated_by uuid references public.masma_finder_users (id),
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_id text,
  unique (brand_id, id),
  foreign key (brand_id, group_id)
    references public.masma_finder_incoming_groups (brand_id, id)
    on delete cascade
);

create index if not exists masma_finder_incoming_items_group_idx
  on public.masma_finder_incoming_items (brand_id, group_id, created_at);

create table if not exists public.masma_finder_move_drafts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  finder_user_id uuid not null references public.masma_finder_users (id) on delete cascade,
  legacy_firebase_uid text,
  items jsonb not null default '[]'::jsonb,
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  unique (brand_id, finder_user_id)
);

create table if not exists public.masma_finder_move_exports (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  work_date date not null,
  filename text not null,
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_by_legacy_uid text,
  exported_at_local text not null default '',
  item_count integer not null default 0,
  row_count integer not null default 0,
  headers jsonb not null default '[]'::jsonb,
  status text not null default 'exported',
  sheet_synced boolean not null default false,
  sheet_written integer not null default 0,
  sheet_matched integer not null default 0,
  sheet_appended integer not null default 0,
  created_at timestamptz not null default now(),
  legacy_id text,
  unique (brand_id, id)
);

create index if not exists masma_finder_move_exports_date_idx
  on public.masma_finder_move_exports (brand_id, work_date, created_at desc);

create table if not exists public.masma_finder_move_export_rows (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  export_id uuid not null,
  sort_order integer not null default 0,
  move_id text not null default '',
  source_item_id text not null default '',
  move_status text not null default '',
  exported_at_local text not null default '',
  worker_name text not null default '',
  product_name text not null default '',
  location text not null default '',
  type text not null default '',
  move_box_count numeric,
  box_before numeric,
  box_after numeric,
  units_per_box numeric,
  arrival_before text not null default '',
  arrival_after text not null default '',
  document_id text not null default '',
  memo text not null default '',
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (brand_id, id),
  foreign key (brand_id, export_id)
    references public.masma_finder_move_exports (brand_id, id)
    on delete cascade
);

create table if not exists public.masma_finder_label_scans (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  number text not null,
  product_name text not null,
  label_date text not null,
  quantity_per_box integer not null,
  box_count integer not null default 1,
  location text not null default '',
  confidence text not null default 'medium',
  status text not null default 'reviewed',
  created_by uuid references public.masma_finder_users (id),
  created_by_name text not null default '',
  created_by_legacy_uid text,
  created_at timestamptz not null default now()
);

create index if not exists masma_finder_label_scans_created_idx
  on public.masma_finder_label_scans (brand_id, created_at desc);

create table if not exists public.masma_finder_ocr_usage (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  finder_user_id uuid references public.masma_finder_users (id),
  source text not null,
  byte_size integer,
  created_at timestamptz not null default now()
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'masma_finder_work_days',
    'masma_finder_work_templates',
    'masma_finder_work_tasks',
    'masma_finder_work_attachments',
    'masma_finder_incoming_groups',
    'masma_finder_incoming_items',
    'masma_finder_move_drafts',
    'masma_finder_move_exports',
    'masma_finder_move_export_rows',
    'masma_finder_label_scans',
    'masma_finder_ocr_usage'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      v_table
    );
  end loop;
end;
$$;

drop policy if exists masma_finder_work_days_all on public.masma_finder_work_days;
create policy masma_finder_work_days_all on public.masma_finder_work_days
for all to authenticated
using (app.can_use_masma_finder(brand_id))
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_work_templates_all on public.masma_finder_work_templates;
create policy masma_finder_work_templates_all on public.masma_finder_work_templates
for all to authenticated
using (app.can_use_masma_finder(brand_id))
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_work_tasks_all on public.masma_finder_work_tasks;
create policy masma_finder_work_tasks_all on public.masma_finder_work_tasks
for all to authenticated
using (app.can_use_masma_finder(brand_id))
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_work_attachments_all on public.masma_finder_work_attachments;
create policy masma_finder_work_attachments_all on public.masma_finder_work_attachments
for all to authenticated
using (app.can_use_masma_finder(brand_id))
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_incoming_groups_all on public.masma_finder_incoming_groups;
create policy masma_finder_incoming_groups_all on public.masma_finder_incoming_groups
for all to authenticated
using (app.can_use_masma_finder(brand_id))
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_incoming_items_all on public.masma_finder_incoming_items;
create policy masma_finder_incoming_items_all on public.masma_finder_incoming_items
for all to authenticated
using (app.can_use_masma_finder(brand_id))
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_move_drafts_all on public.masma_finder_move_drafts;
create policy masma_finder_move_drafts_all on public.masma_finder_move_drafts
for all to authenticated
using (
  app.can_use_masma_finder(brand_id)
  and finder_user_id = app.current_masma_finder_user_id(brand_id)
)
with check (
  app.can_use_masma_finder(brand_id)
  and finder_user_id = app.current_masma_finder_user_id(brand_id)
);

drop policy if exists masma_finder_move_exports_select on public.masma_finder_move_exports;
create policy masma_finder_move_exports_select on public.masma_finder_move_exports
for select to authenticated
using (
  app.can_use_masma_finder(brand_id)
  and (
    app.is_masma_finder_admin(brand_id)
    or created_by = app.current_masma_finder_user_id(brand_id)
  )
);

drop policy if exists masma_finder_move_exports_write on public.masma_finder_move_exports;
create policy masma_finder_move_exports_write on public.masma_finder_move_exports
for insert to authenticated
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_move_export_rows_select on public.masma_finder_move_export_rows;
create policy masma_finder_move_export_rows_select on public.masma_finder_move_export_rows
for select to authenticated
using (
  exists (
    select 1
    from public.masma_finder_move_exports exports
    where exports.id = masma_finder_move_export_rows.export_id
      and exports.brand_id = masma_finder_move_export_rows.brand_id
      and app.can_use_masma_finder(exports.brand_id)
      and (
        app.is_masma_finder_admin(exports.brand_id)
        or exports.created_by = app.current_masma_finder_user_id(exports.brand_id)
      )
  )
);

drop policy if exists masma_finder_move_export_rows_write on public.masma_finder_move_export_rows;
create policy masma_finder_move_export_rows_write on public.masma_finder_move_export_rows
for insert to authenticated
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_label_scans_all on public.masma_finder_label_scans;
create policy masma_finder_label_scans_all on public.masma_finder_label_scans
for all to authenticated
using (app.can_use_masma_finder(brand_id))
with check (app.can_use_masma_finder(brand_id));

drop policy if exists masma_finder_ocr_usage_select on public.masma_finder_ocr_usage;
create policy masma_finder_ocr_usage_select on public.masma_finder_ocr_usage
for select to authenticated
using (
  app.is_masma_finder_admin(brand_id)
  or finder_user_id = app.current_masma_finder_user_id(brand_id)
);

create or replace function public.start_masma_finder_work_day(
  p_brand_id uuid,
  p_work_date date,
  p_has_inbound boolean
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid;
  v_name text;
  v_day uuid;
  v_template record;
begin
  if not app.can_use_masma_finder(p_brand_id) then
    raise exception 'Finder 권한이 없습니다.';
  end if;
  v_user := app.current_masma_finder_user_id(p_brand_id);
  select display_name into v_name
  from public.masma_finder_users
  where id = v_user;

  insert into public.masma_finder_work_days (
    brand_id, work_date, has_inbound, created_by, created_by_name
  ) values (
    p_brand_id, p_work_date, coalesce(p_has_inbound, false), v_user, coalesce(v_name, '')
  )
  on conflict (brand_id, work_date) do update
    set has_inbound = public.masma_finder_work_days.has_inbound
        or excluded.has_inbound
  returning id into v_day;

  for v_template in
    select title, type
    from public.masma_finder_work_templates
    where brand_id = p_brand_id
      and (coalesce(p_has_inbound, false) or type <> 'inbound')
  loop
    if exists (
      select 1
      from public.masma_finder_work_tasks
      where brand_id = p_brand_id
        and day_id = v_day
        and title = v_template.title
        and type = v_template.type
    ) then
      continue;
    end if;
    insert into public.masma_finder_work_tasks (
      brand_id, day_id, work_date, title, type, status, created_by, created_by_name
    ) values (
      p_brand_id, v_day, p_work_date, v_template.title, v_template.type,
      'pending', v_user, coalesce(v_name, '')
    );
  end loop;

  return v_day;
end;
$$;

create or replace function public.register_masma_finder_work_attachment(
  p_brand_id uuid,
  p_task_id uuid,
  p_kind text,
  p_storage_path text,
  p_original_name text,
  p_byte_size bigint,
  p_content_type text,
  p_sha256 text default null,
  p_legacy_object_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid;
  v_name text;
  v_count integer;
  v_row public.masma_finder_work_attachments%rowtype;
  v_expected text;
begin
  if not app.can_use_masma_finder(p_brand_id) then
    raise exception 'Finder 권한이 없습니다.';
  end if;
  if p_kind not in ('normal', 'completion') then
    raise exception '첨부 구분이 올바르지 않습니다.';
  end if;
  if coalesce(p_byte_size, 0) <= 0 or p_byte_size > 10485760 then
    raise exception '파일은 10MB 이하여야 합니다.';
  end if;
  if not exists (
    select 1
    from public.masma_finder_work_tasks
    where id = p_task_id
      and brand_id = p_brand_id
  ) then
    raise exception '업무를 찾을 수 없습니다.';
  end if;

  v_expected := 'brands/' || p_brand_id::text || '/works/' || p_task_id::text || '/' || p_kind || '/';
  if position(v_expected in coalesce(p_storage_path, '')) <> 1 then
    raise exception '첨부 경로가 브랜드·업무와 맞지 않습니다.';
  end if;

  select count(*) into v_count
  from public.masma_finder_work_attachments
  where brand_id = p_brand_id
    and task_id = p_task_id
    and kind = p_kind;
  if v_count >= 3 then
    raise exception '첨부는 업무당 종류별 3개까지입니다.';
  end if;

  v_user := app.current_masma_finder_user_id(p_brand_id);
  select display_name into v_name
  from public.masma_finder_users
  where id = v_user;

  insert into public.masma_finder_work_attachments (
    brand_id, task_id, kind, original_name, byte_size, content_type,
    storage_path, sha256, legacy_object_path, created_by, created_by_name
  ) values (
    p_brand_id, p_task_id, p_kind, coalesce(p_original_name, 'attachment'),
    p_byte_size, coalesce(nullif(p_content_type, ''), 'application/octet-stream'),
    p_storage_path, p_sha256, p_legacy_object_path, v_user, coalesce(v_name, '')
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'originalName', v_row.original_name,
    'byteSize', v_row.byte_size,
    'contentType', v_row.content_type,
    'storagePath', v_row.storage_path,
    'createdByName', v_row.created_by_name,
    'createdAt', v_row.created_at
  );
end;
$$;

create or replace function public.delete_masma_finder_work_attachment(
  p_brand_id uuid,
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.masma_finder_work_attachments%rowtype;
begin
  if not app.can_use_masma_finder(p_brand_id) then
    raise exception 'Finder 권한이 없습니다.';
  end if;
  delete from public.masma_finder_work_attachments
  where id = p_attachment_id
    and brand_id = p_brand_id
  returning * into v_row;
  if not found then
    raise exception '첨부를 찾을 수 없습니다.';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'storagePath', v_row.storage_path
  );
end;
$$;

create or replace function app.warehouse_finder_style_candidates(p_query text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_normalized text;
  v_candidates text[] := array[]::text[];
begin
  v_normalized := upper(regexp_replace(btrim(coalesce(p_query, '')), '\s+', '', 'g'));
  v_normalized := regexp_replace(v_normalized, '[_/\\]+', '-', 'g');
  v_normalized := regexp_replace(v_normalized, '-+', '-', 'g');
  v_normalized := regexp_replace(v_normalized, '^-|-$', '', 'g');
  if v_normalized = '' then
    return v_candidates;
  end if;
  v_candidates := array_append(v_candidates, v_normalized);
  if v_normalized ~ '^M[0-9]+$' then
    v_candidates := array_append(v_candidates, substr(v_normalized, 2));
  elsif v_normalized ~ '^[0-9]+$' then
    v_candidates := array_append(v_candidates, 'M' || v_normalized);
  end if;
  return v_candidates;
end;
$$;

revoke all on function app.warehouse_finder_style_candidates(text) from public, anon;
grant execute on function app.warehouse_finder_style_candidates(text) to authenticated;

create or replace function public.lookup_masma_finder_style(
  p_brand_id uuid,
  p_style_no text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_candidates text[] := app.warehouse_finder_style_candidates(p_style_no);
  v_row record;
begin
  if not app.can_access_warehouse_finder(p_brand_id) then
    raise exception '상품을 조회할 권한이 없습니다.';
  end if;
  if coalesce(cardinality(v_candidates), 0) = 0 then
    return jsonb_build_object('ok', false);
  end if;

  select style.style_no, style.name
  into v_row
  from public.styles as style
  where style.brand_id = p_brand_id
    and upper(regexp_replace(style.style_no, '\s+', '', 'g')) = any (v_candidates)
  order by
    case
      when upper(regexp_replace(style.style_no, '\s+', '', 'g')) = v_candidates[1] then 0
      else 1
    end
  limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'styleNo', v_row.style_no,
    'productName', v_row.name
  );
end;
$$;

revoke all on function public.start_masma_finder_work_day(uuid, date, boolean) from public, anon;
revoke all on function public.register_masma_finder_work_attachment(uuid, uuid, text, text, text, bigint, text, text, text) from public, anon;
revoke all on function public.delete_masma_finder_work_attachment(uuid, uuid) from public, anon;
revoke all on function public.lookup_masma_finder_style(uuid, text) from public, anon;

grant execute on function public.start_masma_finder_work_day(uuid, date, boolean) to authenticated;
grant execute on function public.register_masma_finder_work_attachment(uuid, uuid, text, text, text, bigint, text, text, text) to authenticated;
grant execute on function public.delete_masma_finder_work_attachment(uuid, uuid) to authenticated;
grant execute on function public.lookup_masma_finder_style(uuid, text) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.masma_finder_work_days;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.masma_finder_work_templates;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.masma_finder_work_tasks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.masma_finder_work_attachments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.masma_finder_incoming_groups;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.masma_finder_incoming_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.masma_finder_move_drafts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.masma_finder_move_exports;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.masma_finder_label_scans;
  exception when duplicate_object then null;
  end;
end;
$$;
