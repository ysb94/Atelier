create table public.warehouse_popular_locations (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  location_codes text[] not null default '{}'::text[],
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

comment on table public.warehouse_popular_locations is
  '브랜드별 물류 공용 인기상품 자리번호. 사용자설정이며 재고 및 일반 자리 분류와 독립적이다.';

alter table public.warehouse_popular_locations enable row level security;
revoke all on public.warehouse_popular_locations from public, anon, authenticated;
grant select on public.warehouse_popular_locations to authenticated;
grant insert (brand_id, location_codes) on public.warehouse_popular_locations to authenticated;
grant update (location_codes, revision) on public.warehouse_popular_locations to authenticated;

create policy warehouse_popular_locations_read
on public.warehouse_popular_locations for select to authenticated
using (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id));

create policy warehouse_popular_locations_insert
on public.warehouse_popular_locations for insert to authenticated
with check (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id));

create policy warehouse_popular_locations_update
on public.warehouse_popular_locations for update to authenticated
using (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id))
with check (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id));

create function app.prepare_warehouse_popular_locations()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and new.revision is distinct from old.revision + 1 then
    raise exception '저장된 자리 목록이 변경되었습니다.' using errcode = '40001';
  end if;
  if new.location_codes is null then
    raise exception '자리번호 목록을 확인해 주세요.' using errcode = '22023';
  end if;

  select coalesce(array_agg(clean.code order by clean.first_pos), '{}'::text[])
  into new.location_codes
  from (
    select code, min(pos) as first_pos
    from unnest(new.location_codes) with ordinality as entry(value, pos)
    cross join lateral (select regexp_replace(entry.value, '^[[:space:]]+|[[:space:]]+$', '', 'g') as code) as trimmed
    where code <> ''
    group by code
  ) as clean;

  if exists (
    select from unnest(new.location_codes) as code(value)
    where char_length(code.value) > 80
  ) then
    raise exception '자리번호는 80자까지 입력할 수 있습니다.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

revoke all on function app.prepare_warehouse_popular_locations() from public, anon, authenticated;

create trigger prepare_warehouse_popular_locations
before insert or update on public.warehouse_popular_locations
for each row execute function app.prepare_warehouse_popular_locations();
