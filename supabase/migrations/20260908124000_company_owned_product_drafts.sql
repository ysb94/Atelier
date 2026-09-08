-- 기획안만 회사 소유. brand_id는 nullable이고 PL번호는 회사 공통이다.
-- styles·코드·물류 등 운영 행의 brand_id NOT NULL 경계는 유지한다.

create or replace function app.can_read_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    target_company_id is not null
    and (
      app.is_admin()
      or (
        app.is_approved()
        and exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.company_id = target_company_id
        )
      )
    );
$function$;

create or replace function app.can_edit_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select app.is_admin()
    or (app.can_read_company(target_company_id) and app.has_any_capability());
$function$;

create or replace function app.draft_brand_in_company(
  target_company_id uuid,
  target_brand_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    target_brand_id is null
    or exists (
      select 1
      from public.brands b
      where b.id = target_brand_id
        and b.company_id = target_company_id
    );
$function$;

alter table public.product_drafts
  add column if not exists company_id uuid references public.companies(id);

update public.product_drafts d
set company_id = b.company_id
from public.brands b
where b.id = d.brand_id
  and d.company_id is null;

alter table public.product_drafts
  alter column company_id set not null;

alter table public.draft_colors
  add column if not exists company_id uuid references public.companies(id);

update public.draft_colors c
set company_id = d.company_id
from public.product_drafts d
where d.id = c.draft_id
  and c.company_id is null;

alter table public.draft_colors
  alter column company_id set not null;

alter table public.draft_options
  add column if not exists company_id uuid references public.companies(id);

update public.draft_options o
set company_id = d.company_id
from public.product_drafts d
where d.id = o.draft_id
  and o.company_id is null;

alter table public.draft_options
  alter column company_id set not null;

alter table public.draft_colors
  drop constraint if exists draft_colors_draft_brand_fkey;
alter table public.draft_options
  drop constraint if exists draft_options_draft_brand_fkey;

alter table public.product_drafts
  drop constraint if exists product_drafts_brand_draft_no_key;

alter table public.product_drafts
  add constraint product_drafts_company_draft_no_key unique (company_id, draft_no);

alter table public.product_drafts
  add constraint product_drafts_company_id_id_key unique (company_id, id);

alter table public.product_drafts
  alter column brand_id drop not null;
alter table public.draft_colors
  alter column brand_id drop not null;
alter table public.draft_options
  alter column brand_id drop not null;

alter table public.product_drafts
  drop constraint if exists product_drafts_season_needs_brand;
alter table public.product_drafts
  add constraint product_drafts_season_needs_brand
  check (season_id is null or brand_id is not null);

alter table public.product_drafts
  drop constraint if exists product_drafts_promoted_needs_brand;
alter table public.product_drafts
  add constraint product_drafts_promoted_needs_brand
  check (promoted_style_id is null or brand_id is not null);

alter table public.product_drafts
  drop constraint if exists product_drafts_confirmed_needs_brand;
alter table public.product_drafts
  add constraint product_drafts_confirmed_needs_brand
  check (status <> 'confirmed' or brand_id is not null);

alter table public.draft_options
  drop constraint if exists draft_options_style_needs_brand;
alter table public.draft_options
  add constraint draft_options_style_needs_brand
  check (style_id is null or brand_id is not null);

alter table public.draft_colors
  add constraint draft_colors_draft_company_fkey
  foreign key (company_id, draft_id)
  references public.product_drafts (company_id, id)
  on delete cascade;

alter table public.draft_options
  add constraint draft_options_draft_company_fkey
  foreign key (company_id, draft_id)
  references public.product_drafts (company_id, id)
  on delete cascade;

create index if not exists product_drafts_company_id_idx
  on public.product_drafts (company_id);
create index if not exists product_drafts_company_brand_idx
  on public.product_drafts (company_id, brand_id);

create table if not exists public.company_draft_sequences (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_value integer not null,
  updated_at timestamptz not null default now()
);

insert into public.company_draft_sequences (company_id, last_value)
select
  b.company_id,
  max(greatest(s.last_value, coalesce(used.max_used, 0)))
from public.draft_sequences s
join public.brands b on b.id = s.brand_id
left join (
  select
    company_id,
    max(nullif(substring(draft_no from '^PL-(\d+)$'), '')::int) as max_used
  from public.product_drafts
  group by company_id
) used on used.company_id = b.company_id
group by b.company_id
on conflict (company_id) do update
  set last_value = greatest(public.company_draft_sequences.last_value, excluded.last_value);

insert into public.company_draft_sequences (company_id, last_value)
select
  d.company_id,
  max(coalesce(nullif(substring(d.draft_no from '^PL-(\d+)$'), '')::int, 0))
from public.product_drafts d
where not exists (
  select 1
  from public.company_draft_sequences s
  where s.company_id = d.company_id
)
group by d.company_id;

alter table public.company_draft_sequences enable row level security;
grant select on public.company_draft_sequences to authenticated;

drop policy if exists company_draft_sequences_select on public.company_draft_sequences;
create policy company_draft_sequences_select
on public.company_draft_sequences
for select
to authenticated
using (app.can_read_company(company_id));

drop table if exists public.draft_sequences;

drop policy if exists product_drafts_all_member on public.product_drafts;
drop policy if exists draft_colors_all_member on public.draft_colors;
drop policy if exists draft_options_all_member on public.draft_options;

drop policy if exists product_drafts_select on public.product_drafts;
create policy product_drafts_select
on public.product_drafts
for select
to authenticated
using (app.can_read_company(company_id));

drop policy if exists product_drafts_insert on public.product_drafts;
create policy product_drafts_insert
on public.product_drafts
for insert
to authenticated
with check (
  app.can_edit_company(company_id)
  and app.draft_brand_in_company(company_id, brand_id)
);

drop policy if exists product_drafts_update on public.product_drafts;
create policy product_drafts_update
on public.product_drafts
for update
to authenticated
using (app.can_edit_company(company_id))
with check (
  app.can_edit_company(company_id)
  and app.draft_brand_in_company(company_id, brand_id)
);

drop policy if exists product_drafts_delete on public.product_drafts;
create policy product_drafts_delete
on public.product_drafts
for delete
to authenticated
using (app.can_edit_company(company_id));

drop policy if exists draft_colors_select on public.draft_colors;
create policy draft_colors_select
on public.draft_colors
for select
to authenticated
using (app.can_read_company(company_id));

drop policy if exists draft_colors_insert on public.draft_colors;
create policy draft_colors_insert
on public.draft_colors
for insert
to authenticated
with check (
  app.can_edit_company(company_id)
  and app.draft_brand_in_company(company_id, brand_id)
);

drop policy if exists draft_colors_update on public.draft_colors;
create policy draft_colors_update
on public.draft_colors
for update
to authenticated
using (app.can_edit_company(company_id))
with check (
  app.can_edit_company(company_id)
  and app.draft_brand_in_company(company_id, brand_id)
);

drop policy if exists draft_colors_delete on public.draft_colors;
create policy draft_colors_delete
on public.draft_colors
for delete
to authenticated
using (app.can_edit_company(company_id));

drop policy if exists draft_options_select on public.draft_options;
create policy draft_options_select
on public.draft_options
for select
to authenticated
using (app.can_read_company(company_id));

drop policy if exists draft_options_insert on public.draft_options;
create policy draft_options_insert
on public.draft_options
for insert
to authenticated
with check (
  app.can_edit_company(company_id)
  and app.draft_brand_in_company(company_id, brand_id)
);

drop policy if exists draft_options_update on public.draft_options;
create policy draft_options_update
on public.draft_options
for update
to authenticated
using (app.can_edit_company(company_id))
with check (
  app.can_edit_company(company_id)
  and app.draft_brand_in_company(company_id, brand_id)
);

drop policy if exists draft_options_delete on public.draft_options;
create policy draft_options_delete
on public.draft_options
for delete
to authenticated
using (app.can_edit_company(company_id));

drop function if exists public.issue_draft_no(uuid);
drop function if exists public.save_product_draft(uuid, uuid, jsonb, jsonb, jsonb);

create or replace function public.issue_draft_no(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  max_used integer;
  next_value integer;
begin
  if not app.can_edit_company(p_company_id) then
    raise exception '기획안을 저장할 권한이 없습니다.';
  end if;

  select coalesce(max(nullif(substring(draft_no from '^PL-(\d+)$'), '')::int), 0)
  into max_used
  from public.product_drafts
  where company_id = p_company_id;

  insert into public.company_draft_sequences (company_id, last_value)
  values (p_company_id, max_used + 1)
  on conflict (company_id) do update
    set last_value = greatest(public.company_draft_sequences.last_value, max_used) + 1,
        updated_at = now()
  returning last_value into next_value;

  return 'PL-' || lpad(next_value::text, 4, '0');
end;
$function$;

revoke all on function public.issue_draft_no(uuid) from public, anon, authenticated;
grant execute on function public.issue_draft_no(uuid) to postgres, service_role;

create or replace function public.save_product_draft(
  p_company_id uuid,
  p_brand_id uuid,
  p_id uuid,
  p_payload jsonb,
  p_colors jsonb,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  v_id uuid;
  v_draft_no text;
  v_status text;
  v_season_id uuid;
  v_style_id uuid;
  v_existing public.product_drafts%rowtype;
  color jsonb;
  opt jsonb;
  i integer;
  child_id uuid;
begin
  if not app.can_edit_company(p_company_id) then
    raise exception '기획안을 저장할 권한이 없습니다.';
  end if;
  if not app.draft_brand_in_company(p_company_id, p_brand_id) then
    raise exception '다른 회사 브랜드에는 배정할 수 없습니다.';
  end if;

  v_status := coalesce(p_payload->>'status', 'open');
  if v_status = 'confirmed' and p_brand_id is null then
    raise exception '출시 확정 전에 브랜드를 지정하세요.';
  end if;

  v_season_id := nullif(p_payload->>'seasonId', '')::uuid;
  if v_season_id is not null then
    if p_brand_id is null then
      raise exception '브랜드를 정한 뒤에만 출시 기획을 연결할 수 있습니다.';
    end if;
    if not exists (
      select 1
      from public.seasons s
      where s.id = v_season_id
        and s.brand_id = p_brand_id
    ) then
      raise exception '출시 기획이 선택한 브랜드와 맞지 않습니다.';
    end if;
  end if;

  for opt in select * from jsonb_array_elements(coalesce(p_options, '[]'::jsonb))
  loop
    v_style_id := nullif(opt->>'styleId', '')::uuid;
    if v_style_id is not null then
      if p_brand_id is null then
        raise exception '브랜드를 정한 뒤에만 기존 상품을 연결할 수 있습니다.';
      end if;
      if not exists (
        select 1
        from public.styles s
        where s.id = v_style_id
          and s.brand_id = p_brand_id
      ) then
        raise exception '옵션 상품이 선택한 브랜드와 맞지 않습니다.';
      end if;
    end if;
  end loop;

  if p_id is null then
    v_draft_no := public.issue_draft_no(p_company_id);
    insert into public.product_drafts (
      company_id, brand_id, season_id, draft_no, status, owner, name_ko, name_en, image_url,
      sample_done, order_done, photo_sample_done, held, hold_reason, held_at,
      target_cost, cost_currency, cost_confirmed, retail_price, discount_price,
      origin_country, register_type, open_type, open_type_detail, release_issue,
      specs, has_options, note
    ) values (
      p_company_id,
      p_brand_id,
      v_season_id,
      v_draft_no,
      v_status,
      coalesce(p_payload->>'owner', ''),
      coalesce(p_payload->>'nameKo', ''),
      coalesce(p_payload->>'nameEn', ''),
      nullif(p_payload->>'imageUrl', ''),
      coalesce((p_payload->>'sampleDone')::boolean, false),
      coalesce((p_payload->>'orderDone')::boolean, false),
      coalesce((p_payload->>'photoSampleDone')::boolean, false),
      coalesce((p_payload->>'held')::boolean, false),
      coalesce(p_payload->>'holdReason', ''),
      case when coalesce((p_payload->>'held')::boolean, false)
        then coalesce((p_payload->>'heldAt')::timestamptz, now()) else null end,
      nullif(p_payload->>'targetCost', '')::numeric,
      coalesce(p_payload->>'costCurrency', 'CNY'),
      coalesce((p_payload->>'costConfirmed')::boolean, false),
      nullif(p_payload->>'retailPrice', '')::numeric,
      nullif(p_payload->>'discountPrice', '')::numeric,
      coalesce(p_payload->>'originCountry', ''),
      coalesce(p_payload->>'registerType', ''),
      coalesce(p_payload->>'openType', ''),
      coalesce(p_payload->>'openTypeDetail', ''),
      coalesce(p_payload->>'releaseIssue', ''),
      coalesce(p_payload->'specs', '{}'::jsonb),
      coalesce((p_payload->>'hasOptions')::boolean, false),
      coalesce(p_payload->>'note', '')
    )
    returning id into v_id;
  else
    select * into v_existing
    from public.product_drafts
    where id = p_id
      and company_id = p_company_id
    for update;
    if not found then
      raise exception '기획안을 찾을 수 없습니다.';
    end if;
    if v_existing.status = 'confirmed'
      and v_existing.brand_id is distinct from p_brand_id then
      raise exception '출시 확정된 기획안은 브랜드를 바꿀 수 없습니다.';
    end if;

    update public.product_drafts set
      brand_id = p_brand_id,
      season_id = v_season_id,
      status = v_status,
      owner = coalesce(p_payload->>'owner', ''),
      name_ko = coalesce(p_payload->>'nameKo', ''),
      name_en = coalesce(p_payload->>'nameEn', ''),
      image_url = nullif(p_payload->>'imageUrl', ''),
      sample_done = coalesce((p_payload->>'sampleDone')::boolean, false),
      order_done = coalesce((p_payload->>'orderDone')::boolean, false),
      photo_sample_done = coalesce((p_payload->>'photoSampleDone')::boolean, false),
      held = coalesce((p_payload->>'held')::boolean, false),
      hold_reason = coalesce(p_payload->>'holdReason', ''),
      held_at = case when coalesce((p_payload->>'held')::boolean, false)
        then coalesce(held_at, coalesce((p_payload->>'heldAt')::timestamptz, now()))
        else null end,
      target_cost = nullif(p_payload->>'targetCost', '')::numeric,
      cost_currency = coalesce(p_payload->>'costCurrency', 'CNY'),
      cost_confirmed = coalesce((p_payload->>'costConfirmed')::boolean, false),
      retail_price = nullif(p_payload->>'retailPrice', '')::numeric,
      discount_price = nullif(p_payload->>'discountPrice', '')::numeric,
      origin_country = coalesce(p_payload->>'originCountry', ''),
      register_type = coalesce(p_payload->>'registerType', ''),
      open_type = coalesce(p_payload->>'openType', ''),
      open_type_detail = coalesce(p_payload->>'openTypeDetail', ''),
      release_issue = coalesce(p_payload->>'releaseIssue', ''),
      specs = coalesce(p_payload->'specs', '{}'::jsonb),
      has_options = coalesce((p_payload->>'hasOptions')::boolean, false),
      note = coalesce(p_payload->>'note', ''),
      updated_at = now()
    where id = p_id
      and company_id = p_company_id
    returning id into v_id;

    delete from public.draft_colors where draft_id = v_id;
    delete from public.draft_options where draft_id = v_id;
  end if;

  i := 0;
  for color in select * from jsonb_array_elements(coalesce(p_colors, '[]'::jsonb))
  loop
    i := i + 1;
    begin
      child_id := nullif(color->>'id', '')::uuid;
    exception when others then
      child_id := null;
    end;
    insert into public.draft_colors (
      id, company_id, brand_id, draft_id, name, order_qty, sort_order
    ) values (
      coalesce(child_id, gen_random_uuid()),
      p_company_id,
      p_brand_id,
      v_id,
      coalesce(color->>'name', ''),
      nullif(color->>'orderQty', '')::int,
      i
    );
  end loop;

  i := 0;
  for opt in select * from jsonb_array_elements(coalesce(p_options, '[]'::jsonb))
  loop
    i := i + 1;
    begin
      child_id := nullif(opt->>'id', '')::uuid;
    exception when others then
      child_id := null;
    end;
    insert into public.draft_options (
      id, company_id, brand_id, draft_id, style_id, name, price, sort_order
    ) values (
      coalesce(child_id, gen_random_uuid()),
      p_company_id,
      p_brand_id,
      v_id,
      nullif(opt->>'styleId', '')::uuid,
      coalesce(opt->>'name', ''),
      nullif(opt->>'price', '')::numeric,
      i
    );
  end loop;

  return v_id;
end;
$function$;

grant execute on function public.save_product_draft(uuid, uuid, uuid, jsonb, jsonb, jsonb)
  to authenticated, postgres;

create or replace function public.promote_product_draft(
  p_draft_id uuid,
  p_style_no text,
  p_season_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  d public.product_drafts%rowtype;
  v_season_id uuid;
  v_style_id uuid;
  v_colors text[];
  v_name text;
begin
  select * into d from public.product_drafts where id = p_draft_id for update;
  if not found then
    raise exception '기획안을 찾을 수 없습니다.';
  end if;
  if not app.can_edit_company(d.company_id) then
    raise exception '기획안을 저장할 권한이 없습니다.';
  end if;
  if d.brand_id is null then
    raise exception '상품으로 넘기기 전에 브랜드를 지정하세요.';
  end if;
  if d.promoted_style_id is not null then
    return d.promoted_style_id;
  end if;

  v_season_id := coalesce(p_season_id, d.season_id);
  if v_season_id is null then
    raise exception '출시 기획을 먼저 연결하세요.';
  end if;

  v_name := nullif(trim(d.name_ko), '');
  if v_name is null then
    v_name := nullif(trim(d.name_en), '');
  end if;
  if v_name is null then
    v_name := d.draft_no;
  end if;

  if nullif(trim(p_style_no), '') is null then
    raise exception '품번을 입력하세요.';
  end if;

  select coalesce(array_agg(name order by sort_order) filter (where nullif(trim(name), '') is not null), '{}')
  into v_colors
  from public.draft_colors
  where draft_id = d.id;

  insert into public.styles (
    brand_id, season_id, style_no, name, gender, colors,
    target_cost, retail_price, status, planner, designer
  ) values (
    d.brand_id,
    v_season_id,
    trim(p_style_no),
    v_name,
    'U',
    to_jsonb(v_colors),
    d.target_cost,
    d.retail_price,
    'confirmed',
    nullif(trim(d.owner), ''),
    null
  )
  returning id into v_style_id;

  update public.product_drafts
  set status = 'confirmed',
      season_id = v_season_id,
      promoted_style_id = v_style_id,
      updated_at = now()
  where id = d.id;

  return v_style_id;
end;
$function$;
