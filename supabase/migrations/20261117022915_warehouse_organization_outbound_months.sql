create table public.warehouse_organization_outbound_months (
  brand_id uuid not null references public.brands(id) on delete cascade,
  outbound_month date not null check (
    outbound_month between date '1000-01-01' and date '9999-12-01'
    and extract(day from outbound_month) = 1
  ),
  items jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (brand_id, outbound_month)
);

comment on table public.warehouse_organization_outbound_months is
  '창고 개편 참고용 월별 출고 자료. 품목별 원본 순서와 수량을 보존하며 재고 및 실제 출고와 독립적이다.';

alter table public.warehouse_organization_outbound_months enable row level security;
revoke all on public.warehouse_organization_outbound_months from public, anon, authenticated;
grant select on public.warehouse_organization_outbound_months to authenticated;
grant insert (brand_id, outbound_month, items) on public.warehouse_organization_outbound_months to authenticated;
grant update (items, revision) on public.warehouse_organization_outbound_months to authenticated;

create policy warehouse_organization_outbound_read
on public.warehouse_organization_outbound_months for select to authenticated
using (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id));

create policy warehouse_organization_outbound_insert
on public.warehouse_organization_outbound_months for insert to authenticated
with check (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id));

create policy warehouse_organization_outbound_update
on public.warehouse_organization_outbound_months for update to authenticated
using (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id))
with check (app.basic_work_allowed('logistics', brand_id) and app.can_read_brand(brand_id));

create function app.prepare_warehouse_organization_outbound_month()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and new.revision is distinct from old.revision + 1 then
    raise exception '저장한 출고 자료의 버전이 변경되었습니다.' using errcode = '40001';
  end if;
  if jsonb_typeof(new.items) is distinct from 'array' then
    raise exception '상품명과 수량 목록을 확인해 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(new.items) not between 1 and 10000 then
    raise exception '한 달에 1~10,000행을 저장할 수 있습니다.' using errcode = '22023';
  end if;
  if exists (
    select from jsonb_array_elements(new.items) as input(item)
    where case when jsonb_typeof(item) = 'object' then
      item - array['productName', 'quantity']::text[] <> '{}'::jsonb
      or jsonb_typeof(item->'productName') is distinct from 'string'
      or char_length(item->>'productName') > 240
      or item->>'productName' !~ '[^[:space:]]'
      or case when jsonb_typeof(item->'quantity') = 'number' then
        (item->>'quantity')::numeric not between 0 and 2147483647
        or mod((item->>'quantity')::numeric, 1) <> 0
      else true end
    else true end
  ) then
    raise exception '상품명과 정수 수량을 확인해 주세요.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

revoke all on function app.prepare_warehouse_organization_outbound_month() from public, anon, authenticated;

create trigger prepare_warehouse_organization_outbound_month
before insert or update on public.warehouse_organization_outbound_months
for each row execute function app.prepare_warehouse_organization_outbound_month();
