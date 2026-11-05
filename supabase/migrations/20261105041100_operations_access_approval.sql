-- 운영지원팀 재직 직원은 가입 대기 신청을 조회하고 승인·거절할 수 있다.
-- 재직 계정 정지, 관리자 지정, 조직 전체 편집은 기존 지정 권한에 둔다.

create or replace function app.is_operations_department_member()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.company_id = 'e0000000-0000-4000-8000-000000000001'::uuid
      and p.department_id = '2e49ef43-75b9-4c89-b42d-9fd50ad9087b'::uuid
  );
$function$;

create or replace function app.operations_may_decide_access(target_profile_id uuid, target_status text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select target_status = 'pending'
    and target_profile_id is distinct from auth.uid()
    and app.is_operations_department_member();
$function$;

revoke all on function app.is_operations_department_member() from public, anon;
revoke all on function app.operations_may_decide_access(uuid, text) from public, anon;
grant execute on function app.is_operations_department_member() to authenticated;
grant execute on function app.operations_may_decide_access(uuid, text) to authenticated;

create or replace function app.can_view_members()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    app.is_admin()
    or app.is_company_manager()
    or app.can_manage_personnel()
    or app.can_edit_org_assignment()
    or app.is_operations_department_member();
$function$;

drop policy if exists profiles_operations_access_decision on public.profiles;
create policy profiles_operations_access_decision
on public.profiles
for update
to authenticated
using (
  status = 'pending'
  and id <> auth.uid()
  and company_id = 'e0000000-0000-4000-8000-000000000001'::uuid
  and app.is_operations_department_member()
)
with check (
  status in ('active', 'rejected')
  and id <> auth.uid()
  and company_id = 'e0000000-0000-4000-8000-000000000001'::uuid
  and app.is_operations_department_member()
);

create or replace function app.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_is_admin boolean;
  actor_can_approve boolean;
  self_access_request boolean;
  operations_decision boolean;
begin
  operations_decision := app.operations_may_decide_access(old.id, old.status)
    and new.status in ('active', 'rejected');

  if auth.uid() is not null and auth.uid() <> old.id
    and app.basic_work_allowed('operations')
    and old.company_id = (select p.company_id from public.profiles p where p.id=auth.uid() and p.status='active')
    and (to_jsonb(new)-array['department_id','position','job_grade','hire_date','updated_at'])
      = (to_jsonb(old)-array['department_id','position','job_grade','hire_date','updated_at']) then
    if new.department_id is not null and not exists(select 1 from public.departments d where d.id=new.department_id and d.company_id=old.company_id and d.is_active) then
      raise exception '같은 회사의 활성 부서를 선택해 주세요.';
    end if;
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.is_admin = true
  ) into actor_is_admin;

  self_access_request := auth.uid() = old.id
    and old.status in ('pending', 'rejected')
    and new.status = 'pending';

  if new.department_id is distinct from old.department_id
     or new.position is distinct from old.position
     or new.job_grade is distinct from old.job_grade then
    if not app.can_edit_org_assignment()
       and not operations_decision
       and not (
         self_access_request
         and new.company_id = 'e0000000-0000-4000-8000-000000000001'::uuid
         and new.position is not distinct from old.position
         and new.job_grade is not distinct from old.job_grade
         and exists (
           select 1 from public.departments d
           where d.id = new.department_id
             and d.company_id = new.company_id
             and d.is_active = true
         )
       ) then
      raise exception '부서와 직책·직급은 개발자와 운영지원팀만 바꿀 수 있습니다.';
    end if;
  end if;

  if new.position is not null and not exists (
    select 1 from public.personnel_titles t
    where t.company_id = new.company_id
      and t.kind = 'duty'
      and t.name = new.position
  ) then
    raise exception '등록된 직책이 아닙니다.';
  end if;
  if new.job_grade is not null and not exists (
    select 1 from public.personnel_titles t
    where t.company_id = new.company_id
      and t.kind = 'grade'
      and t.name = new.job_grade
  ) then
    raise exception '등록된 직급이 아닙니다.';
  end if;

  if new.hire_date is distinct from old.hire_date then
    if not app.can_edit_org_assignment() and not app.can_approve(old.id) and not operations_decision then
      raise exception '입사일은 승인 처리 또는 조직도에서만 바꿀 수 있습니다.';
    end if;
    if new.hire_date is not null and (
      new.hire_date < date '1950-01-01'
      or new.hire_date > (timezone('Asia/Seoul', now()))::date
    ) then
      raise exception '입사일은 1950-01-01부터 오늘까지 입력할 수 있습니다.';
    end if;
  end if;

  if actor_is_admin then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.is_admin is distinct from old.is_admin
       or (
         (new.status is distinct from old.status
           or new.approved_by is distinct from old.approved_by
           or new.approved_at is distinct from old.approved_at)
         and not (
           old.status = 'rejected'
           and new.status = 'pending'
           and new.approved_by is null
           and new.approved_at is null
         )
       ) then
      raise exception '본인은 승인 상태나 관리자 권한을 바꿀 수 없습니다.';
    end if;
    if new.position is distinct from old.position
       or new.job_grade is distinct from old.job_grade then
      raise exception '본인은 직책·직급을 바꿀 수 없습니다.';
    end if;
    if new.department_id is distinct from old.department_id
       and not self_access_request then
      raise exception '본인은 소속을 바꿀 수 없습니다.';
    end if;
    if old.status in ('pending', 'rejected')
       and new.company_id is distinct from 'e0000000-0000-4000-8000-000000000001'::uuid then
      raise exception '신청 회사가 올바르지 않습니다.';
    end if;
    if old.name_confirmed_at is not null
       and new.name_confirmed_at is null then
      raise exception '본명 확인을 해제할 수 없습니다.';
    end if;
    if old.status = 'active' and old.name_confirmed_at is null then
      if new.display_name is distinct from old.display_name
         or new.name_confirmed_at is distinct from old.name_confirmed_at then
        if new.name_confirmed_at is null or new.display_name is null then
          raise exception '본명과 확인을 함께 저장해야 합니다.';
        end if;
      end if;
    elsif old.status = 'active' then
      if new.display_name is distinct from old.display_name
         or new.name_confirmed_at is distinct from old.name_confirmed_at then
        raise exception '본인은 확인한 본명을 바꿀 수 없습니다.';
      end if;
    end if;
    return new;
  end if;

  select app.can_approve(old.id) into actor_can_approve;
  if actor_can_approve then
    if new.is_admin is distinct from old.is_admin then
      raise exception '관리자 권한은 운영진만 지정할 수 있습니다.';
    end if;
    if old.name_confirmed_at is not null
       and new.name_confirmed_at is null then
      raise exception '본명 확인을 해제할 수 없습니다.';
    end if;
    return new;
  end if;

  if app.can_edit_org_assignment() then
    if new.status is distinct from old.status
       or new.is_admin is distinct from old.is_admin
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.display_name is distinct from old.display_name
       or new.name_confirmed_at is distinct from old.name_confirmed_at
       or new.email is distinct from old.email
       or new.company_id is distinct from old.company_id
       or new.avatar_url is distinct from old.avatar_url
       or new.request_note is distinct from old.request_note
       or new.requested_at is distinct from old.requested_at then
      raise exception '운영지원팀은 부서와 직책·직급만 바꿀 수 있습니다.';
    end if;
    return new;
  end if;

  if operations_decision then
    if new.is_admin is distinct from old.is_admin then
      raise exception '관리자 권한은 운영진만 지정할 수 있습니다.';
    end if;
    if new.email is distinct from old.email then
      raise exception '이메일은 승인 처리에서 바꿀 수 없습니다.';
    end if;
    if new.company_id is distinct from old.company_id
       and new.company_id is distinct from 'e0000000-0000-4000-8000-000000000001'::uuid then
      raise exception '신청 회사가 올바르지 않습니다.';
    end if;
    if old.name_confirmed_at is not null
       and new.name_confirmed_at is null then
      raise exception '본명 확인을 해제할 수 없습니다.';
    end if;
    return new;
  end if;

  raise exception '프로필을 수정할 권한이 없습니다.';
end;
$function$;
