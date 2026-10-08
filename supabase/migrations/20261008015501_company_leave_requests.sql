-- Company-wide HR data: employee ownership, not product/brand ownership.
create table public.company_leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.profiles(id),
  employee_name text not null,
  department_id uuid references public.departments(id),
  department_name text not null,
  kind text not null check (kind in ('annual','half','quarter')),
  from_date date not null,
  to_date date not null,
  start_time time not null default '09:00',
  end_time time not null default '18:00',
  note text not null default '' check (length(note) <= 2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_by_name text,
  decision_note text check (length(decision_note) <= 2000),
  check (to_date >= from_date and to_date - from_date <= 365),
  check (kind = 'annual' or (from_date = to_date and end_time > start_time))
);
create index company_leave_requests_employee on public.company_leave_requests(employee_id, created_at desc);
create index company_leave_requests_queue on public.company_leave_requests(company_id, status, created_at desc);
alter table public.company_leave_requests enable row level security;
revoke all on public.company_leave_requests from anon, authenticated;
grant select, insert, update on public.company_leave_requests to authenticated;

create policy leave_read on public.company_leave_requests for select to authenticated
using (app.can_read_company(company_id) and (employee_id = (select auth.uid()) or app.can_edit_org_assignment()));
create policy leave_create on public.company_leave_requests for insert to authenticated
with check (app.can_read_company(company_id) and employee_id = (select auth.uid()) and status = 'pending');
create policy leave_transition on public.company_leave_requests for update to authenticated
using (app.can_read_company(company_id) and status = 'pending' and (employee_id = (select auth.uid()) or app.can_edit_org_assignment()))
with check (app.can_read_company(company_id) and (employee_id = (select auth.uid()) or app.can_edit_org_assignment()));

create function app.guard_company_leave_request() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare actor public.profiles%rowtype; starts timestamp; ends timestamp; minutes integer;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null then raise exception '재직 중인 직원만 신청할 수 있습니다.'; end if;
  if TG_OP = 'INSERT' then
    if new.employee_id <> actor.id then raise exception '본인 휴가만 신청할 수 있습니다.'; end if;
    new.company_id := actor.company_id;
    new.employee_name := coalesce(nullif(btrim(actor.display_name), ''), '이름 없음');
    new.department_id := actor.department_id;
    select coalesce(d.name, '소속 없음') into new.department_name from public.departments d where d.id = actor.department_id;
    new.department_name := coalesce(new.department_name, '소속 없음');
    new.status := 'pending'; new.created_at := now();
    new.decided_at := null; new.decided_by := null; new.decided_by_name := null; new.decision_note := null;
    new.note := btrim(new.note);
    if new.kind in ('half','quarter') then
      -- Initial request units: eight-hour day, lunch 12:00–13:00; no balance deduction.
      minutes := extract(epoch from (new.end_time - new.start_time)) / 60
        - greatest(0, extract(epoch from (least(new.end_time, time '13:00') - greatest(new.start_time, time '12:00'))) / 60);
      if new.start_time < time '09:00' or new.end_time > time '18:00'
        or minutes <> (case when new.kind = 'half' then 240 else 120 end) then
        raise exception '반차는 4시간, 반반차는 2시간으로 신청해 주세요. 휴게시간 12–13시는 제외합니다.';
      end if;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text, 0));
    starts := new.from_date + case when new.kind = 'annual' then time '00:00' else new.start_time end;
    ends := case when new.kind = 'annual' then new.to_date + interval '1 day' else new.to_date + new.end_time end;
    if exists (select 1 from public.company_leave_requests r where r.employee_id = actor.id and r.status in ('pending','approved')
      and tsrange(r.from_date + case when r.kind = 'annual' then time '00:00' else r.start_time end,
        case when r.kind = 'annual' then r.to_date + interval '1 day' else r.to_date + r.end_time end, '[)')
        && tsrange(starts, ends, '[)')) then
      raise exception '같은 시간에 대기 중이거나 승인된 휴가 신청이 있습니다.';
    end if;
  else
    if row(new.id,new.company_id,new.employee_id,new.employee_name,new.department_id,new.department_name,new.kind,new.from_date,new.to_date,new.start_time,new.end_time,new.note,new.created_at)
      is distinct from row(old.id,old.company_id,old.employee_id,old.employee_name,old.department_id,old.department_name,old.kind,old.from_date,old.to_date,old.start_time,old.end_time,old.note,old.created_at) then
      raise exception '신청 원본은 수정할 수 없습니다. 대기 신청을 취소하고 다시 신청해 주세요.';
    end if;
    if old.status <> 'pending' then raise exception '이미 처리된 신청입니다. 목록을 새로고침해 주세요.'; end if;
    if new.status = 'cancelled' then
      if actor.id <> old.employee_id then raise exception '본인 신청만 취소할 수 있습니다.'; end if;
      new.decision_note := null;
    elsif new.status in ('approved','rejected') then
      if not app.can_edit_org_assignment() then raise exception '운영지원팀만 승인·반려할 수 있습니다.'; end if;
      if actor.id = old.employee_id then raise exception '본인 신청은 다른 운영지원 담당자가 처리해야 합니다.'; end if;
      new.decision_note := nullif(btrim(new.decision_note), '');
      if new.status = 'rejected' and new.decision_note is null then raise exception '반려 사유를 입력해 주세요.'; end if;
    else raise exception '올바른 처리 상태가 아닙니다.';
    end if;
    new.decided_at := now(); new.decided_by := actor.id;
    new.decided_by_name := coalesce(nullif(btrim(actor.display_name), ''), '이름 없음');
  end if;
  return new;
end;
$$;
revoke all on function app.guard_company_leave_request() from public, anon, authenticated;
create trigger company_leave_request_guard before insert or update on public.company_leave_requests
for each row execute function app.guard_company_leave_request();
