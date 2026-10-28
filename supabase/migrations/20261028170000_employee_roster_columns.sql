-- 직원 배치 표에서 직접 추가하는 헤더와 직원별 값.
-- 기존 employee_roster 열은 그대로 두고, 추가 헤더만 이 두 테이블에 둔다.

create table public.employee_roster_columns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  label text not null,
  kind text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint employee_roster_columns_kind check (kind in ('text', 'number', 'money')),
  constraint employee_roster_columns_label_len check (char_length(btrim(label)) between 1 and 40)
);

create unique index employee_roster_columns_label_ci
  on public.employee_roster_columns (company_id, lower(btrim(label)));

create table public.employee_roster_values (
  column_id uuid not null references public.employee_roster_columns (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  value text not null default '',
  updated_at timestamptz not null default now(),
  primary key (column_id, profile_id),
  constraint employee_roster_values_len check (char_length(value) <= 200)
);

alter table public.employee_roster_columns enable row level security;
alter table public.employee_roster_values enable row level security;

revoke all on public.employee_roster_columns from public, anon, authenticated;
revoke all on public.employee_roster_values from public, anon, authenticated;
grant select, insert, update, delete on public.employee_roster_columns to authenticated;
grant select, insert, update, delete on public.employee_roster_values to authenticated;

create or replace function app.guard_employee_roster_column()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mine uuid;
begin
  select me.company_id
  into mine
  from public.profiles as me
  where me.id = (select auth.uid())
    and me.status = 'active';

  if mine is null
     or not (
       (select app.can_edit_org_assignment())
       or app.basic_work_allowed('operations')
     ) then
    raise exception '운영지원만 직원 배치 헤더를 바꿀 수 있습니다.';
  end if;

  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception '헤더의 회사는 바꿀 수 없습니다.';
  end if;

  new.company_id := mine;
  new.label := btrim(new.label);
  if char_length(new.label) < 1 or char_length(new.label) > 40 then
    raise exception '헤더 이름은 1자에서 40자까지 입력해 주세요.';
  end if;
  if new.kind not in ('text', 'number', 'money') then
    raise exception '헤더 성격은 텍스트, 숫자, 금액 중 하나여야 합니다.';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_employee_roster_column() from public, anon, authenticated;

create trigger employee_roster_columns_guard
before insert or update on public.employee_roster_columns
for each row
execute function app.guard_employee_roster_column();

create or replace function app.guard_employee_roster_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mine uuid;
begin
  select me.company_id
  into mine
  from public.profiles as me
  where me.id = (select auth.uid())
    and me.status = 'active';

  if mine is null
     or not (
       (select app.can_edit_org_assignment())
       or app.basic_work_allowed('operations')
     )
     or not exists (
       select 1
       from public.profiles as target
       join public.employee_roster_columns as col on col.id = new.column_id
       where target.id = new.profile_id
         and target.status = 'active'
         and target.company_id = mine
         and col.company_id = mine
     ) then
    raise exception '같은 회사의 재직 직원 헤더 값만 저장할 수 있습니다.';
  end if;

  new.value := btrim(new.value);
  if char_length(new.value) > 200 then
    raise exception '헤더 값은 200자까지 입력할 수 있습니다.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app.guard_employee_roster_value() from public, anon, authenticated;

create trigger employee_roster_values_guard
before insert or update on public.employee_roster_values
for each row
execute function app.guard_employee_roster_value();

create policy employee_roster_columns_editor
on public.employee_roster_columns
for all
to authenticated
using (
  (
    (select app.can_edit_org_assignment())
    or app.basic_work_allowed('operations')
  )
  and company_id = (
    select me.company_id
    from public.profiles as me
    where me.id = (select auth.uid())
      and me.status = 'active'
  )
)
with check (
  (
    (select app.can_edit_org_assignment())
    or app.basic_work_allowed('operations')
  )
  and company_id = (
    select me.company_id
    from public.profiles as me
    where me.id = (select auth.uid())
      and me.status = 'active'
  )
);

create policy employee_roster_values_editor
on public.employee_roster_values
for all
to authenticated
using (
  (
    (select app.can_edit_org_assignment())
    or app.basic_work_allowed('operations')
  )
  and exists (
    select 1
    from public.profiles as me
    join public.profiles as target
      on target.id = profile_id
     and target.company_id = me.company_id
     and target.status = 'active'
    join public.employee_roster_columns as col
      on col.id = column_id
     and col.company_id = me.company_id
    where me.id = (select auth.uid())
      and me.status = 'active'
  )
)
with check (
  (
    (select app.can_edit_org_assignment())
    or app.basic_work_allowed('operations')
  )
  and exists (
    select 1
    from public.profiles as me
    join public.profiles as target
      on target.id = profile_id
     and target.company_id = me.company_id
     and target.status = 'active'
    join public.employee_roster_columns as col
      on col.id = column_id
     and col.company_id = me.company_id
    where me.id = (select auth.uid())
      and me.status = 'active'
  )
);
