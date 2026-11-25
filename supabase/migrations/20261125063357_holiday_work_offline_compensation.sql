begin;

-- Keep signed forms and old policy metadata intact. Operations may attest that
-- the company's offline compensation rules allow the employee to choose leave.
alter table app.holiday_work_confirmations
  add column offline_leave_authorized_by uuid,
  add column offline_leave_authorized_at timestamptz,
  add constraint holiday_work_offline_leave_check
    check ((offline_leave_authorized_by is null) = (offline_leave_authorized_at is null));

create or replace function app.holiday_work_confirmation_list(p_month date, p_scope text, p_request uuid)
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
        'allowLeave', (c.offline_leave_authorized_by is not null or coalesce(c.agreement_at=policy.updated_at,false))
      )) end order by item.position
    ),'[]'::jsonb)) into result
    from jsonb_array_elements(result->'rows') with ordinality item(row,position)
    left join public.profiles employee on employee.id=(item.row->>'employeeId')::uuid
    left join app.holiday_work_days d on d.id=(item.row->>'id')::uuid
    left join app.holiday_work_confirmations c on c.work_id=d.id and c.report_version=d.report_version
    left join app.holiday_work_policy policy on policy.company_id=d.company_id;
  end if;
  return result || '{"confirmationWorkflow":true,"offlineCompensation":true}'::jsonb;
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
      if method='leave' then
        if confirmation.offline_leave_authorized_by is null then
          select * into policy from app.holiday_work_policy h where h.company_id=company and h.agreement_date<=day_row.work_date for share;
          if confirmation.agreement_at is null or policy.updated_at is distinct from confirmation.agreement_at then
            raise exception '이 근무 건은 보상휴가를 선택할 수 없습니다. 운영지원에 문의하세요.' using errcode='23514';
          end if;
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
  if confirmation.id is null then return new; end if;
  select * into settlement from app.holiday_work_settlements where id=new.settlement_id;
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

