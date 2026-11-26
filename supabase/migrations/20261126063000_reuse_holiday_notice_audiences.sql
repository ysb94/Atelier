-- Read eligibility must stay in sync with the currently deployed holiday flow.
-- Accept the original confirmed-settlement function or this migration on retry.
do $guard$
begin
  if (select md5(replace(prosrc,chr(13),''))
      from pg_proc where oid='app.holiday_work_notifications()'::regprocedure)
    not in ('ea0093cf60ef76feef06f2ca47e5bf04','f290b2863ef6b96da245b13e73c5cf0d') then
    raise exception 'Holiday notification function changed; review current definition before applying';
  end if;
end $guard$;
create or replace function app.holiday_work_notifications()
returns jsonb language sql stable security definer set search_path='' as $$
  -- Repeated versions for the same worker share the same audience permissions
  -- for this statement. The existing helpers still decide every permission.
  with audiences as materialized (
    select distinct d.employee_id, e.audience
    from app.holiday_work_events e
    join app.holiday_work_days d on d.id=e.work_id
  ), addressed as materialized (
    select a.employee_id, a.audience
    from audiences a
    where case a.audience
      when 'employee' then a.employee_id=(select auth.uid())
      when 'reviewer' then app.holiday_work_review(a.employee_id)
      when 'operations' then (select app.holiday_work_ops())
      else false end
  ), recipients as materialized (
    select distinct employee_id from addressed
  ), visible as materialized (
    select employee_id from recipients where app.holiday_work_can_view(employee_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_key',e.event_key,'entity_id',d.id,'created_at',e.created_at,'event_type','holiday-'||e.kind,
    'tab',case e.audience when 'reviewer' then 'approvals' when 'operations' then 'holiday-work' else 'my-attendance' end,
    'kind','overtime','employee_name',p.display_name,'from_date',d.work_date,'to_date',d.work_date,'start_time','','end_time','',
    'note',case when e.kind='confirmation-submitted' then
      '직원이 보상방법을 제출했습니다. 제출 내용을 확인한 뒤 보상을 확정해 주세요.' else e.body end,'decision_note',case when e.kind in ('settled','paid') then e.body else d.review_note end,
    'title',p.display_name||' · '||d.work_date||' 주말·공휴일 근무 · '||case e.kind
      when 'submitted' then '실제 시간 확인 요청' when 'returned' then '보완 요청' when 'approved' then '시간 확인 완료'
      when 'settle' then '보상 정산 대기' when 'payment' then '수당 지급 확인' when 'paid' then '수당 지급 완료'
      when 'confirmation-request' then '보상방법 선택 요청'
      when 'confirmation-submitted' then '보상 확인서 제출'
      when 'confirmation-correction' then '근무정보 정정 요청' else '보상 확정' end,
    'action_needed',coalesce(task.pending,false),
    'action_label',case e.kind when 'confirmation-request' then '보상방법 선택 필요'
      when 'confirmation-submitted' then '제출된 확인서 검토 필요'
      when 'confirmation-correction' then '근무정보 정정 요청' end,
    'action_key',case when e.kind='payment' then 'holiday-payment:'||s.id else 'holiday-work:'||d.id end,
    'current',coalesce(task.pending,true),'status',d.state,'read_at',r.read_at
  )),'[]'::jsonb)
  from app.holiday_work_events e join app.holiday_work_days d on d.id=e.work_id join public.profiles p on p.id=d.employee_id
  left join app.holiday_work_settlements s on s.id=e.settlement_id
  left join app.holiday_work_confirmations c on c.work_id=d.id and c.report_version=d.report_version
  left join public.my_home_notification_reads r on r.reader_id=auth.uid() and r.event_key=e.event_key
  cross join lateral (select case e.kind
    when 'submitted' then d.state='submitted' and d.report_version=e.report_version
    when 'returned' then d.state='returned' and d.report_version=e.report_version
    when 'settle' then d.state='approved' and app.holiday_work_remaining(d.id)>0 and c.id is null
    when 'payment' then s.paid_on is null
    when 'confirmation-request' then d.state='approved' and d.report_version=e.report_version and c.id is not null and c.choice is null
    when 'confirmation-submitted' then d.state='approved' and d.report_version=e.report_version
      and coalesce(c.choice in ('cash','leave'),false) and app.holiday_work_remaining(d.id)>0
    when 'confirmation-correction' then d.state='returned' and d.report_version=e.report_version
    else null end pending) task
  where (d.employee_id,e.audience) in (
    select a.employee_id,a.audience from addressed a join visible v using (employee_id)
  )
$$;
