-- Confirm the employee's submitted choice and use the existing leave/holiday ledgers.
begin;

alter table app.holiday_work_settlements
  add column confirmation_id uuid references app.holiday_work_confirmations(id),
  add column overtime_minutes integer,
  drop constraint holiday_work_settlements_mode_check,
  drop constraint holiday_work_settlements_check,
  add constraint holiday_work_settlements_mode_check check (mode in ('cash','leave','overtime')),
  add constraint holiday_work_settlements_check check (
    (mode='cash' and hourly_won>0 and amount_won>0 and payment_month is not null
      and grant_id is null and confirmation_id is null and overtime_minutes is null)
    or (mode='leave' and leave_days>0 and expires_on is not null and grant_id is not null
      and (agreement_ref is not null or confirmation_id is not null) and overtime_minutes is null)
    or (mode='overtime' and overtime_minutes is not null and overtime_minutes between 1 and 1440
      and confirmation_id is not null and grant_id is null and amount_won is null and payment_month is null)
  );

create unique index holiday_work_settlements_confirmation_idx
  on app.holiday_work_settlements(confirmation_id) where confirmation_id is not null;

create function app.holiday_work_settle_confirmed(p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); company uuid:=app.meeting_company_id();
  settlement_id uuid:=(p->>'id')::uuid; work_id uuid:=(p->>'workId')::uuid;
  day_row app.holiday_work_days; confirmation app.holiday_work_confirmations;
  previous app.holiday_work_settlements; units integer;
  mode text; worked integer; days numeric; expires date; grant_id uuid;
  today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  if not app.holiday_work_ops() then
    raise exception '운영지원 정산 권한이 필요합니다.' using errcode='42501';
  end if;
  if settlement_id is null or p->'verified' is distinct from 'true'::jsonb then
    raise exception '직원이 제출한 보상방법을 확인해 주세요.' using errcode='23514';
  end if;
  select * into day_row from app.holiday_work_days d where d.id=work_id and d.company_id=company;
  if not found then raise exception '근무 건을 처리할 권한이 없습니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(day_row.employee_id::text,0));
  select * into day_row from app.holiday_work_days d where d.id=work_id and d.company_id=company for update;
  select * into previous from app.holiday_work_settlements s where s.id=settlement_id;
  if found then
    if previous.company_id=company and previous.actor_id=actor and previous.request_hash=md5(p::text) then
      return previous.id;
    end if;
    raise exception '이미 사용한 처리 번호입니다. 다시 조회해 주세요.' using errcode='40001';
  end if;
  units:=app.holiday_work_remaining(day_row.id);
  select * into confirmation from app.holiday_work_confirmations c
  where c.work_id=day_row.id and c.report_version=day_row.report_version for update;
  if day_row.state is distinct from 'approved' or day_row.version is distinct from (p->>'version')::integer
    or units is null or units<=0 or app.holiday_work_legacy(day_row.employee_id,day_row.work_date)
    or confirmation.id is null or confirmation.id is distinct from (p->>'confirmationId')::uuid
    or not coalesce(confirmation.choice in ('cash','leave'),false) then
    raise exception '근무나 확인서가 변경되었거나 이미 처리되었습니다. 다시 조회해 주세요.' using errcode='40001';
  end if;

  if confirmation.choice='cash' then
    mode:='overtime';
    worked:=(p->>'minutes')::integer;
    if worked is null or worked not between 1 and 1440 then
      raise exception '실제 근무시간을 확인해 주세요.' using errcode='23514';
    end if;
  else
    mode:='leave';
    days:=(p->>'days')::numeric;
    expires:=(p->>'expires')::date;
    if days is null or days<=0 or days>365 or days*4%1<>0 or expires is null or expires<today then
      raise exception '반반차 단위 지급 일수와 사용기한을 확인해 주세요.' using errcode='23514';
    end if;
    grant_id:=app.save_employee_extra_leave(gen_random_uuid(),day_row.employee_id,days,expires,
      '휴일근무 보상휴가 · '||day_row.work_date,0,false);
  end if;

  insert into app.holiday_work_settlements
    (id,company_id,employee_id,mode,units,leave_days,expires_on,grant_id,note,request_hash,actor_id,confirmation_id,overtime_minutes)
  values
    (settlement_id,company,day_row.employee_id,mode,units,days,expires,grant_id,
     '직원이 제출한 보상방법을 확인했습니다.',md5(p::text),actor,confirmation.id,worked);
  insert into app.holiday_work_allocations(settlement_id,work_id,units) values(settlement_id,day_row.id,units);
  update app.holiday_work_days set version=version+1,updated_at=clock_timestamp() where id=day_row.id;
  perform app.holiday_work_event(day_row.id,'settled','employee',case when mode='overtime'
    then '확정된 실제 근무시간을 야근 누적에 반영했습니다.'
    else '보상휴가를 연차현황에 반영했습니다.' end,settlement_id);
  perform app.holiday_work_signal(day_row.employee_id);
  return settlement_id;
