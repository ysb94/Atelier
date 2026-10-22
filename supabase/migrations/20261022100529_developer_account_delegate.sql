-- 사용자 확인: 개발자 계정과 윤설빈은 같은 사람. 로그인/승인/직책/부서는 변경하지 않는다.
do $$
declare source public.profiles%rowtype; target public.profiles%rowtype;
begin
  select * into strict source from public.profiles where id='d0000000-0000-4000-8000-000000000001';
  select * into strict target from public.profiles where id='a5afdd00-4a61-44dc-a1a3-082fa8a1345d';
  if source.email is distinct from 'dev@atelier.local' or source.status <> 'active'
    or source.is_admin is not true or source.position is distinct from '팀장' or source.department_id is null
    or target.display_name is distinct from '윤설빈' or target.status <> 'active' or target.is_admin is not true
    or source.company_id is null or source.company_id is distinct from target.company_id then
    raise exception '기준 개발자 계정과 동일인 계정의 상태·회사 확인에 실패했습니다.';
  end if;

  -- 기준 계정의 현재 legacy 권한과 범위를 그대로 추가. 기존 지정은 삭제/덮어쓰기하지 않는다.
  with requested(permission,scope_kind,scope_id) as (
    select code,'company',source.company_id from unnest(array[
      'basic.use','system.manage','personnel.manage','brand.manage','brand.edit','ai.manage','partner.manage','partner.edit','meeting.manage',
      'data.planning','data.design','data.md','data.logistics','data.data',
      'org.manage','approvers.manage','attendance.manage','notice.company.write','notice.company.delete',
      'preview.use','ideas.read','drafts.read','chat.moderate'
    ]) code
    union all select code,'department',source.department_id from unnest(array['work.manage','notice.department.write','notice.department.delete']) code
    union all select code,'brand',b.brand_id from public.brand_members b cross join unnest(array['brand.edit','ai.manage','partner.manage','partner.edit']) code
      where b.profile_id=source.id and b.is_lead
    union all select permission,scope_kind,scope_id from public.permission_grants where profile_id=source.id and company_id=source.company_id
  ), added as (
    insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id,updated_by)
    select distinct source.company_id,target.id,permission,scope_kind,scope_id,source.id from requested
    on conflict(company_id,profile_id,permission,scope_kind,scope_id) do nothing
    returning *
  )
  insert into public.permission_grant_events(company_id,actor_id,profile_id,permission,scope_kind,scope_id,enabled)
  select company_id,source.id,profile_id,permission,scope_kind,scope_id,true from added;

  insert into public.brand_members(brand_id,profile_id,is_lead)
  select brand_id,target.id,is_lead from public.brand_members where profile_id=source.id
  on conflict(brand_id,profile_id) do update set is_lead=true where excluded.is_lead and not brand_members.is_lead;

  -- 같은 사람의 두 로그인 계정. 일반 직원이 스스로 지정할 수 있는 권한은 열지 않는다.
  alter table public.access_ip_reviewers drop constraint if exists access_ip_reviewers_singleton_key;
  insert into public.access_ip_reviewers(profile_id) values(target.id) on conflict do nothing;
  insert into public.impersonation_operators(profile_id) values(target.id) on conflict do nothing;
end;
$$;

-- 기존 개발자 전용 판정에 승인된 동일인 UUID만 추가한다. 다른 관리자의 권한은 바꾸지 않는다.
create or replace function app.is_dev_login() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and (
    p.id='d0000000-0000-4000-8000-000000000001'::uuid or lower(p.email)='dev@atelier.local'
    or (p.id='a5afdd00-4a61-44dc-a1a3-082fa8a1345d'::uuid and p.company_id='e0000000-0000-4000-8000-000000000001'::uuid)
  ));
$$;
create or replace function app.is_company_manager() returns boolean
language sql stable security definer set search_path='' as $$
  select app.is_dev_login() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.position in ('팀장','이사'));
$$;
create or replace function app.can_edit_org_assignment() returns boolean
language sql stable security definer set search_path='' as $$
  select app.is_dev_login() or exists(select 1 from public.profiles p left join public.departments d on d.id=p.department_id
    where p.id=auth.uid() and p.status='active' and (lower(p.email)='dev@atelier.local' or (d.is_active and d.name='운영지원팀')));
$$;
create or replace function app.mamam_inbox_company_id() returns uuid
language sql stable security definer set search_path='' as $$
  select p.company_id from public.profiles p where p.id=auth.uid() and p.status='active'
    and (app.is_dev_login() or p.position='대표이사') limit 1;
$$;