create or replace function app.holiday_work_settle(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id(); employee uuid; ids uuid[]; item app.holiday_work_days; previous app.holiday_work_settlements;
 v_id uuid:=(p->>'id')::uuid; mode text:=p->>'mode'; available integer:=0; units integer; left_units integer; take_units integer;
 days numeric; expires date; rate numeric; month date; v_grant uuid; agreement text; note text:=btrim(coalesce(p->>'note',''));
 offline_authorized boolean; has_offline_authorization boolean:=false; needs_legacy_policy boolean:=false;
begin
 if not app.holiday_work_ops() or company is null then raise exception '운영지원 보상 확정 권한이 필요합니다.' using errcode='42501'; end if;
 if v_id is null or mode is null or mode not in ('cash','leave') or jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') not between 1 and 100 or length(note) not between 1 and 500 then raise exception '정산할 기록과 처리 사유를 확인하세요.' using errcode='23514'; end if;
 select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(p->'ids');
 select * into previous from app.holiday_work_settlements where holiday_work_settlements.id=v_id;
 if found then
  if previous.company_id=company and previous.request_hash=md5(p::text) then return v_id; end if;
  raise exception '이미 사용한 정산 번호입니다.' using errcode='40001';
 end if;
 select employee_id into employee from app.holiday_work_days where holiday_work_days.id=ids[1] and company_id=company;
 if employee is null then raise exception '정산 대상에 접근할 수 없습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(employee::text,0));
 if (select count(*) from app.holiday_work_days d where d.id=any(ids) and d.company_id=company and d.employee_id=employee)<>cardinality(ids) then raise exception '같은 직원의 기록만 함께 정산할 수 있습니다.' using errcode='42501'; end if;
 for item in select * from app.holiday_work_days d where d.id=any(ids) order by d.work_date,d.id for update loop
  if item.state<>'approved' or item.version is distinct from (p->'versions'->>item.id::text)::integer or app.holiday_work_legacy(employee,item.work_date) then raise exception '확인 상태나 기존 정산이 변경되었습니다. 다시 조회하세요.' using errcode='40001'; end if;
  if app.holiday_work_remaining(item.id)<=0 then raise exception '이미 전부 정산한 날짜가 포함되어 있습니다. 선택을 해제하고 다시 조회하세요.' using errcode='40001'; end if;
  if mode='leave' then
   select exists(select 1 from app.holiday_work_confirmations c
     where c.work_id=item.id and c.report_version=item.report_version and c.offline_leave_authorized_by is not null)
     into offline_authorized;
   has_offline_authorization:=has_offline_authorization or offline_authorized;
   needs_legacy_policy:=needs_legacy_policy or not offline_authorized;
  end if;
  available:=available+app.holiday_work_remaining(item.id);
 end loop;
 if available<=0 then raise exception '미정산 시간이 없습니다.' using errcode='23514'; end if;
 if mode='leave' then
  if needs_legacy_policy then
   select agreement_ref into agreement from app.holiday_work_policy
    where company_id=company and agreement_date<=(now() at time zone 'Asia/Seoul')::date for share;
   if agreement is null then raise exception '보상휴가 선택이 허용된 확인서를 확인해 주세요.' using errcode='23514'; end if;
  end if;
  if has_offline_authorization then
   agreement:=case when agreement is null then '운영지원 오프라인 적용 확인' else '운영지원 오프라인 적용 확인 · '||agreement end;
  end if;
  days:=(p->>'days')::numeric;expires:=(p->>'expires')::date;
  if days is null or days<=0 or days>365 or days*4%1<>0 or expires is null or expires<(now() at time zone 'Asia/Seoul')::date then raise exception '반반차 단위 지급 일수와 사용기한을 확인하세요.' using errcode='23514'; end if;
  units:=(days*960)::integer;
  if units>available then raise exception '선택한 실제 근무의 보상 시간이 부족합니다.' using errcode='23514'; end if;
  v_grant:=app.save_employee_extra_leave(gen_random_uuid(),employee,days,expires,left('휴일근무 보상휴가 · '||note,500),0,false);
 else
  rate:=(p->>'rate')::numeric;month:=(p->>'month')::date;units:=available;
  if rate is null or rate<=0 or rate>10000000 or rate*100%1<>0 or month is null or extract(day from month)<>1 or month<(select date_trunc('month',max(work_date))::date from app.holiday_work_days where holiday_work_days.id=any(ids)) then raise exception '통상시급과 지급 예정 월을 확인하세요.' using errcode='23514'; end if;
 end if;
 insert into app.holiday_work_settlements(id,company_id,employee_id,mode,units,hourly_won,amount_won,payment_month,leave_days,expires_on,grant_id,agreement_ref,note,request_hash,actor_id)
 values(v_id,company,employee,mode,units,rate,case when mode='cash' then ceil(units::numeric*rate/120)::bigint end,month,days,expires,v_grant,agreement,note,md5(p::text),auth.uid());
 left_units:=units;
 for item in select * from app.holiday_work_days d where d.id=any(ids) order by d.work_date,d.id loop
  take_units:=least(left_units,app.holiday_work_remaining(item.id));
  if take_units>0 then
   insert into app.holiday_work_allocations values(v_id,item.id,take_units);
   update app.holiday_work_days set version=version+1,updated_at=clock_timestamp() where holiday_work_days.id=item.id;
   perform app.holiday_work_event(item.id,'settled','employee',case when mode='cash' then '수당 지급 예정으로 확정했습니다. 실제 지급 완료는 별도로 기록합니다.' else '보상휴가를 지급했습니다. 남은 보상 시간은 미정산으로 보존합니다.' end,v_id);
   left_units:=left_units-take_units;
  end if;
 end loop;
 if mode='cash' then perform app.holiday_work_event(ids[1],'payment','operations','확정한 수당의 실제 지급 완료 확인이 필요합니다.',v_id); end if;
 perform app.holiday_work_signal(employee);
 return v_id;
end $$;

commit;