end $$;

create function app.holiday_work_overtime_credits(p_month date,p_scope text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id();
begin
  if p_scope is null or p_scope not in ('mine','operations') or (p_scope='operations' and not app.holiday_work_ops()) then
    raise exception '야근 누적 조회 권한이 없습니다.' using errcode='42501';
  end if;
  if p_month is null or extract(day from p_month)<>1 then
    raise exception '조회할 월을 확인해 주세요.' using errcode='23514';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'employeeId',d.employee_id,'employeeName',p.display_name,'departmentId',p.department_id,
    'departmentName',dep.name,'date',d.work_date,'minutes',s.overtime_minutes
    ) order by d.work_date,s.id),'[]'::jsonb)
  from app.holiday_work_days d
  join app.holiday_work_allocations a on a.work_id=d.id
  join app.holiday_work_settlements s on s.id=a.settlement_id and s.mode='overtime'
  join public.profiles p on p.id=d.employee_id
  left join public.departments dep on dep.id=p.department_id
  where d.company_id=company and (p_scope='operations' or d.employee_id=auth.uid())
    and d.work_date>=p_month and d.work_date<p_month+interval '1 month');
end $$;

revoke all on function app.holiday_work_settle_confirmed(jsonb),
  app.holiday_work_overtime_credits(date,text) from public,anon,authenticated;

