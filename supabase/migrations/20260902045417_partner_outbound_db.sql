-- 거래처 코드는 업체마다 같은 바코드 문자열을 둘 수 있다.
-- 대량출고 Job·임시 반영 출고 원장을 영속한다. 재고 숫자는 바꾸지 않는다.
-- 수령인·전화·주소는 Job·출고 원장에 넣지 않는다.

-- ---------------------------------------------------------------------------
-- product_codes: 업체별 거래처 코드
-- ---------------------------------------------------------------------------

alter table public.product_codes
  add column if not exists usage_target_id uuid;

comment on column public.product_codes.usage_target_id is
  '거래처 코드(kind=partner)의 출고업체. 자사 코드는 NULL.';

alter table public.product_codes
  drop constraint if exists product_codes_brand_code_key;

alter table public.product_codes
  drop constraint if exists product_codes_kind_usage_target_check;

alter table public.product_codes
  add constraint product_codes_kind_usage_target_check
  check (
    (kind = 'own' and usage_target_id is null)
    or (kind = 'partner' and usage_target_id is not null)
  );

alter table public.product_codes
  drop constraint if exists product_codes_usage_target_fkey;

alter table public.product_codes
  add constraint product_codes_usage_target_fkey
  foreign key (brand_id, usage_target_id)
  references public.code_usage_targets (brand_id, id)
  on delete restrict;

drop index if exists product_codes_own_brand_code_key;
create unique index product_codes_own_brand_code_key
  on public.product_codes (brand_id, code)
  where kind = 'own';

drop index if exists product_codes_partner_brand_target_code_key;
create unique index product_codes_partner_brand_target_code_key
  on public.product_codes (brand_id, usage_target_id, code)
  where kind = 'partner';

create index if not exists product_codes_partner_target_idx
  on public.product_codes (brand_id, usage_target_id)
  where kind = 'partner';

-- ---------------------------------------------------------------------------
-- 업체별 거래처 바코드 헤더. 자사 barcode_fields와 섞지 않는다.
-- ---------------------------------------------------------------------------

create table if not exists public.partner_barcode_fields (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  usage_target_id uuid not null,
  label text not null
    check (length(btrim(label)) > 0),
  type text not null default 'text'
    check (type = any (array['text'::text, 'number'::text])),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_barcode_fields_brand_id_id_key unique (brand_id, id),
  constraint partner_barcode_fields_brand_target_label_key
    unique (brand_id, usage_target_id, label),
  constraint partner_barcode_fields_target_fkey
    foreign key (brand_id, usage_target_id)
    references public.code_usage_targets (brand_id, id) on delete restrict
);

comment on table public.partner_barcode_fields is
  '거래처 코드 화면의 업체별 추가 헤더. 값은 product_codes.values에 필드 id를 키로 둔다.';

create index if not exists partner_barcode_fields_target_idx
  on public.partner_barcode_fields (brand_id, usage_target_id, sort_order);

drop trigger if exists partner_barcode_fields_set_updated_at
  on public.partner_barcode_fields;
create trigger partner_barcode_fields_set_updated_at
before update on public.partner_barcode_fields
for each row execute function public.set_updated_at();

alter table public.partner_barcode_fields enable row level security;

drop policy if exists partner_barcode_fields_all_member
  on public.partner_barcode_fields;
create policy partner_barcode_fields_all_member
on public.partner_barcode_fields
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.partner_barcode_fields
to authenticated;

-- ---------------------------------------------------------------------------
-- 대량출고에 등록한 업체·바코드 출처
-- ---------------------------------------------------------------------------

