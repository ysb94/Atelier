create or replace function app.list_my_home_work_notifications_before_offsite() returns jsonb language sql stable security invoker set search_path='' as $$
 with approval_candidates as materialized (
  select r.id,r.company_id,r.department_id,r.created_at,r.kind,r.employee_name,r.from_date,r.to_date,
    r.start_time,r.end_time,r.note,r.decision_note,r.status
  from public.list_my_approval_requests() r
  -- Without a current primary/substitute assignment no row can pass the
  -- per-request approver check below. Skip building the full approval queue.
  where exists (
    select 1 from public.department_request_approvers a
    where a.approver_id=(select auth.uid()) or a.substitute_id=(select auth.uid())
  )
   and (r.status='pending' or exists(select 1 from public.my_home_notification_reads h where h.reader_id=auth.uid() and h.event_key='request-approval:'||r.id)) and (r.kind in ('overtime','correction') or r.advance_requested)
   and (r.employee_id<>(select auth.uid()) or (r.kind in ('overtime','correction') and not r.advance_requested))
 ), approval_groups as materialized (
   select distinct company_id, department_id, kind from approval_candidates
 ), eligible_groups as materialized (
   select company_id, department_id, kind from approval_groups
   where app.is_department_request_approver(company_id,department_id,kind)
 ), eligible as (
   select r.* from approval_candidates r join eligible_groups g using (company_id,department_id,kind)
 ), bounds as (
   select (select auth.uid()) as employee, date '2026-10-26' as first_day,
     (now() at time zone 'Asia/Seoul')::date as today
 ), candidate_days as materialized (
   select c.employee_id, c.work_date
   from public.attendance_clock_ins c
   join bounds b on b.employee=c.employee_id
   where c.work_date between b.first_day and b.today
     and c.clock_out_at is null
     and not exists (select 1 from public.attendance_exemptions e where e.profile_id=b.employee)
     and not exists (
       select 1 from public.company_leave_requests r
       where r.employee_id=b.employee and r.kind='correction' and r.from_date=c.work_date
         and r.status in ('pending','approved')
     )
     and (c.auto_closed_at is not null or c.work_date=(
       -- An approved correction without a physical check-in also contributes
       -- a work date to the old effective-clock list.
       select greatest(
         (select max(clock.work_date) from public.attendance_clock_ins clock
          where clock.employee_id=limits.employee and clock.work_date between limits.first_day and limits.today-1),
         (select max(r.from_date) from public.company_leave_requests r
          where r.employee_id=limits.employee and r.kind='correction' and r.status='approved'
            and r.from_date between limits.first_day and limits.today-1)
       ) from bounds limits
     ))
 ), candidate_span as (
   select employee_id, min(work_date) as first_day, max(work_date) as last_day
   from candidate_days group by employee_id
 ), missing_clocks as (
   -- With an approved correction the date was already excluded above.
   -- Otherwise a recorded checkout remains effective. Offsite overtime can
   -- supply a checkout for an open raw clock, so retain the effective-clock
   -- calculation for the surviving dates, in a single call per employee.
   select effective.*
   from candidate_span span
   cross join lateral public.list_effective_attendance_clocks(span.first_day,span.last_day,span.employee_id) effective
   join candidate_days candidate
     on candidate.employee_id=effective.employee_id and candidate.work_date=effective.work_date
   where effective.clock_out_at is null
 ), notifications as (
  select 'request-approval:'||r.id as event_key,r.id::text as entity_id,r.created_at,
   'approval'::text as event_type,'approvals'::text as tab,r.kind,r.employee_name,r.from_date,r.to_date,r.start_time,r.end_time,r.note,r.decision_note,
   (r.status='pending') as action_needed,r.status,(r.status='pending') as current
  from eligible r
  union all
  select 'request-result:'||e.id,r.id::text,e.created_at,'result',case when r.kind='overtime' then 'overtime' else 'my-attendance' end,
   r.kind,r.employee_name,r.from_date,r.to_date,r.start_time,r.end_time,e.snapshot->>'note',e.snapshot->>'decision_note',false,e.status,(r.status=e.status)
  from public.my_home_request_events e join public.company_leave_requests r on r.id=e.request_id
  where e.employee_id=(select auth.uid())
  union all
  select 'checkout:'||c.work_date,c.work_date::text,coalesce(c.auto_closed_at,((c.work_date+time '23:59') at time zone 'Asia/Seoul')),
   'checkout','my-attendance','correction','',c.work_date,c.work_date,c.clock_in,null::time,
   '실제 퇴근시간을 확인해 등록해 주세요. 오늘 자동 종료된 기록은 다음 출근 후 등록할 수 있습니다.',null::text,true,'pending',true
  from missing_clocks c
 )
 select coalesce(jsonb_agg(to_jsonb(n)||jsonb_build_object('read_at',reads.read_at) order by n.created_at desc,n.event_key),'[]'::jsonb)
 from notifications n left join public.my_home_notification_reads reads on reads.reader_id=(select auth.uid()) and reads.event_key=n.event_key
 where exists(select 1 from public.profiles where id=(select auth.uid()) and status='active');
$$;

-- The original permission helper remains the authority for every distinct
-- source entity. Keep the original source order and duplicate events.
create or replace function app.list_my_managed_work_notifications() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if app.permission_company_id() is null then
    raise exception '활성 직원 계정이 필요합니다.' using errcode='42501';
  end if;

  return (
    with notices as materialized (
      select n.item, n.ordinality,
        case when n.item->>'entity_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
          then (n.item->>'entity_id')::uuid end as entity_id
      from jsonb_array_elements(public.list_my_home_work_notifications()) with ordinality n(item,ordinality)
      where coalesce(n.item->>'event_type','') <> 'checkout'
         or (select app.hr_notice_target_in_scope(null,'self'))
    ), entity_ids as materialized (
      select distinct entity_id from notices where entity_id is not null
    ), permitted as materialized (
      select entity_id from entity_ids where app.hr_notice_target_in_scope(entity_id,'work')
    )
    select coalesce(jsonb_agg(n.item order by n.ordinality),'[]'::jsonb)
    from notices n
    where (n.entity_id is null and (select app.hr_notice_target_in_scope(null,'work')))
       or n.entity_id in (select entity_id from permitted)
  );
end $$;
