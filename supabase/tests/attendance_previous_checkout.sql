-- 실제 사용자/출퇴근 값은 수정하지 않는다. 임시 표만 사용하고
-- 마지막에 반드시 ROLLBACK한다. Auth 계정은 생성하지 않는다.
begin;
create temp table test_actor as select id,company_id,department_id from public.profiles where lower(email)='dev@atelier.local' and status='active';
do $$ begin if (select count(*) from test_actor)<>1 then raise exception '개발자 검증 계정을 확인해 주세요.'; end if; end $$;
create temp table test_before as select
  (select md5(string_agg(to_jsonb(p)::text,',' order by id)) from public.profiles p) as profiles,
  (select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.attendance_clock_ins c) as clocks;
create temp table fixture_requests as select * from public.company_leave_requests with no data;
create temp table fixture_starts as select * from public.attendance_start_settings with no data;
create temp table fixture_hours as select * from public.company_work_hours with no data;
create temp table fixture_clocks as select * from public.attendance_clock_ins with no data;
create function pg_temp.test_now() returns timestamptz language sql immutable as $$ select timestamptz '2099-12-31 09:05:00+09'; $$;
-- 배포된 함수 본문을 그대로 사용하고 시계와 요청/근무기준 조회 대상만 시험 자료로 바꾼다.
do $$ declare body text; begin
  body:=pg_get_functiondef('app.confirm_previous_clock_out(date,timestamptz)'::regprocedure);
  body:=replace(body,'app.confirm_previous_clock_out(','pg_temp.test_confirm(');
  body:=replace(body,'clock_timestamp()','pg_temp.test_now()');
  body:=replace(body,'public.company_leave_requests','pg_temp.fixture_requests');
  body:=replace(body,'public.attendance_clock_ins','pg_temp.fixture_clocks');
  execute body;
  body:=pg_get_functiondef('app.get_my_workday_basis(date)'::regprocedure);
  body:=replace(body,'app.get_my_workday_basis(','pg_temp.test_basis(');
  body:=replace(body,'public.attendance_start_settings','pg_temp.fixture_starts');
  body:=replace(body,'public.company_work_hours','pg_temp.fixture_hours');
  execute body;
end $$;
insert into fixture_clocks(id,company_id,employee_id,work_date,clock_in)
  select gen_random_uuid(),company_id,id,date '2099-12-30',time '09:00' from test_actor
  union all select gen_random_uuid(),company_id,id,date '2099-12-31',time '09:00' from test_actor;
insert into fixture_starts(id,company_id,month,department_id,employee_id,source,start_time,updated_at)
  select gen_random_uuid(),company_id,date '2099-12-01',department_id,null,'department',time '09:00',now() from test_actor;
insert into fixture_hours(company_id,lunch_start,lunch_end) select company_id,time '12:30',time '13:30' from test_actor;
select set_config('request.jwt.claim.sub',(select id::text from test_actor),true);
create function pg_temp.must_reject(p_date date,p_stamp timestamptz) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
  begin perform pg_temp.test_confirm(p_date,p_stamp); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception '거부해야 하는 확인 요청이 허용됐습니다: % %',p_date,p_stamp; end if;
end $$;
set local role authenticated;
do $$ declare result jsonb; begin
  if has_function_privilege('anon','public.get_my_workday_basis(date)','execute')
    or has_function_privilege('anon','public.confirm_previous_clock_out(date,timestamptz)','execute') then raise exception '익명 호출 허용 오류'; end if;
  result:=pg_temp.test_basis(date '2099-12-30');
  if result->>'start_time'<>'09:00:00' or result->>'lunch_start'<>'12:30:00' then raise exception '부서 기준 조회 실패: %',result; end if;
  perform pg_temp.must_reject(date '2099-12-29',timestamptz '2099-12-30 18:00+09');
  perform pg_temp.must_reject(date '2099-12-31',timestamptz '2099-12-30 18:00+09');
  perform pg_temp.must_reject(date '2099-12-30',timestamptz '2099-12-30 08:59+09');
  perform pg_temp.must_reject(date '2099-12-30',timestamptz '2099-12-31 09:01+09');
  perform pg_temp.must_reject(date '2099-12-30',timestamptz '2099-12-30 18:00:30+09');
end $$;
reset role;
insert into fixture_starts(id,company_id,month,department_id,employee_id,source,start_time,updated_at)
  select gen_random_uuid(),company_id,date '2099-12-01',department_id,id,'individual',time '10:00',now() from test_actor;
insert into fixture_requests(id,company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at)
  select gen_random_uuid(),company_id,id,'correction',date '2099-12-30',date '2099-12-30',time '09:00',time '18:00','pending',now() from test_actor;
set local role authenticated;
do $$ declare result jsonb; begin
  result:=pg_temp.test_basis(date '2099-12-30');
  if result->>'start_time'<>'10:00:00' then raise exception '개인 우선 기준 조회 실패'; end if;
  result:=pg_temp.test_confirm(date '2099-12-30',timestamptz '2099-12-30 18:00+09');
  if result->>'outcome'<>'correction_pending' or result->>'clock_out_at' is not null then raise exception '대기 정정 중복 처리 오류'; end if;
end $$;
reset role;
update fixture_requests set status='approved';
set local role authenticated;
do $$ begin
  if pg_temp.test_confirm(date '2099-12-30',timestamptz '2099-12-30 18:00+09')->>'outcome'<>'corrected' then raise exception '승인된 정정 중복 처리 오류'; end if;
end $$;
reset role;
truncate fixture_requests;
set local role authenticated;
do $$ declare first_result jsonb; second_result jsonb; begin
  first_result:=pg_temp.test_confirm(date '2099-12-30',timestamptz '2099-12-31 01:00+09');
  second_result:=pg_temp.test_confirm(date '2099-12-30',timestamptz '2099-12-30 18:00+09');
  if first_result->>'outcome'<>'recorded' or first_result->>'clock_out_reported_at' is null then raise exception '새벽 퇴근 저장/확인 시각 오류'; end if;
  if second_result->>'outcome'<>'already_recorded' or second_result->>'clock_out_at'<>first_result->>'clock_out_at' then raise exception '기존 퇴근을 덮어썼습니다.'; end if;
  if (first_result->>'clock_out_at')::timestamptz<>timestamptz '2099-12-31 01:00+09' then raise exception '퇴근 시간대 변환 오류'; end if;
end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$ declare rejected boolean:=false; begin
  begin perform pg_temp.test_basis(date '2099-12-30'); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception '소속 없는 계정의 조회가 허용됐습니다.'; end if;
  perform pg_temp.must_reject(date '2099-12-30',timestamptz '2099-12-30 18:00+09');
end $$;
reset role;
do $$ begin
  if (select clock_in from fixture_clocks where employee_id=(select id from test_actor) and work_date=date '2099-12-31')<>time '09:00' then raise exception '오늘 출근 시각 변경 감지'; end if;
  if (select md5(string_agg(to_jsonb(p)::text,',' order by id)) from public.profiles p)<>(select profiles from test_before) then raise exception '프로필 변경 감지'; end if;
  if (select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.attendance_clock_ins c)<>(select clocks from test_before) then raise exception '기존 출퇴근 변경 감지'; end if;
end $$;
rollback;
select 'attendance_previous_checkout_db_tests_passed' as verification;
