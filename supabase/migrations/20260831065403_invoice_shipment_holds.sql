-- 송장 출고상태 기준: 예발(진행·과거 이력) · 단종 리스트.
-- 재고부족·실제 주문 제외는 이후 연결한다.

create table if not exists public.invoice_preorder_holds (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  style_id uuid not null,
  started_on date not null,
  ship_on date not null,
  reason text not null
    check (length(btrim(reason)) > 0),
  status text not null default 'active'
    check (status in ('active', 'cleared')),
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_preorder_holds_brand_id_id_key unique (brand_id, id),
  constraint invoice_preorder_holds_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
    on delete restrict,
  constraint invoice_preorder_holds_dates_check
    check (ship_on >= started_on),
  constraint invoice_preorder_holds_cleared_at_check
    check (
      (status = 'active' and cleared_at is null)
      or (status = 'cleared' and cleared_at is not null)
    )
);

comment on table public.invoice_preorder_holds is
  '브랜드·상품별 예발 구간. 제거해도 행을 지우지 않고 cleared로 남겨 과거 참고 데이터로 쓴다.';
comment on column public.invoice_preorder_holds.started_on is
  '예발이 시작된 날(업무일).';
comment on column public.invoice_preorder_holds.ship_on is
  '출고 예정일. 이 날짜가 되면 대기 주문을 다시 보여 줄 예정이다
comment on column public.invoice_preorder_holds.reason is
  '예발 사유. 예: 입고 지연, 출고량 급증, 재고 부족.';
comment on column public.invoice_preorder_holds.status is
  'active=진행 중, cleared=목록에서 뺌(이력 유지).';

create unique index if not exists invoice_preorder_holds_active_style_key
  on public.invoice_preorder_holds (brand_id, style_id)
  where status = 'active';

create index if not exists invoice_preorder_holds_brand_status_ship_idx
  on public.invoice_preorder_holds (brand_id, status, ship_on, started_on);

create or replace function public.invoice_preorder_holds_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reason := btrim(new.reason);
  if new.reason = '' then
    raise exception '예발 사유를 입력하세요.';
  end if;
  if new.status = 'cleared' and new.cleared_at is null then
    new.cleared_at := now();
  end if;
  if new.status = 'active' then
    new.cleared_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_preorder_holds_normalize
  on public.invoice_preorder_holds;
create trigger invoice_preorder_holds_normalize
before insert or update on public.invoice_preorder_holds
for each row execute function public.invoice_preorder_holds_normalize();

drop trigger if exists invoice_preorder_holds_set_updated_at
  on public.invoice_preorder_holds;
create trigger invoice_preorder_holds_set_updated_at
before update on public.invoice_preorder_holds
for each row execute function public.set_updated_at();

alter table public.invoice_preorder_holds enable row level security;

drop policy if exists invoice_preorder_holds_select_member
  on public.invoice_preorder_holds;
create policy invoice_preorder_holds_select_member
on public.invoice_preorder_holds
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists invoice_preorder_holds_insert_editor
  on public.invoice_preorder_holds;
create policy invoice_preorder_holds_insert_editor
on public.invoice_preorder_holds
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_preorder_holds_update_editor
  on public.invoice_preorder_holds;
create policy invoice_preorder_holds_update_editor
on public.invoice_preorder_holds
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_preorder_holds_delete_editor
  on public.invoice_preorder_holds;
create policy invoice_preorder_holds_delete_editor
on public.invoice_preorder_holds
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_preorder_holds
to authenticated;

-- ---------------------------------------------------------------------------

create table if not exists public.invoice_discontinued_styles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  style_id uuid not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_discontinued_styles_brand_id_id_key unique (brand_id, id),
  constraint invoice_discontinued_styles_style_key unique (brand_id, style_id),
  constraint invoice_discontinued_styles_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
    on delete restrict
);

comment on table public.invoice_discontinued_styles is
  '송장 재고·예약 단계에서 단종 제외 후보로 쓰는 브랜드별 단종 상품 리스트.';
comment on column public.invoice_discontinued_styles.note is
  '선택 메모. 예: SS25 시즌 종료.';

create index if not exists invoice_discontinued_styles_brand_created_idx
  on public.invoice_discontinued_styles (brand_id, created_at desc);

create or replace function public.invoice_discontinued_styles_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.note := coalesce(btrim(new.note), '');
  return new;
end;
$$;

drop trigger if exists invoice_discontinued_styles_normalize
  on public.invoice_discontinued_styles;
create trigger invoice_discontinued_styles_normalize
before insert or update on public.invoice_discontinued_styles
for each row execute function public.invoice_discontinued_styles_normalize();

drop trigger if exists invoice_discontinued_styles_set_updated_at
  on public.invoice_discontinued_styles;
create trigger invoice_discontinued_styles_set_updated_at
before update on public.invoice_discontinued_styles
for each row execute function public.set_updated_at();

alter table public.invoice_discontinued_styles enable row level security;

drop policy if exists invoice_discontinued_styles_select_member
  on public.invoice_discontinued_styles;
create policy invoice_discontinued_styles_select_member
on public.invoice_discontinued_styles
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists invoice_discontinued_styles_insert_editor
  on public.invoice_discontinued_styles;
create policy invoice_discontinued_styles_insert_editor
on public.invoice_discontinued_styles
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_discontinued_styles_update_editor
  on public.invoice_discontinued_styles;
create policy invoice_discontinued_styles_update_editor
on public.invoice_discontinued_styles
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_discontinued_styles_delete_editor
  on public.invoice_discontinued_styles;
create policy invoice_discontinued_styles_delete_editor
on public.invoice_discontinued_styles
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_discontinued_styles
to authenticated;
