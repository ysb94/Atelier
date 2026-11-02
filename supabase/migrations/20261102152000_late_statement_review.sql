-- 지각 사유서는 출근시간을 정하는 부서장이 먼저 확인하고, 그 다음 지각 관리에서 확인한 사람이 인사 담당이 된다.
-- 부서장이 없으면 인사 확인만 받는다. 기존 사유서 본문은 바꾸지 않는다.

alter table public.late_arrival_statements
  add column manager_id uuid references public.profiles(id),
  add column manager_name text,
  add column manager_confirmed_at timestamptz,
  add column hr_id uuid references public.profiles(id),
  add column hr_name text,
  add column hr_confirmed_at timestamptz;

create table public.late_statement_notice_reads (
  statement_id uuid not null references public.late_arrival_statements(id) on delete cascade,
  reader_id uuid not null references public.profiles(id),
  read_at timestamptz not null default now(),
  primary key (statement_id, reader_id)
);
alter table public.late_statement_notice_reads enable row level security;
revoke all on public.late_statement_notice_reads from public, anon, authenticated;
grant select on public.late_statement_notice_reads to authenticated;
create policy late_statement_notice_read_own on public.late_statement_notice_reads
for select to authenticated using (reader_id = (select auth.uid()));

create table public.late_statement_employee_notices (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null unique references public.late_arrival_statements(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.late_statement_employee_notices enable row level security;
revoke all on public.late_statement_employee_notices from public, anon, authenticated;
grant select on public.late_statement_employee_notices to authenticated;
create policy late_statement_employee_notice_own on public.late_statement_employee_notices
for select to authenticated using (employee_id = (select auth.uid()));

create function app.can_manage_late_statement(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles person
    join public.department_request_approvers approver
      on approver.company_id = person.company_id and approver.department_id = person.department_id
    join public.profiles me on me.id = (select auth.uid()) and me.status = 'active' and me.company_id = person.company_id
    where person.id = p_employee
      and me.id <> person.id
      and me.id in (approver.approver_id, approver.substitute_id)
  );
$$;

create function app.late_statement_bell_recipient(p_employee uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with person as (
    select id, company_id, department_id from public.profiles where id = p_employee
  ),
  picks as (
    select approver.approver_id, approver.substitute_id, approver.request_type
    from public.department_request_approvers approver
    join person on person.company_id = approver.company_id and person.department_id = approver.department_id
    where approver.request_type in ('leave', 'overtime')
  )
  select candidate.id
  from (
    select approver_id as candidate, 1 as pick_order from picks where request_type = 'leave'
    union all
    select substitute_id, 2 from picks where request_type = 'leave'
    union all
    select approver_id, 3 from picks where request_type = 'overtime'
    union all
    select substitute_id, 4 from picks where request_type = 'overtime'
  ) ordered
  join person on true
  join public.profiles candidate on candidate.id = ordered.candidate and candidate.status = 'active' and candidate.company_id = person.company_id
  where ordered.candidate is not null and ordered.candidate <> person.id
  order by ordered.pick_order
  limit 1;
$$;

create function app.can_review_late_statements()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.can_edit_org_assignment())
    or exists (
      select 1 from public.profiles me
      where me.id = (select auth.uid()) and me.status = 'active'
        and me.company_id = (select app.company_review_company_id())
    );
$$;

create or replace function app.can_read_late_statement(p_statement uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.late_arrival_statements s
    where s.id = p_statement
      and (
        s.employee_id = (select auth.uid())
        or app.can_manage_late_statement(s.employee_id)
        or (
          s.company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
          and (
            (select app.can_edit_org_assignment())
            or s.company_id = (select app.company_review_company_id())
          )
        )
      )
  );
$$;

drop policy late_arrival_statement_read on public.late_arrival_statements;
create policy late_arrival_statement_read on public.late_arrival_statements
for select to authenticated
using (
  employee_id = (select auth.uid())
  or app.can_manage_late_statement(employee_id)
  or (
    company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
    and ((select app.can_edit_org_assignment()) or company_id = (select app.company_review_company_id()))
  )
);

create function app.confirm_late_statement_manager(p_statement uuid)
returns public.late_arrival_statements
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  me public.profiles%rowtype;
  saved public.late_arrival_statements%rowtype;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select * into me from public.profiles where id = actor and status = 'active';
  if me.id is null then raise exception '재직 중인 직원만 확인할 수 있습니다.' using errcode = '42501'; end if;
  select * into saved from public.late_arrival_statements where id = p_statement and company_id = me.company_id for update;
  if saved.id is null then raise exception '사유서를 찾지 못했습니다.' using errcode = '42501'; end if;
  if not app.can_manage_late_statement(saved.employee_id) then raise exception '이 사유서의 부서장 확인 권한이 없습니다.' using errcode = '42501'; end if;
  if saved.manager_confirmed_at is not null then raise exception '이미 부서장 확인이 되었습니다.'; end if;
  update public.late_arrival_statements
    set manager_id = me.id,
        manager_name = coalesce(nullif(btrim(me.display_name), ''), '이름 없음'),
        manager_confirmed_at = pg_catalog.clock_timestamp()
    where id = saved.id
    returning * into saved;
  insert into public.late_statement_notice_reads(statement_id, reader_id)
  values (saved.id, me.id)
  on conflict (statement_id, reader_id) do update set read_at = pg_catalog.clock_timestamp();
  return saved;
end;
$$;

create function app.confirm_late_statement_hr(p_statement uuid)
returns public.late_arrival_statements
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  me public.profiles%rowtype;
  saved public.late_arrival_statements%rowtype;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  if not app.can_review_late_statements() then raise exception '인사 확인 권한이 없습니다.' using errcode = '42501'; end if;
  select * into me from public.profiles where id = actor and status = 'active';
  if me.id is null then raise exception '재직 중인 직원만 확인할 수 있습니다.' using errcode = '42501'; end if;
  select * into saved from public.late_arrival_statements where id = p_statement and company_id = me.company_id for update;
  if saved.id is null then raise exception '사유서를 찾지 못했습니다.' using errcode = '42501'; end if;
  if saved.employee_id = actor then raise exception '본인 사유서는 인사 확인할 수 없습니다.' using errcode = '42501'; end if;
  if saved.hr_confirmed_at is not null then raise exception '이미 인사 확인이 되었습니다.'; end if;
  if saved.manager_confirmed_at is null and app.late_statement_bell_recipient(saved.employee_id) is not null then
    raise exception '부서장 확인 후 인사 확인할 수 있습니다.';
  end if;
  update public.late_arrival_statements
    set manager_name = case when manager_confirmed_at is null then '부서장 없음' else manager_name end,
        hr_id = me.id,
        hr_name = coalesce(nullif(btrim(me.display_name), ''), '이름 없음'),
        hr_confirmed_at = pg_catalog.clock_timestamp()
    where id = saved.id
    returning * into saved;
  insert into public.late_statement_employee_notices(statement_id, company_id, employee_id)
  values (saved.id, saved.company_id, saved.employee_id)
  on conflict (statement_id) do nothing;
  return saved;
end;
$$;

create function app.list_my_late_statement_notices()
returns table(kind text, notice_id uuid, statement_id uuid, employee_name text, work_date date, late_minutes integer, created_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select 'manager', s.id, s.id, s.employee_name, s.work_date, s.late_minutes, s.created_at, r.read_at
  from public.late_arrival_statements s
  left join public.late_statement_notice_reads r on r.statement_id = s.id and r.reader_id = (select auth.uid())
  where s.manager_confirmed_at is null and app.late_statement_bell_recipient(s.employee_id) = (select auth.uid())
  union all
  select 'employee', n.id, n.statement_id, s.employee_name, s.work_date, s.late_minutes, n.created_at, n.read_at
  from public.late_statement_employee_notices n
  join public.late_arrival_statements s on s.id = n.statement_id
  where n.employee_id = (select auth.uid());
$$;

create function app.list_my_manageable_late_statements()
returns table(id uuid, employee_name text, work_date date, late_minutes integer, reason_kind text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.employee_name, s.work_date, s.late_minutes, s.reason_kind, s.created_at
  from public.late_arrival_statements s
  where s.manager_confirmed_at is null and app.can_manage_late_statement(s.employee_id)
  order by s.work_date desc, s.created_at desc;
$$;

create function app.count_late_statements_awaiting_hr()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when not app.can_review_late_statements() then 0 else (
    select count(*)::integer
    from public.late_arrival_statements s
    where s.hr_confirmed_at is null
      and s.company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
      and (s.manager_confirmed_at is not null or app.late_statement_bell_recipient(s.employee_id) is null)
  ) end;
$$;

create function app.late_statement_review(p_statement uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not app.can_read_late_statement(p_statement) then null else (
    select jsonb_build_object(
      'canManagerConfirm', s.manager_confirmed_at is null and app.can_manage_late_statement(s.employee_id),
      'canHrConfirm', s.hr_confirmed_at is null and app.can_review_late_statements() and s.employee_id <> (select auth.uid())
        and (s.manager_confirmed_at is not null or app.late_statement_bell_recipient(s.employee_id) is null),
      'waitingForManager', s.manager_confirmed_at is null and app.late_statement_bell_recipient(s.employee_id) is not null
    )
    from public.late_arrival_statements s where s.id = p_statement
  ) end;
$$;

create function app.read_late_statement_notice(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  if p_kind is null or p_kind = 'all' or p_kind = 'manager' then
    insert into public.late_statement_notice_reads(statement_id, reader_id)
    select s.id, actor
    from public.late_arrival_statements s
    where (p_id is null or s.id = p_id)
      and s.manager_confirmed_at is null
      and app.late_statement_bell_recipient(s.employee_id) = actor
    on conflict (statement_id, reader_id) do update set read_at = pg_catalog.clock_timestamp();
  end if;
  if p_kind is null or p_kind = 'all' or p_kind = 'employee' then
    update public.late_statement_employee_notices
      set read_at = pg_catalog.clock_timestamp()
      where employee_id = actor and read_at is null and (p_id is null or id = p_id);
  end if;
end;
$$;

revoke all on function app.can_manage_late_statement(uuid) from public, anon;
revoke all on function app.late_statement_bell_recipient(uuid) from public, anon;
revoke all on function app.can_review_late_statements() from public, anon;
revoke all on function app.confirm_late_statement_manager(uuid) from public, anon;
revoke all on function app.confirm_late_statement_hr(uuid) from public, anon;
revoke all on function app.list_my_late_statement_notices() from public, anon;
revoke all on function app.list_my_manageable_late_statements() from public, anon;
revoke all on function app.count_late_statements_awaiting_hr() from public, anon;
revoke all on function app.late_statement_review(uuid) from public, anon;
revoke all on function app.read_late_statement_notice(text, uuid) from public, anon;
grant execute on function app.can_manage_late_statement(uuid) to authenticated;
grant execute on function app.late_statement_bell_recipient(uuid) to authenticated;
grant execute on function app.can_review_late_statements() to authenticated;
grant execute on function app.confirm_late_statement_manager(uuid) to authenticated;
grant execute on function app.confirm_late_statement_hr(uuid) to authenticated;
grant execute on function app.list_my_late_statement_notices() to authenticated;
grant execute on function app.list_my_manageable_late_statements() to authenticated;
grant execute on function app.count_late_statements_awaiting_hr() to authenticated;
grant execute on function app.late_statement_review(uuid) to authenticated;
grant execute on function app.read_late_statement_notice(text, uuid) to authenticated;

create function public.confirm_late_statement_manager(p_statement uuid) returns public.late_arrival_statements
language sql security invoker set search_path = '' as $$ select * from app.confirm_late_statement_manager(p_statement); $$;
create function public.confirm_late_statement_hr(p_statement uuid) returns public.late_arrival_statements
language sql security invoker set search_path = '' as $$ select * from app.confirm_late_statement_hr(p_statement); $$;
create function public.list_my_late_statement_notices()
returns table(kind text, notice_id uuid, statement_id uuid, employee_name text, work_date date, late_minutes integer, created_at timestamptz, read_at timestamptz)
language sql security invoker set search_path = '' as $$ select * from app.list_my_late_statement_notices(); $$;
create function public.list_my_manageable_late_statements()
returns table(id uuid, employee_name text, work_date date, late_minutes integer, reason_kind text, created_at timestamptz)
language sql security invoker set search_path = '' as $$ select * from app.list_my_manageable_late_statements(); $$;
create function public.count_late_statements_awaiting_hr() returns integer
language sql security invoker set search_path = '' as $$ select app.count_late_statements_awaiting_hr(); $$;
create function public.late_statement_review(p_statement uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select app.late_statement_review(p_statement); $$;
create function public.read_late_statement_notice(p_kind text, p_id uuid) returns void
language sql security invoker set search_path = '' as $$ select app.read_late_statement_notice(p_kind, p_id); $$;

revoke all on function public.confirm_late_statement_manager(uuid) from public, anon;
revoke all on function public.confirm_late_statement_hr(uuid) from public, anon;
revoke all on function public.list_my_late_statement_notices() from public, anon;
revoke all on function public.list_my_manageable_late_statements() from public, anon;
revoke all on function public.count_late_statements_awaiting_hr() from public, anon;
revoke all on function public.late_statement_review(uuid) from public, anon;
revoke all on function public.read_late_statement_notice(text, uuid) from public, anon;
grant execute on function public.confirm_late_statement_manager(uuid) to authenticated;
grant execute on function public.confirm_late_statement_hr(uuid) to authenticated;
grant execute on function public.list_my_late_statement_notices() to authenticated;
grant execute on function public.list_my_manageable_late_statements() to authenticated;
grant execute on function public.count_late_statements_awaiting_hr() to authenticated;
grant execute on function public.late_statement_review(uuid) to authenticated;
grant execute on function public.read_late_statement_notice(text, uuid) to authenticated;
