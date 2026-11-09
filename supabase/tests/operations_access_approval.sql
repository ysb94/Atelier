-- 실제 authenticated 역할로 검사하고, 가상 Auth/프로필은 성공·실패 모두 롤백한다.
-- 기존 직원은 인증 문맥으로만 사용하며 기존 계정/신청을 수정하지 않는다.
do $proof$
declare
  company constant uuid := 'e0000000-0000-4000-8000-000000000001';
  operations constant uuid := '2e49ef43-75b9-4c89-b42d-9fd50ad9087b';
  fixture_ops uuid := gen_random_uuid();
  fixture_staff uuid := gen_random_uuid();
  fixture_target uuid := gen_random_uuid();
  fixture_id uuid;
  actor_id uuid;
  actor_count integer := 0;
  affected integer;
  blocked boolean;
  attempt record;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    foreach fixture_id in array array[fixture_ops, fixture_staff, fixture_target] loop
      insert into auth.users(id, email, raw_user_meta_data)
      values(fixture_id, 'approval-proof-' || fixture_id::text || '@example.invalid', '{}'::jsonb);
      update public.profiles
      set company_id=company, display_name='승인 검증', requested_at=null,
          status=case when fixture_id=fixture_target then 'pending' else 'active' end,
          department_id=case when fixture_id=fixture_ops then operations else null end,
          position=null, job_grade=null, is_admin=false
      where id=fixture_id;
    end loop;

    -- 현재 운영지원 전원 + 직책·지정 권한이 없는 가상 운영지원 직원.
    for actor_id in
      select id from public.profiles
      where status='active' and company_id=company and department_id=operations
      order by id
    loop
      actor_count := actor_count + 1;
      perform set_config('request.jwt.claim.sub', actor_id::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_id, 'role', 'authenticated')::text, true);
      set local role authenticated;
      if not app.is_operations_department_member() then
        raise exception '운영지원 직원의 가입 승인 권한 누락';
      end if;
      if actor_id=fixture_ops and app.can_approve(fixture_target) then
        raise exception '가상 운영지원 직원에 인사 관리 권한이 잘못 추가됨';
      end if;
      update public.profiles
      set status='active', approved_by=actor_id, approved_at=now(),
          department_id=null, position=null, job_grade=null, hire_date=null,
          display_name='승인 검증'
      where id=fixture_target;
      get diagnostics affected=row_count;
      if affected<>1 or not exists(select 1 from public.profiles where id=fixture_target and status='active' and approved_by=actor_id) then
        raise exception '운영지원 가입 승인 실패';
      end if;
      reset role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{}', true);
      update public.profiles set status='pending', approved_by=null, approved_at=null where id=fixture_target;
      perform set_config('request.jwt.claim.sub', actor_id::text, true);
      set local role authenticated;
      update public.profiles set status='rejected', approved_by=actor_id, approved_at=now() where id=fixture_target;
      get diagnostics affected=row_count;
      if affected<>1 or not exists(select 1 from public.profiles where id=fixture_target and status='rejected') then
        raise exception '운영지원 가입 거절 실패';
      end if;
      reset role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{}', true);
      update public.profiles set status='pending', approved_by=null, approved_at=null where id=fixture_target;
    end loop;
    if actor_count<1 then raise exception '검증할 운영지원 직원 없음'; end if;

    -- 부서를 비운 승인뿐 아니라 유효한 부서를 함께 지정하는 승인도 허용한다.
    perform set_config('request.jwt.claim.sub', fixture_ops::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', fixture_ops, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.profiles set status='active', department_id=operations, approved_by=fixture_ops, approved_at=now() where id=fixture_target;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception '유효한 부서 지정과 가입 승인 실패'; end if;
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    update public.profiles set status='pending', department_id=null, approved_by=null, approved_at=null where id=fixture_target;

    -- 가입 승인과 함께 보내는 관리자·이메일·회사·본명 확인·잘못된 인사 정보는 차단한다.
    update public.profiles set name_confirmed_at=now() where id=fixture_target;
    perform set_config('request.jwt.claim.sub', fixture_ops::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', fixture_ops, 'role', 'authenticated')::text, true);
    set local role authenticated;
    for attempt in select * from (values
      ('관리자 지정', 'is_admin=true'),
      ('이메일 변경', 'email=''changed@example.invalid'''),
      ('회사 변경', 'company_id=null'),
      ('유효하지 않은 부서', 'department_id=gen_random_uuid()'),
      ('본명 확인 해제', 'name_confirmed_at=null'),
      ('미등록 직책', 'position=''검증용 미등록 직책'''),
      ('과거 입사일', 'hire_date=date ''1949-12-31'''),
      ('미래 입사일', 'hire_date=(timezone(''Asia/Seoul'',now()))::date+1')
    ) cases(label, patch) loop
      blocked := false;
      begin
        execute format('update public.profiles set status=''active'', %s where id=$1', attempt.patch) using fixture_target;
        get diagnostics affected=row_count;
        blocked := affected=0;
      exception when insufficient_privilege or raise_exception then
        blocked := true; -- 예상한 접근 차단. 해당 UPDATE는 이 하위 트랜잭션에서 롤백된다.
      end;
      if not blocked then raise exception '보호 항목 변경 허용: %', attempt.label; end if;
    end loop;
    if not exists(select 1 from public.profiles where id=fixture_target and status='pending' and not is_admin) then
      raise exception '실패한 승인에서 신청 원본 변경됨';
    end if;
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);

    -- 소속 회사가 없는 신청도 운영지원 승인 경로로 가져오지 않는다.
    update public.profiles set company_id=null where id=fixture_target;
    perform set_config('request.jwt.claim.sub', fixture_ops::text, true);
    set local role authenticated;
    blocked := false;
    begin
      update public.profiles set status='active', company_id=company where id=fixture_target;
      get diagnostics affected=row_count;
      blocked := affected=0;
    exception when insufficient_privilege or raise_exception then blocked := true;
    end;
    if not blocked then raise exception '회사 경계를 넘는 승인 허용'; end if;
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    update public.profiles set company_id=company where id=fixture_target;

    -- 운영지원 소속만으로 기존 재직자의 계정 정지·관리자 지정은 허용하지 않는다.
    perform set_config('request.jwt.claim.sub', fixture_ops::text, true);
    set local role authenticated;
    for attempt in select * from (values ('status=''disabled'''), ('is_admin=true')) cases(patch) loop
      blocked := false;
      begin
        execute format('update public.profiles set %s where id=$1', attempt.patch) using fixture_staff;
        get diagnostics affected=row_count;
        blocked := affected=0;
      exception when insufficient_privilege or raise_exception then blocked := true;
      end;
      if not blocked then raise exception '기존 재직자의 보호 항목 변경 허용'; end if;
    end loop;
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);

    -- 다른 부서, 비활성 운영지원, 대기자의 자기 승인을 차단한다.
    for actor_id in select unnest(array[fixture_staff, fixture_ops, fixture_target]) loop
      if actor_id=fixture_ops then update public.profiles set status='disabled' where id=fixture_ops; end if;
      perform set_config('request.jwt.claim.sub', actor_id::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_id, 'role', 'authenticated')::text, true);
      set local role authenticated;
      blocked := false;
      begin
        update public.profiles set status='active', approved_by=actor_id, approved_at=now() where id=fixture_target;
        get diagnostics affected=row_count;
        blocked := affected=0;
      exception when insufficient_privilege or raise_exception then blocked := true;
      end;
      if not blocked then raise exception '승인 권한이 없는 계정에서 가입 승인 성공'; end if;
      reset role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{}', true);
    end loop;

    -- 의도한 성공 경로도 모든 가상 기록과 함께 롤백한다.
    raise exception using errcode='ZA001', message='approval proof rollback';
  exception when sqlstate 'ZA001' then
    if sqlerrm<>'approval proof rollback' then raise; end if;
  end;
  if exists(select 1 from auth.users where id=any(array[fixture_ops,fixture_staff,fixture_target]))
     or exists(select 1 from public.profiles where id=any(array[fixture_ops,fixture_staff,fixture_target])) then
    raise exception '검증용 가상 계정이 남아 있음';
  end if;
end;
$proof$;
select jsonb_build_object('passed',true,'fixture_data_retained',false,
  'verified','active operations approval/rejection, protected fields, company boundary, inactive/other/self denial') as verification;
