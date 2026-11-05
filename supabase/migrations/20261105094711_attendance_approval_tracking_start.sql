-- Separate attendance enrollment from employment dates and existing account permissions.
-- Only new metadata is written; original profiles/clocks/requests/balances stay intact.
create table app.attendance_enrollments (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  approved_at timestamptz,
  scheduled_start time without time zone,
  source text not null check(source in ('existing','approval')),
  enrolled_at timestamptz not null default clock_timestamp()
);
create index attendance_enrollments_company on app.attendance_enrollments(company_id,employee_id);
alter table app.attendance_enrollments enable row level security;
revoke all on app.attendance_enrollments from public,anon,authenticated;
create policy attendance_enrollments_private on app.attendance_enrollments for select to authenticated using(false);

create function app.attendance_enrollment_start(p_approved timestamptz,p_start time without time zone)
returns date language plpgsql stable security definer set search_path='' as $$
declare approved_local timestamp:=p_approved at time zone 'Asia/Seoul'; candidate date;
begin
  -- Old active accounts without an approval timestamp retain their existing rollout boundary.
  if p_approved is null or approved_local::date<'2026-11-02' then return date '2026-11-02'; end if;
  candidate:=approved_local::date;
  -- An unknown starting time must not create a retroactive absence on the approval day.
  if p_start is null or approved_local::time>p_start then candidate:=candidate+1; end if;
  for step in 1..370 loop
    if app.holiday_work_day_kind(candidate) is null then return candidate; end if;
    candidate:=candidate+1;
  end loop;
  raise exception '근태 집계 시작일의 근무일 기준을 확인해 주세요.' using errcode='22023';
end $$;

create function app.capture_attendance_enrollment() returns trigger
language plpgsql security definer set search_path='' as $$
declare approved timestamptz;
begin
  if new.status<>'active' or new.company_id is null then return new; end if;
  if tg_op='UPDATE' then
    if old.status='active' then return new; end if;
  end if;
  approved:=coalesce(new.approved_at,clock_timestamp());
  insert into app.attendance_enrollments(employee_id,company_id,approved_at,scheduled_start,source)
    values(new.id,new.company_id,approved,app.attendance_start_for_date(new.id,(approved at time zone 'Asia/Seoul')::date),'approval')
    on conflict(employee_id) do nothing;
  return new;
end $$;
revoke all on function app.attendance_enrollment_start(timestamptz,time without time zone),app.capture_attendance_enrollment() from public,anon,authenticated;

insert into app.attendance_enrollments(employee_id,company_id,approved_at,scheduled_start,source)
select p.id,p.company_id,p.approved_at,
  app.attendance_start_for_date(p.id,coalesce((p.approved_at at time zone 'Asia/Seoul')::date,date '2026-11-02')),'existing'
from public.profiles p where p.status in('active','disabled') and p.company_id is not null;

create trigger profiles_attendance_enrollment after insert or update of status on public.profiles
for each row execute function app.capture_attendance_enrollment();

create function app.list_attendance_enrollments() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.permission_company_id(); missing bigint; result jsonb;
begin
  if company is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  select count(*) filter(where e.employee_id is null),coalesce(jsonb_agg(jsonb_build_object('employeeId',p.id,
    'startsOn',app.attendance_enrollment_start(e.approved_at,e.scheduled_start)) order by p.id),'[]'::jsonb)
    into missing,result
    from public.list_org_chart_members() visible
    join public.profiles p on p.id=visible.id and p.company_id=company and p.status='active'
    left join app.attendance_enrollments e on e.employee_id=p.id and e.company_id=p.company_id;
  if missing>0 then raise exception '근태 집계 시작일 기준이 누락됐습니다. 운영지원에 문의해 주세요.' using errcode='55000'; end if;
  return result;
end $$;
create function public.list_attendance_enrollments() returns jsonb
language sql stable security invoker set search_path='' as $$select app.list_attendance_enrollments()$$;
revoke all on function app.list_attendance_enrollments(),public.list_attendance_enrollments() from public,anon,authenticated;
grant execute on function app.list_attendance_enrollments(),public.list_attendance_enrollments() to authenticated;
