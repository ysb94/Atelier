create table app.late_arrival_appeals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.profiles(id),
  work_date date not null,
  baseline time not null,
  actual time not null,
  minutes integer not null check (minutes between 1 and 1439),
  reason text not null check (char_length(reason) between 1 and 300),
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check (status in ('pending','corrected','kept')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) between 1 and 300),
  unique (company_id,employee_id,work_date)
);
create index late_arrival_appeals_company_created on app.late_arrival_appeals(company_id,created_at desc);
alter table app.late_arrival_appeals enable row level security;
revoke all on app.late_arrival_appeals from public,anon,authenticated;

create function app.submit_late_arrival_appeal(p_date date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  company uuid := app.permission_company_id();
  note text := btrim(coalesce(p_reason,''));
  existing uuid;
  actual_time time;
  baseline_time time;
  late_minutes integer;
  adjusted integer;
begin
  if actor is null or company is null or app.workforce_mode(actor) is distinct from 'head-office'
    or exists(select 1 from public.attendance_exemptions e where e.profile_id=actor) then
    raise exception '본사 근태 관리 대상 직원만 이의신청할 수 있습니다.' using errcode='42501';
  end if;
  if p_date is distinct from (clock_timestamp() at time zone 'Asia/Seoul')::date
    or extract(isodow from p_date)>5
    or exists(select 1 from app.leave_balance_holidays h where h.day=p_date)
    or char_length(note) not between 1 and 300 then
    raise exception '오늘의 근무일과 이의신청 사유를 확인해 주세요.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select a.id into existing from app.late_arrival_appeals a
    where (a.company_id,a.employee_id,a.work_date)=(company,actor,p_date);
  if found then return existing; end if;
  select c.clock_in into actual_time from public.list_effective_attendance_clocks(p_date,p_date,actor) c;
  baseline_time := app.attendance_arrival_start_for_date(actor,p_date);
  late_minutes := floor(extract(epoch from (actual_time-baseline_time))/60)::integer;
  select a.minutes into adjusted from app.attendance_incident_adjustments a
    where (a.company_id,a.employee_id,a.work_date,a.kind)=(company,actor,p_date,'late');
  if late_minutes is null or late_minutes<=5 or adjusted=0 then
    raise exception '이의신청할 지각 기록이 없습니다. 출근 기록을 다시 확인해 주세요.' using errcode='22023';
  end if;
  insert into app.late_arrival_appeals(company_id,employee_id,work_date,baseline,actual,minutes,reason)
    values(company,actor,p_date,baseline_time,actual_time,coalesce(adjusted,late_minutes),note)
    returning id into existing;
  return existing;
end; $$;

create function app.list_late_arrival_appeals(p_id uuid)
returns table(id uuid,employee_name text,work_date date,baseline text,actual text,minutes integer,
  reason text,created_at timestamptz,status text,review_note text,reviewed_at timestamptz,
  can_review boolean,revision text,event_key text,read_at timestamptz)
language sql stable security definer set search_path='' as $$
  with actor as (
    select auth.uid() uid,app.permission_company_id() company,app.is_operations_department_member() operations
  ), visible as (
    select a.*,p.display_name,a.employee_id<>u.uid and u.operations as can_review,
      case when a.employee_id=u.uid then case when a.reviewed_at is not null then 'late-appeal-result:'||a.id end
        when u.operations then 'late-appeal-review:'||a.id end as event_key, u.uid
    from app.late_arrival_appeals a join public.profiles p on p.id=a.employee_id
    join actor u on a.company_id=u.company and (a.employee_id=u.uid or u.operations)
    where p_id is null or a.id=p_id
  )
  select v.id,v.display_name,v.work_date,left(v.baseline::text,5),left(v.actual::text,5),v.minutes,
    v.reason,v.created_at,v.status,v.review_note,v.reviewed_at,v.can_review,j.changed_at::text,v.event_key,n.read_at
  from visible v
  left join app.attendance_incident_adjustments j on v.can_review
    and (j.company_id,j.employee_id,j.work_date,j.kind)=(v.company_id,v.employee_id,v.work_date,'late')
  left join public.my_home_notification_reads n on (n.reader_id,n.event_key)=(v.uid,v.event_key)
  order by (v.status='pending') desc,v.created_at desc,v.id
  limit 100
$$;

create function app.read_late_arrival_appeal(p_id uuid,p_event_key text)
returns void language sql security definer set search_path='' as $$
  insert into public.my_home_notification_reads(reader_id,event_key)
    select auth.uid(),a.event_key from app.list_late_arrival_appeals(p_id) a
    where p_id is not null and a.event_key=p_event_key on conflict do nothing
$$;

create function app.review_late_arrival_appeal(p_id uuid,p_exclude boolean,p_note text,p_revision text)
returns void language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  company uuid := app.permission_company_id();
  target app.late_arrival_appeals%rowtype;
  adjustment app.attendance_incident_adjustments%rowtype;
  note text := btrim(coalesce(p_note,''));
  stamp timestamptz;
begin
  if company is null or not coalesce(app.is_operations_department_member(),false) then
    raise exception '운영지원만 지각 이의신청을 처리할 수 있습니다.' using errcode='42501';
  end if;
  select a.* into target from app.late_arrival_appeals a
    where a.id=p_id and a.company_id=company and a.employee_id<>actor;
  if not found then raise exception '처리할 이의신청을 찾지 못했습니다.' using errcode='42501'; end if;
  if p_exclude is null or char_length(note) not between 1 and 300 then
    raise exception '처리 사유를 입력해 주세요.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target.employee_id::text,0));
  select a.* into target from app.late_arrival_appeals a where a.id=p_id for update;
  if target.status<>'pending' then
    if target.status=(case when p_exclude then 'corrected' else 'kept' end)
      and target.reviewed_by=actor and target.review_note=note then return; end if;
    raise exception '이미 처리된 이의신청입니다.' using errcode='40001';
  end if;
  select j.* into adjustment from app.attendance_incident_adjustments j
    where (j.company_id,j.employee_id,j.work_date,j.kind)=(company,target.employee_id,target.work_date,'late');
  if p_revision is distinct from adjustment.changed_at::text then
    raise exception '다른 사용자가 근태를 수정했습니다. 새로고침 후 다시 확인해 주세요.' using errcode='40001';
  end if;
  stamp := clock_timestamp();
  if p_exclude and adjustment.minutes is distinct from 0 then
    insert into app.attendance_incident_adjustments(company_id,employee_id,work_date,kind,minutes,reason,changed_by,changed_at)
      values(company,target.employee_id,target.work_date,'late',0,note,actor,stamp)
      on conflict(company_id,employee_id,work_date,kind) do update
      set minutes=excluded.minutes,reason=excluded.reason,changed_by=excluded.changed_by,changed_at=excluded.changed_at;
  end if;
  update app.late_arrival_appeals set status=case when p_exclude then 'corrected' else 'kept' end,
    reviewed_by=actor,reviewed_at=stamp,review_note=note where id=p_id;
end; $$;

create function public.submit_late_arrival_appeal(p_date date,p_reason text)
returns uuid language sql security invoker set search_path='' as $$
  select app.submit_late_arrival_appeal(p_date,p_reason)
$$;
create function public.list_late_arrival_appeals(p_id uuid default null)
returns table(id uuid,employee_name text,work_date date,baseline text,actual text,minutes integer,
  reason text,created_at timestamptz,status text,review_note text,reviewed_at timestamptz,
  can_review boolean,revision text,event_key text,read_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select * from app.list_late_arrival_appeals(p_id)
$$;
create function public.read_late_arrival_appeal(p_id uuid,p_event_key text)
returns void language sql security invoker set search_path='' as $$
  select app.read_late_arrival_appeal(p_id,p_event_key)
$$;
create function public.review_late_arrival_appeal(p_id uuid,p_exclude boolean,p_note text,p_revision text)
returns void language sql security invoker set search_path='' as $$
  select app.review_late_arrival_appeal(p_id,p_exclude,p_note,p_revision)
$$;
revoke all on function app.submit_late_arrival_appeal(date,text),public.submit_late_arrival_appeal(date,text),
  app.list_late_arrival_appeals(uuid),public.list_late_arrival_appeals(uuid),
  app.read_late_arrival_appeal(uuid,text),public.read_late_arrival_appeal(uuid,text),
  app.review_late_arrival_appeal(uuid,boolean,text,text),public.review_late_arrival_appeal(uuid,boolean,text,text)
  from public,anon,authenticated;
grant execute on function app.submit_late_arrival_appeal(date,text),public.submit_late_arrival_appeal(date,text),
  app.list_late_arrival_appeals(uuid),public.list_late_arrival_appeals(uuid),
  app.read_late_arrival_appeal(uuid,text),public.read_late_arrival_appeal(uuid,text),
  app.review_late_arrival_appeal(uuid,boolean,text,text),public.review_late_arrival_appeal(uuid,boolean,text,text)
  to authenticated;
