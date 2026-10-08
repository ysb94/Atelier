-- Company HR approvals are assigned explicitly, independently from Operations Support access.
create table public.department_request_approvers (
  company_id uuid not null references public.companies(id),
  department_id uuid not null references public.departments(id),
  request_type text not null check (request_type in ('leave','overtime')),
  approver_id uuid references public.profiles(id),
  substitute_id uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(company_id,department_id,request_type),
  check (substitute_id is null or (approver_id is not null and substitute_id <> approver_id))
);
create index department_request_approvers_department on public.department_request_approvers(department_id);
create index department_request_approvers_primary on public.department_request_approvers(approver_id);
create index department_request_approvers_substitute on public.department_request_approvers(substitute_id);
create index department_request_approvers_editor on public.department_request_approvers(updated_by);
alter table public.department_request_approvers enable row level security;
revoke all on public.department_request_approvers from public,anon,authenticated;
grant select,insert,update on public.department_request_approvers to authenticated;
create policy approvers_read on public.department_request_approvers for select to authenticated
using (company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active'));
create policy approvers_insert on public.department_request_approvers for insert to authenticated
with check ((select app.can_edit_org_assignment()) and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active'));
create policy approvers_update on public.department_request_approvers for update to authenticated
using ((select app.can_edit_org_assignment()) and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active'))
with check ((select app.can_edit_org_assignment()) and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active'));

-- The private trigger needs only employee eligibility fields hidden by profile RLS.
create function app.guard_department_request_approvers() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; candidate uuid;
begin
  if auth.uid() is null or not app.can_edit_org_assignment() then raise exception '운영지원팀만 승인자를 지정할 수 있습니다.'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active';
  if actor.company_id is null or new.company_id is distinct from actor.company_id then raise exception '같은 회사의 승인자만 설정할 수 있습니다.'; end if;
  if TG_OP='UPDATE' and row(new.company_id,new.department_id,new.request_type) is distinct from row(old.company_id,old.department_id,old.request_type) then raise exception '승인자 설정의 부서·종류는 변경할 수 없습니다.'; end if;
  if not exists(select 1 from public.departments where id=new.department_id and company_id=actor.company_id and is_active) then raise exception '활성 부서를 선택해 주세요.'; end if;
  foreach candidate in array array[new.approver_id,new.substitute_id] loop
    if candidate is not null and not exists(select 1 from public.profiles where id=candidate and company_id=actor.company_id and status='active') then raise exception '같은 회사의 재직 직원만 승인자로 지정할 수 있습니다.'; end if;
  end loop;
  new.updated_by:=actor.id; new.updated_at:=now();
  return new;
end;
$$;
revoke all on function app.guard_department_request_approvers() from public,anon,authenticated;
create trigger department_request_approvers_guard before insert or update on public.department_request_approvers
for each row execute function app.guard_department_request_approvers();

create function app.is_department_request_approver(p_company uuid,p_department uuid,p_kind text)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.department_request_approvers a
    join public.profiles me on me.id=auth.uid() and me.status='active' and me.company_id=a.company_id
    where a.company_id=p_company and a.department_id=p_department
      and a.request_type=case when p_kind='overtime' then 'overtime' else 'leave' end
      and (a.approver_id=me.id or a.substitute_id=me.id));
$$;
revoke all on function app.is_department_request_approver(uuid,uuid,text) from public,anon;
grant execute on function app.is_department_request_approver(uuid,uuid,text) to authenticated;

alter table public.company_leave_requests drop constraint company_leave_requests_kind_check;
alter table public.company_leave_requests add constraint company_leave_requests_kind_check check (kind in ('annual','half','quarter','overtime'));
alter table public.company_leave_requests add constraint overtime_reason_required check (kind<>'overtime' or length(btrim(note))>0);

alter policy leave_read on public.company_leave_requests
using (company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
  and (employee_id=(select auth.uid()) or (select app.can_edit_org_assignment())
    or decided_by=(select auth.uid()) or app.is_department_request_approver(company_id,department_id,kind)));
alter policy leave_transition on public.company_leave_requests
using (company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
  and status='pending' and (employee_id=(select auth.uid()) or app.is_department_request_approver(company_id,department_id,kind)))
with check (company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
  and (employee_id=(select auth.uid()) or app.is_department_request_approver(company_id,department_id,kind)));

create function public.list_my_approval_requests() returns setof public.company_leave_requests
language sql stable security invoker set search_path='' as $$
  select r.* from public.company_leave_requests r
  where r.employee_id<>(select auth.uid())
    and (app.is_department_request_approver(r.company_id,r.department_id,r.kind) or r.decided_by=(select auth.uid()))
  order by r.created_at desc,r.id;
$$;
revoke all on function public.list_my_approval_requests() from public,anon;
grant execute on function public.list_my_approval_requests() to authenticated;

create or replace function app.guard_company_leave_request() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare actor public.profiles%rowtype; starts timestamp; ends timestamp; minutes integer;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null then raise exception '재직 중인 직원만 신청할 수 있습니다.'; end if;
  if TG_OP = 'INSERT' then
    if new.employee_id <> actor.id then raise exception '본인 신청만 등록할 수 있습니다.'; end if;
    new.company_id := actor.company_id;
    new.employee_name := coalesce(nullif(btrim(actor.display_name), ''), '이름 없음');
    new.department_id := actor.department_id;
    select coalesce(d.name, '소속 없음') into new.department_name from public.departments d where d.id = actor.department_id;
    new.department_name := coalesce(new.department_name, '소속 없음');
    new.status := 'pending'; new.created_at := now();
    new.decided_at := null; new.decided_by := null; new.decided_by_name := null; new.decision_note := null;
    new.note := btrim(new.note);
    if new.kind='overtime' and (new.from_date<>new.to_date or new.end_time<=new.start_time or new.note='') then
      raise exception '야근은 날짜별로 시작·종료 시각과 사유를 입력해 주세요.';
    end if;
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
      if not app.is_department_request_approver(old.company_id,old.department_id,old.kind) then raise exception '이 부서와 신청 종류의 지정 승인자만 처리할 수 있습니다.'; end if;
      if actor.id = old.employee_id then raise exception '본인 신청은 다른 지정 승인자가 처리해야 합니다.'; end if;
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
