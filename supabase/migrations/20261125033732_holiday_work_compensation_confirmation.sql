begin;

create table app.holiday_work_confirmations (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references app.holiday_work_days(id),
  report_version integer not null,
  snapshot jsonb not null,
  agreement_at timestamptz,
  requested_by uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  choice text check (choice in ('cash', 'leave', 'correction')),
  responded_at timestamptz,
  correction_reason text,
  signed_path text unique,
  signed_by uuid,
  signed_at timestamptz,
  unique (work_id, report_version),
  check ((choice is null) = (responded_at is null)),
  check ((signed_path is null and signed_by is null and signed_at is null)
    or (signed_path is not null and signed_by is not null and signed_at is not null and choice in ('cash','leave')))
);
alter table app.holiday_work_confirmations enable row level security;
revoke all on app.holiday_work_confirmations from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('holiday-work-confirmations', 'holiday-work-confirmations', false, 10485760, array['application/pdf','image/jpeg','image/png']);

create function app.holiday_work_confirmation_file_access(p_path text, p_action text)
returns boolean language sql stable security definer set search_path='' as $$
  select app.holiday_work_ops() and exists (
    select 1 from app.holiday_work_confirmations c join app.holiday_work_days d on d.id=c.work_id
    where d.company_id=app.meeting_company_id() and c.id::text=split_part(p_path,'/',2)
      and split_part(p_path,'/',1)=d.company_id::text
      and p_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|jpg|png)$'
      and case p_action
        when 'read' then c.signed_path=p_path
        when 'upload' then c.signed_path is null and c.choice in ('cash','leave')
          and c.report_version=d.report_version and d.state='approved'
        else false end
  )
$$;
revoke all on function app.holiday_work_confirmation_file_access(text,text) from public, anon, authenticated;
grant execute on function app.holiday_work_confirmation_file_access(text,text) to authenticated;
create policy holiday_confirmation_upload on storage.objects for insert to authenticated
  with check (bucket_id='holiday-work-confirmations' and app.holiday_work_confirmation_file_access(name,'upload'));
create policy holiday_confirmation_read on storage.objects for select to authenticated
  using (bucket_id='holiday-work-confirmations' and app.holiday_work_confirmation_file_access(name,'read'));

