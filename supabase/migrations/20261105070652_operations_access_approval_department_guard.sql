-- 가입 승인과 함께 저장하는 부서에도 기존 조직 편집의 회사·활성 조건을 적용한다.
-- 나머지 함수 본문과 기존 정책·권한을 그대로 보존한다.
do $migration$
declare
  definition text := pg_get_functiondef('app.guard_profile_changes()'::regprocedure);
  marker constant text := E'  if operations_decision then\n';
  department_check constant text := $check$    -- 가입 승인으로 부서를 지정할 때도 회사 경계를 유지한다.
    if new.department_id is not null and not exists (
      select 1 from public.departments d
      where d.id = new.department_id
        and d.company_id = new.company_id
        and d.is_active
    ) then
      raise exception '같은 회사의 활성 부서를 선택해 주세요.';
    end if;
$check$;
begin
  if strpos(definition, department_check) > 0 then
    return;
  end if;
  if length(definition) - length(replace(definition, marker, '')) <> length(marker) then
    raise exception '가입 승인 보호 함수의 예상 검사 구간을 확인할 수 없습니다.';
  end if;
  execute replace(definition, marker, marker || department_check);
end;
$migration$;