create or replace function app.holiday_work_confirmation_list(p_month date, p_scope text, p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb := app.holiday_work_list(p_month,p_scope,p_request);
begin
  if p_scope in ('mine','operations') then
    select jsonb_set(result,'{rows}',coalesce(jsonb_agg(
      item.row || jsonb_build_object('jobGrade',employee.job_grade) ||
      jsonb_build_object('settlements',coalesce((select jsonb_agg(
        entry.value || case when s.overtime_minutes is null then '{}'::jsonb
          else jsonb_build_object('overtimeMinutes',s.overtime_minutes) end order by entry.position)
        from jsonb_array_elements(item.row->'settlements') with ordinality entry(value,position)
        left join app.holiday_work_settlements s on s.id=(entry.value->>'id')::uuid
      ),'[]'::jsonb)) ||
      case when c.id is null then '{}'::jsonb else jsonb_build_object('confirmation',jsonb_build_object(
        'id',c.id,'work',c.snapshot,'requestedAt',c.requested_at,'choice',c.choice,
        'respondedAt',c.responded_at,'correctionReason',c.correction_reason,
        'signedPath',case when p_scope='operations' then c.signed_path end,
        'signedAt',c.signed_at,
        'allowLeave', true
      )) end order by item.position
    ),'[]'::jsonb)) into result
    from jsonb_array_elements(result->'rows') with ordinality item(row,position)
    left join public.profiles employee on employee.id=(item.row->>'employeeId')::uuid
    left join app.holiday_work_days d on d.id=(item.row->>'id')::uuid
    left join app.holiday_work_confirmations c on c.work_id=d.id and c.report_version=d.report_version;
  end if;
  return result || '{"confirmationWorkflow":true,"offlineCompensation":true,"confirmedSettlement":true}'::jsonb;
end $$;

create or replace function app.holiday_work_confirmation_action(p_action text, p jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  company uuid := app.meeting_company_id();
  work_id uuid := (p->>'workId')::uuid;
  employee uuid;
  day_row app.holiday_work_days;
  confirmation app.holiday_work_confirmations;
  policy app.holiday_work_policy;
  authorize_leave boolean := coalesce(p->'leaveAuthorized' = 'true'::jsonb,false);
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
    if confirmation.id is not null then
      -- An already sent cash-only request can be opened for leave before the employee responds.
      if authorize_leave and p ? 'confirmationId' then
        if confirmation.id is distinct from (p->>'confirmationId')::uuid then
          raise exception '확인서가 변경되었습니다. 다시 조회해 주세요.' using errcode='40001';
        end if;
        if confirmation.offline_leave_authorized_by is not null then return confirmation.id; end if;
        if confirmation.choice is not null
          or exists(select 1 from app.holiday_work_allocations a where a.work_id=day_row.id) then
          raise exception '직원이 제출했거나 일부 정산된 확인서입니다. 다시 조회해 주세요.' using errcode='40001';
        end if;
        update app.holiday_work_confirmations
        set offline_leave_authorized_by=actor,offline_leave_authorized_at=clock_timestamp()
        where id=confirmation.id;
        perform app.holiday_work_signal(employee);
      elsif authorize_leave then
        if confirmation.offline_leave_authorized_by is null then
          raise exception '이미 보낸 확인서입니다. 선택 범위를 변경하려면 다시 조회해 주세요.' using errcode='40001';
        end if;
      end if;
      return confirmation.id;
    elsif p ? 'confirmationId' then
      raise exception '확인서가 변경되었습니다. 다시 조회해 주세요.' using errcode='40001';
    end if;
    if not authorize_leave and p->>'allowLeave'='true' then
      select * into policy from app.holiday_work_policy h where h.company_id=company and h.agreement_date<=day_row.work_date for share;
      if policy.company_id is null then
        raise exception '이 근무일에 적용되는 보상휴가 서면합의를 확인해 주세요.' using errcode='23514';
      end if;
    end if;
    insert into app.holiday_work_confirmations
      (work_id,report_version,snapshot,agreement_at,requested_by,offline_leave_authorized_by,offline_leave_authorized_at)
    select day_row.id,day_row.report_version,jsonb_build_object(
      'name',employee_profile.display_name,'department',department.name,'grade',employee_profile.job_grade,
      'date',day_row.work_date,'location',day_row.location,'intervals',day_row.intervals,'actualMinutes',day_row.actual_minutes,
      'creditUnits',day_row.credit_units,'remainingUnits',app.holiday_work_remaining(day_row.id),'reason',day_row.reason,
      'requestedBy',operator.display_name,'agreementRef',policy.agreement_ref
    ), policy.updated_at,actor,
      case when authorize_leave then actor end,case when authorize_leave then clock_timestamp() end
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
      if method is null or method not in ('cash','leave') then
        raise exception '보상방법을 선택해 주세요.' using errcode='23514';
      end if;
      update app.holiday_work_confirmations set choice=method,responded_at=clock_timestamp() where id=confirmation.id;
      perform app.holiday_work_event(day_row.id,'confirmation-submitted','operations','직원이 보상방법을 제출했습니다. 제출 내용을 확인한 뒤 보상을 확정해 주세요.');
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

create or replace function app.guard_holiday_confirmation_settlement()
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
  select * into settlement from app.holiday_work_settlements where id=new.settlement_id;
  if settlement.confirmation_id is not null then
    if settlement.confirmation_id is distinct from confirmation.id
      or confirmation.choice is distinct from (case when settlement.mode='overtime' then 'cash' else settlement.mode end) then
      raise exception '현재 확인서의 보상방법을 확인해 주세요.' using errcode='23514';
    end if;
    return new;
  end if;
  if confirmation.id is null then return new; end if;
  if confirmation.choice is distinct from settlement.mode or confirmation.signed_path is null or not exists (
    select 1 from storage.objects o where o.bucket_id='holiday-work-confirmations' and o.name=confirmation.signed_path
  ) then raise exception '직원이 선택한 보상방법과 서명본을 확인한 뒤 정산해 주세요.' using errcode='23514'; end if;
  if settlement.mode='leave' and confirmation.offline_leave_authorized_by is null then
    select * into policy from app.holiday_work_policy h
      where h.company_id=day_row.company_id and h.agreement_date<=day_row.work_date for share;
    if confirmation.agreement_at is null or policy.updated_at is distinct from confirmation.agreement_at then
      raise exception '근무 건에 적용된 보상휴가 서면합의가 변경되었습니다.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

create or replace function app.holiday_work_notifications()
returns jsonb language sql stable security definer set search_path='' as $$
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
  where app.holiday_work_can_view(d.employee_id) and (e.audience='employee' and d.employee_id=auth.uid()
    or e.audience='reviewer' and app.holiday_work_review(d.employee_id)
    or e.audience='operations' and app.holiday_work_ops())
$$;

create or replace function app.holiday_work(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if app.meeting_company_id() is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501'; end if;
  if p_action='list' then return app.holiday_work_confirmation_list((p->>'month')::date,p->>'scope',(p->>'request')::uuid);
  elsif p_action in ('plan','submit','review','cancel') then return jsonb_build_object('id',app.holiday_work_day_action(p_action,p));
  elsif p_action in ('confirmation-request','confirmation-respond','confirmation-return','confirmation-file') then
    return jsonb_build_object('id',app.holiday_work_confirmation_action(p_action,p));
  elsif p_action='settle-confirmed' then return jsonb_build_object('id',app.holiday_work_settle_confirmed(p));
  elsif p_action='overtime-credits' then return app.holiday_work_overtime_credits((p->>'month')::date,p->>'scope');
  elsif p_action='settle' then return jsonb_build_object('id',app.holiday_work_settle(p));
  elsif p_action in ('policy','paid') then return app.holiday_work_settings(p_action,p);
  elsif p_action='offsite-settle' then return app.holiday_work_offsite_settle(p);
  else raise exception '지원하지 않는 처리입니다.' using errcode='23514'; end if;
end $$;

commit;