create function app.holiday_work_confirmation_list(p_month date, p_scope text, p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb := app.holiday_work_list(p_month,p_scope,p_request);
begin
  if p_scope in ('mine','operations') then
    select jsonb_set(result,'{rows}',coalesce(jsonb_agg(
      item.row || jsonb_build_object('jobGrade',employee.job_grade) ||
      case when c.id is null then '{}'::jsonb else jsonb_build_object('confirmation',jsonb_build_object(
        'id',c.id,'work',c.snapshot,'requestedAt',c.requested_at,'choice',c.choice,
        'respondedAt',c.responded_at,'correctionReason',c.correction_reason,
        'signedPath',case when p_scope='operations' then c.signed_path end,
        'signedAt',c.signed_at,
        'allowLeave', coalesce(c.agreement_at=policy.updated_at,false)
      )) end order by item.position
    ),'[]'::jsonb)) into result
    from jsonb_array_elements(result->'rows') with ordinality item(row,position)
    left join public.profiles employee on employee.id=(item.row->>'employeeId')::uuid
    left join app.holiday_work_days d on d.id=(item.row->>'id')::uuid
    left join app.holiday_work_confirmations c on c.work_id=d.id and c.report_version=d.report_version
    left join app.holiday_work_policy policy on policy.company_id=d.company_id;
  end if;
  return result || '{"confirmationWorkflow":true}'::jsonb;
end $$;

create function app.holiday_work_confirmation_action(p_action text, p jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  company uuid := app.meeting_company_id();
  work_id uuid := (p->>'workId')::uuid;
  employee uuid;
  day_row app.holiday_work_days;
  confirmation app.holiday_work_confirmations;
  policy app.holiday_work_policy;
  method text := p->>'choice';
  correction_note text := btrim(coalesce(p->>'reason',''));
  file_path text := p->>'path';
begin
  select d.employee_id into employee from app.holiday_work_days d
  where d.id=work_id and d.company_id=company;
  if employee is null or (p_action='confirmation-respond' and employee is distinct from actor)
    or (p_action<>'confirmation-respond' and not app.holiday_work_ops()) then
    raise exception '해당 확인서를 처리할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_action='confirmation-respond' and not exists (
    select 1 from auth.sessions s join auth.mfa_amr_claims m on m.session_id=s.id
    where s.id::text=auth.jwt()->>'session_id' and s.user_id=actor and m.authentication_method in ('oauth','password')
  ) then raise exception '본인 계정으로 직접 로그인해 보상방법을 제출해 주세요.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(employee::text,0));
  select * into day_row from app.holiday_work_days d where d.id=work_id for update;
  select * into confirmation from app.holiday_work_confirmations c
    where c.work_id=day_row.id and c.report_version=day_row.report_version for update;

  if p_action='confirmation-request' then
    if day_row.state<>'approved' or day_row.version is distinct from (p->>'version')::integer
      or app.holiday_work_remaining(day_row.id)<=0 or app.holiday_work_legacy(employee,day_row.work_date) then
      raise exception '부서가 확인한 최신 미정산 근무를 다시 조회해 주세요.' using errcode='40001';
    end if;
    if confirmation.id is not null then return confirmation.id; end if;
    if p->>'allowLeave'='true' then
      select * into policy from app.holiday_work_policy h where h.company_id=company and h.agreement_date<=day_row.work_date for share;
      if policy.company_id is null then
        raise exception '이 근무일에 적용되는 보상휴가 서면합의를 확인해 주세요.' using errcode='23514';
      end if;
    end if;
    insert into app.holiday_work_confirmations (work_id,report_version,snapshot,agreement_at,requested_by)
    select day_row.id,day_row.report_version,jsonb_build_object(
      'name',employee_profile.display_name,'department',department.name,'grade',employee_profile.job_grade,
      'date',day_row.work_date,'location',day_row.location,'intervals',day_row.intervals,'actualMinutes',day_row.actual_minutes,
      'creditUnits',day_row.credit_units,'remainingUnits',app.holiday_work_remaining(day_row.id),'reason',day_row.reason,
      'requestedBy',operator.display_name,'agreementRef',policy.agreement_ref
    ), policy.updated_at,actor
    from public.profiles employee_profile left join public.departments department on department.id=employee_profile.department_id
    join public.profiles operator on operator.id=actor
    where employee_profile.id=employee
    returning * into confirmation;
    perform app.holiday_work_event(day_row.id,'confirmation-request','employee','근무 내역을 확인하고 보상방법을 선택해 주세요.');
  else
    if confirmation.id is null or confirmation.id is distinct from (p->>'confirmationId')::uuid then
      raise exception '확인서가 변경되었습니다. 다시 조회해 주세요.' using errcode='40001';
    end if;
    if p_action='confirmation-respond' and method=confirmation.choice
      and (method<>'correction' or correction_note=confirmation.correction_reason) then return confirmation.id; end if;
    if p_action='confirmation-file' and file_path=confirmation.signed_path then return confirmation.id; end if;
    if day_row.state<>'approved' or app.holiday_work_remaining(day_row.id)<=0 then
      raise exception '확인 상태 또는 정산 상태가 변경되었습니다.' using errcode='40001';
    end if;
    if (p_action='confirmation-respond' and method='correction') or p_action='confirmation-return' then
      if (p_action='confirmation-respond' and confirmation.choice is not null) or length(correction_note) not between 1 and 500
        or exists(select 1 from app.holiday_work_allocations a where a.work_id=day_row.id) then
        raise exception '아직 정산하지 않은 근무 건에 정정 사유를 입력해 주세요.' using errcode='23514';
      end if;
      update app.holiday_work_days set state='returned',version=version+1,
        review_note='근무정보 정정 요청 · '||correction_note,updated_at=clock_timestamp() where id=day_row.id;
      perform app.holiday_work_event(day_row.id,'returned','employee','정정한 실제 근무시간을 다시 제출해 주세요.');
      if p_action='confirmation-respond' then
        update app.holiday_work_confirmations set choice=method,responded_at=clock_timestamp(),correction_reason=correction_note where id=confirmation.id;
        perform app.holiday_work_event(day_row.id,'confirmation-correction','operations','직원이 근무정보 정정을 요청했습니다.');
      end if;
    elsif p_action='confirmation-respond' then
      if confirmation.choice is not null then raise exception '이미 제출한 확인서입니다.' using errcode='40001'; end if;
      if method='leave' then
        select * into policy from app.holiday_work_policy h where h.company_id=company and h.agreement_date<=day_row.work_date for share;
        if confirmation.agreement_at is null or policy.updated_at is distinct from confirmation.agreement_at then
          raise exception '적용되는 서면합의가 변경되었습니다. 운영지원에 문의하세요.' using errcode='23514';
        end if;
      elsif method is distinct from 'cash' then
        raise exception '보상방법을 선택해 주세요.' using errcode='23514';
      end if;
      update app.holiday_work_confirmations set choice=method,responded_at=clock_timestamp() where id=confirmation.id;
      perform app.holiday_work_event(day_row.id,'confirmation-submitted','operations','직원이 보상방법을 제출했습니다. 확인서 출력 및 서명본 등록 후 정산해 주세요.');
    elsif p_action='confirmation-file' then
      if p->>'verified' is distinct from 'true' or not app.holiday_work_confirmation_file_access(file_path,'upload') or not exists (
        select 1 from storage.objects o where o.bucket_id='holiday-work-confirmations' and o.name=file_path
        and case when o.metadata->>'size' ~ '^[0-9]{1,8}$' then (o.metadata->>'size')::integer between 1 and 10485760 else false end
        and o.metadata->>'mimetype'=case
          when file_path like '%.pdf' then 'application/pdf' when file_path like '%.jpg' then 'image/jpeg' else 'image/png' end
      ) then raise exception '현재 확인서에 업로드한 PDF, JPG 또는 PNG 서명본을 확인해 주세요.' using errcode='23514'; end if;
      update app.holiday_work_confirmations set signed_path=file_path,signed_by=actor,signed_at=clock_timestamp() where id=confirmation.id;
    end if;
  end if;
  perform app.holiday_work_signal(employee);
  return confirmation.id;
end $$;

create or replace function app.holiday_work_notifications()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_key',e.event_key,'entity_id',d.id,'created_at',e.created_at,'event_type','holiday-'||e.kind,
    'tab',case e.audience when 'reviewer' then 'approvals' when 'operations' then 'holiday-work' else 'my-attendance' end,
    'kind','overtime','employee_name',p.display_name,'from_date',d.work_date,'to_date',d.work_date,'start_time','','end_time','',
    'note',e.body,'decision_note',case when e.kind in ('settled','paid') then e.body else d.review_note end,
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
  where app.holiday_work_can_view(d.employee_id) and (e.audience='employee' and d.employee_id=auth.uid()
    or e.audience='reviewer' and app.holiday_work_review(d.employee_id)
    or e.audience='operations' and app.holiday_work_ops())
$$;

-- A work day enters the new workflow on dispatch. Older clients can still process
-- unrequested legacy items during rollout, but cannot bypass a sent confirmation.
create function app.guard_holiday_confirmation_settlement()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  confirmation app.holiday_work_confirmations;
  settlement app.holiday_work_settlements;
  day_row app.holiday_work_days;
  policy app.holiday_work_policy;
begin
  select * into day_row from app.holiday_work_days where id=new.work_id;
  select * into confirmation from app.holiday_work_confirmations c
    where c.work_id=day_row.id and c.report_version=day_row.report_version;
  if confirmation.id is null then return new; end if;
  select * into settlement from app.holiday_work_settlements where id=new.settlement_id;
  if confirmation.choice is distinct from settlement.mode or confirmation.signed_path is null or not exists (
    select 1 from storage.objects o where o.bucket_id='holiday-work-confirmations' and o.name=confirmation.signed_path
  ) then raise exception '직원이 선택한 보상방법과 서명본을 확인한 뒤 정산해 주세요.' using errcode='23514'; end if;
  if settlement.mode='leave' then
    select * into policy from app.holiday_work_policy h
      where h.company_id=day_row.company_id and h.agreement_date<=day_row.work_date for share;
    if confirmation.agreement_at is null or policy.updated_at is distinct from confirmation.agreement_at then
      raise exception '근무 건에 적용된 보상휴가 서면합의가 변경되었습니다.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger holiday_confirmation_before_allocation before insert on app.holiday_work_allocations
for each row execute function app.guard_holiday_confirmation_settlement();

create or replace function app.holiday_work(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if app.meeting_company_id() is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  if p_action='list' then return app.holiday_work_confirmation_list((p->>'month')::date,p->>'scope',(p->>'request')::uuid);
  elsif p_action in ('plan','submit','review','cancel') then return jsonb_build_object('id',app.holiday_work_day_action(p_action,p));
  elsif p_action in ('confirmation-request','confirmation-respond','confirmation-return','confirmation-file') then
    return jsonb_build_object('id',app.holiday_work_confirmation_action(p_action,p));
  elsif p_action='settle' then return jsonb_build_object('id',app.holiday_work_settle(p));
  elsif p_action in ('policy','paid') then return app.holiday_work_settings(p_action,p);
  elsif p_action='offsite-settle' then return app.holiday_work_offsite_settle(p);
  else raise exception '지원하지 않는 처리입니다.' using errcode='23514'; end if;
end $$;

revoke all on function app.holiday_work_confirmation_list(date,text,uuid),
  app.holiday_work_confirmation_action(text,jsonb), app.guard_holiday_confirmation_settlement() from public, anon, authenticated;

commit;