create table if not exists public.bulk_outbound_partner_configs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  usage_target_id uuid not null,
  barcode_source text not null
    check (barcode_source = any (array['own'::text, 'partner'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulk_outbound_partner_configs_brand_id_id_key unique (brand_id, id),
  constraint bulk_outbound_partner_configs_brand_target_key
    unique (brand_id, usage_target_id),
  constraint bulk_outbound_partner_configs_target_fkey
    foreign key (brand_id, usage_target_id)
    references public.code_usage_targets (brand_id, id) on delete restrict
);

comment on table public.bulk_outbound_partner_configs is
  '대량출고 화면에 등록한 출고업체와 바코드 출처. 팀 공유 설정.';

drop trigger if exists bulk_outbound_partner_configs_set_updated_at
  on public.bulk_outbound_partner_configs;
create trigger bulk_outbound_partner_configs_set_updated_at
before update on public.bulk_outbound_partner_configs
for each row execute function public.set_updated_at();

alter table public.bulk_outbound_partner_configs enable row level security;

drop policy if exists bulk_outbound_partner_configs_all_member
  on public.bulk_outbound_partner_configs;
create policy bulk_outbound_partner_configs_all_member
on public.bulk_outbound_partner_configs
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.bulk_outbound_partner_configs
to authenticated;

-- ---------------------------------------------------------------------------
-- 대량출고 Job
-- ---------------------------------------------------------------------------

create table if not exists public.bulk_outbound_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  usage_target_id uuid not null,
  title text not null
    check (length(btrim(title)) > 0),
  status text not null default 'draft'
    check (
      status = any (
        array[
          'draft'::text,
          'converting'::text,
          'backup'::text,
          'docs'::text,
          'done'::text
        ]
      )
    ),
  barcode_source text not null
    check (barcode_source = any (array['own'::text, 'partner'::text])),
  started_on date not null default (timezone('Asia/Seoul', now()))::date,
  due_on date not null,
  assignee text not null default '',
  note text not null default '',
  planned_qty integer not null default 0
    check (planned_qty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulk_outbound_jobs_brand_id_id_key unique (brand_id, id),
  constraint bulk_outbound_jobs_target_fkey
    foreign key (brand_id, usage_target_id)
    references public.code_usage_targets (brand_id, id) on delete restrict
);

comment on table public.bulk_outbound_jobs is
  '대량출고 작업 1건. 수령인·전화·주소는 두지 않는다.';

create index if not exists bulk_outbound_jobs_brand_status_idx
  on public.bulk_outbound_jobs (brand_id, status, updated_at desc);

create index if not exists bulk_outbound_jobs_brand_target_idx
  on public.bulk_outbound_jobs (brand_id, usage_target_id, updated_at desc);

drop trigger if exists bulk_outbound_jobs_set_updated_at
  on public.bulk_outbound_jobs;
create trigger bulk_outbound_jobs_set_updated_at
before update on public.bulk_outbound_jobs
for each row execute function public.set_updated_at();

alter table public.bulk_outbound_jobs enable row level security;

drop policy if exists bulk_outbound_jobs_all_member
  on public.bulk_outbound_jobs;
create policy bulk_outbound_jobs_all_member
on public.bulk_outbound_jobs
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.bulk_outbound_jobs
to authenticated;

create table if not exists public.bulk_outbound_job_lines (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  job_id uuid not null,
  barcode text not null default '',
  order_qty integer not null default 0
    check (order_qty >= 0),
  product_name text not null default '',
  source_row_no integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulk_outbound_job_lines_brand_id_id_key unique (brand_id, id),
  constraint bulk_outbound_job_lines_job_fkey
    foreign key (brand_id, job_id)
    references public.bulk_outbound_jobs (brand_id, id) on delete cascade
);

comment on table public.bulk_outbound_job_lines is
  '작업 엑셀의 비개인정보 행. 바코드·수량·상품명만 둔다.';

create index if not exists bulk_outbound_job_lines_job_idx
  on public.bulk_outbound_job_lines (brand_id, job_id, source_row_no);

drop trigger if exists bulk_outbound_job_lines_set_updated_at
  on public.bulk_outbound_job_lines;
create trigger bulk_outbound_job_lines_set_updated_at
before update on public.bulk_outbound_job_lines
for each row execute function public.set_updated_at();

alter table public.bulk_outbound_job_lines enable row level security;

drop policy if exists bulk_outbound_job_lines_all_member
  on public.bulk_outbound_job_lines;
create policy bulk_outbound_job_lines_all_member
on public.bulk_outbound_job_lines
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.bulk_outbound_job_lines
to authenticated;

create table if not exists public.bulk_outbound_job_files (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  job_id uuid not null,
  file_name text not null
    check (length(btrim(file_name)) > 0),
  file_size bigint not null default 0
    check (file_size >= 0),
  kept_on date not null default (timezone('Asia/Seoul', now()))::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulk_outbound_job_files_brand_id_id_key unique (brand_id, id),
  constraint bulk_outbound_job_files_job_fkey
    foreign key (brand_id, job_id)
    references public.bulk_outbound_jobs (brand_id, id) on delete cascade
);

comment on table public.bulk_outbound_job_files is
  '대량출고 증빙 파일 메타. 셀 내용과 원본 바이트는 브라우저에만 둔다.';

create index if not exists bulk_outbound_job_files_job_idx
  on public.bulk_outbound_job_files (brand_id, job_id);

drop trigger if exists bulk_outbound_job_files_set_updated_at
  on public.bulk_outbound_job_files;
create trigger bulk_outbound_job_files_set_updated_at
before update on public.bulk_outbound_job_files
for each row execute function public.set_updated_at();

alter table public.bulk_outbound_job_files enable row level security;

drop policy if exists bulk_outbound_job_files_all_member
  on public.bulk_outbound_job_files;
create policy bulk_outbound_job_files_all_member
on public.bulk_outbound_job_files
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.bulk_outbound_job_files
to authenticated;

-- ---------------------------------------------------------------------------
-- 운영 현황 출고 원장
-- ---------------------------------------------------------------------------

create table if not exists public.outbound_shipments (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  style_id uuid not null,
  usage_target_id uuid not null,
  shipped_on date not null,
  quantity integer not null
    check (quantity > 0),
  source text not null
    check (source = any (array['invoice'::text, 'bulk'::text, 'manual'::text])),
  source_ref text,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_shipments_brand_id_id_key unique (brand_id, id),
  constraint outbound_shipments_idempotent_key
    unique (
      brand_id,
      source,
      source_ref,
      style_id,
      usage_target_id,
      shipped_on
    ),
  constraint outbound_shipments_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id) on delete restrict,
  constraint outbound_shipments_target_fkey
    foreign key (brand_id, usage_target_id)
    references public.code_usage_targets (brand_id, id) on delete restrict
);

comment on table public.outbound_shipments is
  '운영 현황 M번호 일별 출고 원장. 재고 차감과 분리한다.';
comment on column public.outbound_shipments.source_ref is
  'bulk면 bulk_outbound_jobs.id. invoice 브릿지는 이번 범위에 없다.';
comment on column public.outbound_shipments.note is
  'bulk-backup:{jobId} 호환 표기 등 짧은 메모.';

create index if not exists outbound_shipments_brand_shipped_idx
  on public.outbound_shipments (brand_id, shipped_on desc);

create index if not exists outbound_shipments_brand_style_idx
  on public.outbound_shipments (brand_id, style_id, shipped_on desc);

create index if not exists outbound_shipments_brand_source_ref_idx
  on public.outbound_shipments (brand_id, source, source_ref);

drop trigger if exists outbound_shipments_set_updated_at
  on public.outbound_shipments;
create trigger outbound_shipments_set_updated_at
before update on public.outbound_shipments
for each row execute function public.set_updated_at();

alter table public.outbound_shipments enable row level security;

drop policy if exists outbound_shipments_all_member
  on public.outbound_shipments;
create policy outbound_shipments_all_member
on public.outbound_shipments
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.outbound_shipments
to authenticated;

-- ---------------------------------------------------------------------------
-- save_product_code_with_components: 거래처 코드 usage_target_id
-- ---------------------------------------------------------------------------

create or replace function public.save_product_code_with_components(
  p_brand_id uuid,
  p_id uuid,
  p_kind text,
  p_code text,
  p_name text,
  p_weight_g integer,
  p_width_cm numeric,
  p_depth_cm numeric,
  p_height_cm numeric,
  p_note text,
  p_values jsonb,
  p_components jsonb,
  p_usage_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  v_id uuid;
  v_usage_target_id uuid;
  comp jsonb;
  i integer := 0;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_kind not in ('own', 'partner') then
    raise exception '코드 종류가 올바르지 않습니다.';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception '코드명을 입력하세요.';
  end if;
  if nullif(trim(p_code), '') is null then
    raise exception '코드값을 입력하세요.';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception '추가 항목 형식이 올바르지 않습니다.';
  end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' then
    raise exception '구성품 형식이 올바르지 않습니다.';
  end if;

  if p_kind = 'own' then
    v_usage_target_id := null;
  else
    v_usage_target_id := p_usage_target_id;
    if v_usage_target_id is null and p_id is not null then
      select usage_target_id
        into v_usage_target_id
      from public.product_codes
      where id = p_id and brand_id = p_brand_id;
    end if;
    if v_usage_target_id is null then
      raise exception '거래처 코드는 업체가 필요합니다.';
    end if;
  end if;

  if p_id is null then
    insert into public.product_codes (
      brand_id, kind, usage_target_id, code, name, weight_g, width_cm, depth_cm, height_cm,
      note, values
    ) values (
      p_brand_id, p_kind, v_usage_target_id, trim(p_code), trim(p_name),
      p_weight_g, p_width_cm, p_depth_cm, p_height_cm,
      coalesce(p_note, ''), p_values
    )
    returning id into v_id;
  else
    update public.product_codes
    set kind = p_kind,
        usage_target_id = v_usage_target_id,
        code = trim(p_code),
        name = trim(p_name),
        weight_g = p_weight_g,
        width_cm = p_width_cm,
        depth_cm = p_depth_cm,
        height_cm = p_height_cm,
        note = coalesce(p_note, ''),
        values = p_values,
        updated_at = now()
    where id = p_id and brand_id = p_brand_id
    returning id into v_id;

    if v_id is null then
      raise exception '코드를 찾을 수 없습니다.';
    end if;

    delete from public.product_code_components where product_code_id = v_id;
  end if;

  for comp in select * from jsonb_array_elements(p_components)
  loop
    i := i + 1;
    insert into public.product_code_components (
      brand_id, product_code_id, style_id, style_no, qty, sort_order
    ) values (
      p_brand_id,
      v_id,
      (comp->>'styleId')::uuid,
      coalesce(comp->>'styleNo', ''),
      greatest(1, coalesce((comp->>'qty')::int, 1)),
      i
    );
  end loop;

  return v_id;
end;
$function$;

create or replace function public.save_product_code_with_components(
  p_brand_id uuid,
  p_id uuid,
  p_kind text,
  p_code text,
  p_name text,
  p_weight_g integer,
  p_width_cm numeric,
  p_depth_cm numeric,
  p_height_cm numeric,
  p_note text,
  p_values jsonb,
  p_components jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
begin
  return public.save_product_code_with_components(
    p_brand_id,
    p_id,
    p_kind,
    p_code,
    p_name,
    p_weight_g,
    p_width_cm,
    p_depth_cm,
    p_height_cm,
    p_note,
    p_values,
    p_components,
    null
  );
end;
$function$;

grant execute on function public.save_product_code_with_components(
  uuid, uuid, text, text, text, integer, numeric, numeric, numeric, text, jsonb, jsonb, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 거래처 헤더·코드 통째 교체
-- ---------------------------------------------------------------------------

create or replace function public.replace_partner_barcode_fields(
  p_brand_id uuid,
  p_usage_target_id uuid,
  p_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  item jsonb;
  v_id uuid;
  v_label text;
  v_type text;
  v_order integer := 0;
  kept uuid[] := '{}';
  result jsonb := '[]'::jsonb;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception '헤더 형식이 올바르지 않습니다.';
  end if;

  for item in select * from jsonb_array_elements(p_fields)
  loop
    v_order := v_order + 1;
    v_label := btrim(coalesce(item->>'label', ''));
    if v_label = '' then
      raise exception '헤더 이름을 입력하세요.';
    end if;
    v_type := case when item->>'type' = 'number' then 'number' else 'text' end;
    v_id := null;
    begin
      v_id := (item->>'id')::uuid;
    exception
      when invalid_text_representation then
        v_id := null;
    end;

    if v_id is not null
      and exists (
        select 1
        from public.partner_barcode_fields
        where id = v_id
          and brand_id = p_brand_id
          and usage_target_id = p_usage_target_id
      )
    then
      update public.partner_barcode_fields
      set label = v_label,
          type = v_type,
          sort_order = v_order,
          updated_at = now()
      where id = v_id;
    else
      insert into public.partner_barcode_fields (
        brand_id, usage_target_id, label, type, sort_order
      ) values (
        p_brand_id, p_usage_target_id, v_label, v_type, v_order
      )
      returning id into v_id;
    end if;

    kept := array_append(kept, v_id);
    result := result || jsonb_build_array(
      jsonb_build_object(
        'id', v_id,
        'label', v_label,
        'type', v_type,
        'order', v_order
      )
    );
  end loop;

  delete from public.partner_barcode_fields
  where brand_id = p_brand_id
    and usage_target_id = p_usage_target_id
    and not (id = any (kept));

  return result;
end;
$function$;

create or replace function public.replace_partner_codes(
  p_brand_id uuid,
  p_usage_target_id uuid,
  p_codes jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  item jsonb;
  v_id uuid;
  v_code text;
  v_name text;
  v_values jsonb;
  v_components jsonb;
  kept uuid[] := '{}';
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_codes is null or jsonb_typeof(p_codes) <> 'array' then
    raise exception '코드 목록 형식이 올바르지 않습니다.';
  end if;

  for item in select * from jsonb_array_elements(p_codes)
  loop
    v_code := btrim(coalesce(item->>'code', ''));
    if v_code = '' then
      continue;
    end if;
    v_name := btrim(coalesce(item->>'name', ''));
    if v_name = '' then
      v_name := v_code;
    end if;
    v_values := coalesce(item->'values', '{}'::jsonb);
    if jsonb_typeof(v_values) <> 'object' then
      v_values := '{}'::jsonb;
    end if;
    v_components := coalesce(item->'components', '[]'::jsonb);
    if jsonb_typeof(v_components) <> 'array' then
      v_components := '[]'::jsonb;
    end if;

    v_id := null;
    begin
      v_id := (item->>'id')::uuid;
    exception
      when invalid_text_representation then
        v_id := null;
    end;
    if v_id is not null
      and not exists (
        select 1
        from public.product_codes
        where id = v_id
          and brand_id = p_brand_id
          and kind = 'partner'
          and usage_target_id = p_usage_target_id
      )
    then
      v_id := null;
    end if;

    v_id := public.save_product_code_with_components(
      p_brand_id,
      v_id,
      'partner',
      v_code,
      v_name,
      null,
      null,
      null,
      null,
      '',
      v_values,
      v_components,
      p_usage_target_id
    );
    kept := array_append(kept, v_id);
  end loop;

  delete from public.product_codes
  where brand_id = p_brand_id
    and kind = 'partner'
    and usage_target_id = p_usage_target_id
    and not (id = any (kept));
end;
$function$;

grant execute on function public.replace_partner_barcode_fields(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.replace_partner_codes(uuid, uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 대량출고 Job 저장
-- ---------------------------------------------------------------------------

create or replace function public.save_bulk_outbound_job(
  p_brand_id uuid,
  p_id uuid,
  p_usage_target_id uuid,
  p_title text,
  p_status text,
  p_barcode_source text,
  p_started_on date,
  p_due_on date,
  p_assignee text,
  p_note text,
  p_planned_qty integer,
  p_lines jsonb,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  v_id uuid;
  item jsonb;
  v_file_id uuid;
  i integer := 0;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception '작업 제목을 입력하세요.';
  end if;
  if p_status not in ('draft', 'converting', 'backup', 'docs', 'done') then
    raise exception '작업 상태가 올바르지 않습니다.';
  end if;
  if p_barcode_source not in ('own', 'partner') then
    raise exception '바코드 출처가 올바르지 않습니다.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception '작업 행 형식이 올바르지 않습니다.';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception '파일 메타 형식이 올바르지 않습니다.';
  end if;

  if p_id is null then
    insert into public.bulk_outbound_jobs (
      brand_id, usage_target_id, title, status, barcode_source,
      started_on, due_on, assignee, note, planned_qty
    ) values (
      p_brand_id,
      p_usage_target_id,
      btrim(p_title),
      p_status,
      p_barcode_source,
      coalesce(p_started_on, (timezone('Asia/Seoul', now()))::date),
      coalesce(p_due_on, (timezone('Asia/Seoul', now()))::date),
      coalesce(p_assignee, ''),
      coalesce(p_note, ''),
      greatest(0, coalesce(p_planned_qty, 0))
    )
    returning id into v_id;
  else
    update public.bulk_outbound_jobs
    set usage_target_id = p_usage_target_id,
        title = btrim(p_title),
        status = p_status,
        barcode_source = p_barcode_source,
        started_on = coalesce(p_started_on, started_on),
        due_on = coalesce(p_due_on, due_on),
        assignee = coalesce(p_assignee, assignee),
        note = coalesce(p_note, note),
        planned_qty = greatest(0, coalesce(p_planned_qty, planned_qty)),
        updated_at = now()
    where id = p_id and brand_id = p_brand_id
    returning id into v_id;

    if v_id is null then
      raise exception '작업을 찾을 수 없습니다.';
    end if;
  end if;

  delete from public.bulk_outbound_job_lines
  where brand_id = p_brand_id and job_id = v_id;

  for item in select * from jsonb_array_elements(p_lines)
  loop
    i := i + 1;
    insert into public.bulk_outbound_job_lines (
      brand_id, job_id, barcode, order_qty, product_name, source_row_no
    ) values (
      p_brand_id,
      v_id,
      coalesce(item->>'barcode', ''),
      greatest(0, coalesce((item->>'orderQty')::int, 0)),
      coalesce(item->>'productName', ''),
      coalesce((item->>'sourceRowNo')::int, i)
    );
  end loop;

  delete from public.bulk_outbound_job_files
  where brand_id = p_brand_id and job_id = v_id;

  for item in select * from jsonb_array_elements(p_files)
  loop
    v_file_id := null;
    begin
      v_file_id := (item->>'id')::uuid;
    exception
      when invalid_text_representation then
        v_file_id := null;
    end;
    insert into public.bulk_outbound_job_files (
      id, brand_id, job_id, file_name, file_size, kept_on
    ) values (
      coalesce(v_file_id, gen_random_uuid()),
      p_brand_id,
      v_id,
      btrim(coalesce(item->>'name', item->>'fileName', 'file')),
      greatest(0, coalesce((item->>'fileSize')::bigint, 0)),
      coalesce((item->>'keptOn')::date, (timezone('Asia/Seoul', now()))::date)
    );
  end loop;

  return v_id;
end;
$function$;

grant execute on function public.save_bulk_outbound_job(
  uuid, uuid, uuid, text, text, text, date, date, text, text, integer, jsonb, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- 임시 반영 → outbound_shipments. 재고 RPC는 호출하지 않는다.
-- ---------------------------------------------------------------------------

create or replace function public.replace_bulk_outbound_backup(
  p_brand_id uuid,
  p_job_id uuid,
  p_usage_target_id uuid,
  p_shipped_on date,
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
  v_qty integer;
  v_note text;
  v_count integer := 0;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if not exists (
    select 1
    from public.bulk_outbound_jobs
    where id = p_job_id and brand_id = p_brand_id
  ) then
    raise exception '작업을 찾을 수 없습니다.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;

  v_note := 'bulk-backup:' || p_job_id::text;

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and source_ref = p_job_id::text;

  for item in select * from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        v_style_id := null;
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);
    if v_style_id is null or v_qty <= 0 then
      continue;
    end if;
    if not exists (
      select 1
      from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      continue;
    end if;

    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      v_style_id,
      p_usage_target_id,
      coalesce(p_shipped_on, (timezone('Asia/Seoul', now()))::date),
      v_qty,
      'bulk',
      p_job_id::text,
      v_note
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

grant execute on function public.replace_bulk_outbound_backup(
  uuid, uuid, uuid, date, jsonb
) to authenticated;
