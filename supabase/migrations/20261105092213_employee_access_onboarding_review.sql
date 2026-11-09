-- 신규직원 승인여부의 관리: 기존 승인 권한을 사용하며, 입사 기록 연결과 함께 원자적으로 처리한다.
-- 기존 표·트리거·함수·정책·권한 지정과 기존 운영 클라이언트는 변경하지 않는다.
create function app.review_employee_access(
  p_decision text default 'check', p_profile uuid default null, p_display_name text default null,
  p_department uuid default null, p_position text default null, p_job_grade text default null, p_hire_date date default null
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $function$
declare
  actor public.profiles;
  target public.profiles;
  onboarding app.employee_onboardings;
  permitted boolean;
  prepared boolean := false;
begin
  select * into actor from public.profiles
  where id=auth.uid() and status='active' and company_id='e0000000-0000-4000-8000-000000000001'::uuid;
  permitted := found and (
    (app.is_operations_department_member() and exists(select 1 from public.departments where id=actor.department_id and company_id=actor.company_id and is_active))
    or app.can_approve(null::uuid)
  );
  if p_decision='check' then return jsonb_build_object('ready',true,'canReview',coalesce(permitted,false)); end if;
  if not coalesce(permitted,false) or auth.uid()=p_profile then raise exception using errcode='42501',message='가입 승인 권한이 없습니다.'; end if;
  if p_decision is null or p_decision not in('approve','reject') then raise exception using errcode='22023',message='승인 또는 거절을 선택해 주세요.'; end if;

  select * into target from public.profiles where id=p_profile and company_id=actor.company_id and status='pending' for update;
  if not found then raise exception using errcode='40001',message='가입 대기 신청이 없거나 다른 담당자가 이미 처리했습니다. 목록을 새로고침해 주세요.'; end if;
  if not (app.operations_may_decide_access(target.id,target.status) or app.can_approve(target.id)) then
    raise exception using errcode='42501',message='가입 승인 권한이 없습니다.';
  end if;
  if p_decision='reject' then
    update public.profiles set status='rejected',approved_by=auth.uid(),approved_at=now() where id=target.id and status='pending';
    return jsonb_build_object('status','rejected');
  end if;

  if p_display_name is null or length(btrim(p_display_name)) not between 2 and 50 then raise exception '본명을 확인해 주세요.'; end if;
  if p_department is not null and not exists(select 1 from public.departments where id=p_department and company_id=actor.company_id and is_active) then
    raise exception '같은 회사의 활성 부서를 선택해 주세요.';
  end if;
  if p_hire_date is not null and (p_hire_date<date '1950-01-01' or p_hire_date>(timezone('Asia/Seoul',now()))::date) then
    raise exception '입사일은 1950-01-01부터 오늘까지 입력할 수 있습니다.';
  end if;

  -- 신청 시각이 없는 예전 가입 대기자도 승인 뒤 서류 목록에서 사라지지 않는다.
  insert into app.employee_onboardings(company_id,profile_id) values(actor.company_id,target.id) on conflict do nothing;
  select * into onboarding from app.employee_onboardings where profile_id=target.id and not is_test for update;
  -- 기존에 준비한 근무·급여 값은 유지하고, 이번 승인창에서 확인한 배치 값만 맞춘다.
  if onboarding.company_info<>'{}'::jsonb and app.onboarding_manager() then
    perform app.save_employee_onboarding(onboarding.id,'company',onboarding.company_info||jsonb_build_object(
      'departmentId',coalesce(p_department::text,''),'position',coalesce(nullif(btrim(p_position),''),''),
      'jobGrade',coalesce(nullif(btrim(p_job_grade),''),''),'hireDate',coalesce(p_hire_date::text,'')
    ),onboarding.version,app.onboarding_stamp(target.id));
    prepared := true;
  end if;
  update public.profiles set display_name=btrim(p_display_name),department_id=p_department,
    position=nullif(btrim(p_position),''),job_grade=nullif(btrim(p_job_grade),''),hire_date=p_hire_date,
    status='active',approved_by=auth.uid(),approved_at=now()
  where id=target.id and status='pending';
  -- 기존 접수 트리거의 대상이 아닌 신청 시각 없는 건만 여기에서 준비 정보의 실제 반영을 마친다.
  if prepared and target.requested_at is null then
    select * into onboarding from app.employee_onboardings where profile_id=target.id and not is_test;
    perform app.save_employee_onboarding(onboarding.id,'company',onboarding.company_info,onboarding.version,app.onboarding_stamp(target.id));
  end if;
  return jsonb_build_object('status','active');
end;
$function$;
revoke all on function app.review_employee_access(text,uuid,text,uuid,text,text,date) from public,anon,authenticated;
grant execute on function app.review_employee_access(text,uuid,text,uuid,text,text,date) to authenticated;

create function public.review_employee_access(
  p_decision text default 'check', p_profile uuid default null, p_display_name text default null,
  p_department uuid default null, p_position text default null, p_job_grade text default null, p_hire_date date default null
) returns jsonb language sql security invoker set search_path='' as $function$
  select app.review_employee_access(p_decision,p_profile,p_display_name,p_department,p_position,p_job_grade,p_hire_date);
$function$;
revoke all on function public.review_employee_access(text,uuid,text,uuid,text,text,date) from public,anon,authenticated;
grant execute on function public.review_employee_access(text,uuid,text,uuid,text,text,date) to authenticated;

notify pgrst, 'reload schema';
