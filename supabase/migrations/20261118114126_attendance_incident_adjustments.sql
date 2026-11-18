create table app.attendance_incident_adjustments (
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.profiles(id),
  work_date date not null,
  kind text not null check (kind in ('late','absent')),
  minutes integer check (minutes between 0 and 1439 and (kind='late' or minutes=0)),
  reason text not null check (char_length(reason) between 1 and 300),
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null,
  primary key (company_id,employee_id,work_date,kind)
);
create index attendance_incident_month_idx on app.attendance_incident_adjustments(company_id,work_date);
alter table app.attendance_incident_adjustments enable row level security;
revoke all on table app.attendance_incident_adjustments from public,anon,authenticated;

create function app.list_attendance_incident_adjustments(p_from date,p_to date,p_employee uuid)
returns table(employee_id uuid,work_date date,kind text,minutes integer,reason text,revision text)
language plpgsql stable security definer set search_path='' as $$
declare
  company uuid := app.permission_company_id();
  actor uuid := auth.uid();
  can_edit boolean := coalesce(app.permission_allowed('org.manage','company',company),false);
  can_review boolean := coalesce(app.company_review_company_id()=company,false);
begin
  if company is null or actor is null then
    raise exception '근태 보정 조회 권한이 없습니다.' using errcode='42501';
  end if;
  if not (
    can_edit or can_review or coalesce(p_employee=actor,false)
    or (p_employee is not null and coalesce(app.can_manage_late_statement(p_employee),false))
  ) then
    if p_employee is null then return; end if;
    raise exception '근태 보정 조회 권한이 없습니다.' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then
    raise exception '근태 보정 조회 기간을 확인해 주세요.' using errcode='22023';
  end if;
  return query
    select a.employee_id,a.work_date,a.kind,a.minutes,
      case when can_edit then a.reason else null end,
      case when can_edit then a.changed_at::text else null end
    from app.attendance_incident_adjustments a
    where a.company_id=company and (p_employee is null or a.employee_id=p_employee)
      and a.work_date between p_from and p_to and (a.minutes is not null or can_edit);
end;
$$;

create function app.save_attendance_incident_adjustment(p_employee uuid,p_date date,p_kind text,p_minutes integer,p_reason text,p_revision text)
returns void language plpgsql security definer set search_path='' as $$
declare
  company uuid := app.permission_company_id();
  actor uuid := auth.uid();
  previous_revision text;
  actual time;
  baseline time;
  note text := btrim(coalesce(p_reason,''));
begin
  if company is null or actor is null or not coalesce(app.permission_allowed('org.manage','company',company),false) then
    raise exception '운영지원만 근태 판정을 수정할 수 있습니다.' using errcode='42501';
  end if;
  if p_date is null or p_date<date '2026-11-02' or p_date>(clock_timestamp() at time zone 'Asia/Seoul')::date
    or p_kind is null or p_kind not in ('late','absent') or char_length(note) not between 1 and 300
    or (p_minutes is not null and (p_minutes not between 0 and 1439 or (p_kind='absent' and p_minutes<>0))) then
    raise exception '근태 보정 날짜, 시간 또는 사유를 확인해 주세요.' using errcode='22023';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_employee and p.company_id=company and p.status='active')
     or app.workforce_mode(p_employee) is distinct from 'head-office' then
    raise exception '본사 근태 관리 대상 직원만 수정할 수 있습니다.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text,0));
  select a.changed_at::text into previous_revision from app.attendance_incident_adjustments a
    where a.company_id=company and a.employee_id=p_employee and a.work_date=p_date and a.kind=p_kind;
  if p_revision is distinct from previous_revision then
    raise exception '다른 사용자가 수정했습니다. 새로 불러온 뒤 다시 확인해 주세요.' using errcode='40001';
  end if;
  if p_minutes is not null then
    select c.clock_in into actual from public.list_effective_attendance_clocks(p_date,p_date,p_employee) c;
    if p_kind='late' then
      baseline := app.attendance_arrival_start_for_date(p_employee,p_date);
      if actual is null or baseline is null or actual-baseline<=interval '5 minutes' then
        raise exception '지각으로 계산되는 출근 기록을 찾지 못했습니다.' using errcode='22023';
      end if;
    elsif actual is not null or exists (
      select 1 from public.company_leave_requests r
      where r.company_id=company and r.employee_id=p_employee and p_date between r.from_date and r.to_date
        and r.status in ('approved','pending') and r.kind in ('annual','half','quarter','official','offsite','remote')
    ) then
      raise exception '출근 또는 근태 신청 기록이 있어 결근 제외를 저장할 수 없습니다.' using errcode='22023';
    end if;
  end if;
  insert into app.attendance_incident_adjustments
    (company_id,employee_id,work_date,kind,minutes,reason,changed_by,changed_at)
  values (company,p_employee,p_date,p_kind,p_minutes,note,actor,clock_timestamp())
  on conflict (company_id,employee_id,work_date,kind) do update
    set minutes=excluded.minutes,reason=excluded.reason,changed_by=excluded.changed_by,changed_at=excluded.changed_at;
end;
$$;

create function public.list_attendance_incident_adjustments(p_from date,p_to date,p_employee uuid default null)
returns table(employee_id uuid,work_date date,kind text,minutes integer,reason text,revision text)
language sql stable security invoker set search_path='' as $$
  select * from app.list_attendance_incident_adjustments(p_from,p_to,p_employee)
$$;
create function public.save_attendance_incident_adjustment(p_employee uuid,p_date date,p_kind text,p_minutes integer,p_reason text,p_revision text)
returns void language sql security invoker set search_path='' as $$
  select app.save_attendance_incident_adjustment(p_employee,p_date,p_kind,p_minutes,p_reason,p_revision)
$$;
revoke all on function app.list_attendance_incident_adjustments(date,date,uuid),public.list_attendance_incident_adjustments(date,date,uuid),
  app.save_attendance_incident_adjustment(uuid,date,text,integer,text,text),public.save_attendance_incident_adjustment(uuid,date,text,integer,text,text) from public,anon,authenticated;
grant execute on function app.list_attendance_incident_adjustments(date,date,uuid),public.list_attendance_incident_adjustments(date,date,uuid),
  app.save_attendance_incident_adjustment(uuid,date,text,integer,text,text),public.save_attendance_incident_adjustment(uuid,date,text,integer,text,text) to authenticated;

-- 기존 사유서는 보존하고, 신규 제출에는 보정된 분과 제외 여부를 적용한다.
do $migration$
declare
  definition text := pg_get_functiondef('app.save_my_late_statement(text,text,text,text)'::regprocedure);
  anchor text := $anchor$if minutes <= 5 then raise exception '지각이 아니라서 사유서가 필요하지 않습니다.'; end if;$anchor$;
  adjustment text := $adjustment$
  minutes := coalesce((select a.minutes from app.attendance_incident_adjustments a
    where a.company_id=person.company_id and a.employee_id=actor and a.work_date=today and a.kind='late'),minutes);
  if minutes=0 then raise exception '지각 제외된 날짜에는 사유서가 필요하지 않습니다.'; end if;
  $adjustment$;
begin
  if strpos(definition,anchor)=0 then
    raise exception 'Unexpected late-statement eligibility check';
  end if;
  execute replace(definition,anchor,anchor||adjustment);
end;
$migration$;
