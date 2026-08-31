-- 예발 출고 예정일 연장(지연) 이력.
-- ship_on은 최종 예정일이고, 연장 시마다 이전→새 날짜·사유를 남긴다.

create table if not exists public.invoice_preorder_hold_extensions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  hold_id uuid not null,
  previous_ship_on date not null,
  new_ship_on date not null,
  reason text not null
    check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now(),
  constraint invoice_preorder_hold_extensions_brand_id_id_key
    unique (brand_id, id),
  constraint invoice_preorder_hold_extensions_hold_fkey
    foreign key (brand_id, hold_id)
    references public.invoice_preorder_holds (brand_id, id)
    on delete cascade,
  constraint invoice_preorder_hold_extensions_dates_check
    check (new_ship_on > previous_ship_on)
);

comment on table public.invoice_preorder_hold_extensions is
  '예발 출고 예정일 연장 이력. 최종 예정일은 invoice_preorder_holds.ship_on.';
comment on column public.invoice_preorder_hold_extensions.previous_ship_on is
  '연장 직전 출고 예정일.';
comment on column public.invoice_preorder_hold_extensions.new_ship_on is
  '연장 후 출고 예정일. previous_ship_on보다 뒤여야 한다.';
comment on column public.invoice_preorder_hold_extensions.reason is
  '연장(지연) 사유.';

create index if not exists invoice_preorder_hold_extensions_hold_idx
  on public.invoice_preorder_hold_extensions (brand_id, hold_id, created_at);

create or replace function public.invoice_preorder_hold_extensions_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reason := btrim(new.reason);
  if new.reason = '' then
    raise exception '연장 사유를 입력하세요.';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_preorder_hold_extensions_normalize
  on public.invoice_preorder_hold_extensions;
create trigger invoice_preorder_hold_extensions_normalize
before insert or update on public.invoice_preorder_hold_extensions
for each row execute function public.invoice_preorder_hold_extensions_normalize();

alter table public.invoice_preorder_hold_extensions enable row level security;

drop policy if exists invoice_preorder_hold_extensions_select_member
  on public.invoice_preorder_hold_extensions;
create policy invoice_preorder_hold_extensions_select_member
on public.invoice_preorder_hold_extensions
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists invoice_preorder_hold_extensions_insert_editor
  on public.invoice_preorder_hold_extensions;
create policy invoice_preorder_hold_extensions_insert_editor
on public.invoice_preorder_hold_extensions
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_preorder_hold_extensions_update_editor
  on public.invoice_preorder_hold_extensions;
create policy invoice_preorder_hold_extensions_update_editor
on public.invoice_preorder_hold_extensions
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_preorder_hold_extensions_delete_editor
  on public.invoice_preorder_hold_extensions;
create policy invoice_preorder_hold_extensions_delete_editor
on public.invoice_preorder_hold_extensions
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_preorder_hold_extensions
to authenticated;
