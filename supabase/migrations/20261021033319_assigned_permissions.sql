-- 기존 승인자 테이블과 업무 데이터를 유지한다. 운영 적용 전 별도 검토가 필요하다.
create table app.permission_catalog (code text primary key, scope_kinds text[] not null);
create table public.permission_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  profile_id uuid not null references public.profiles(id),
  permission text not null references app.permission_catalog(code),
  scope_kind text not null check (scope_kind in ('company','department','brand','partner','chat_room')),
  scope_id uuid not null,
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
  unique(company_id,profile_id,permission,scope_kind,scope_id)
);
create index permission_grants_lookup on public.permission_grants(profile_id,company_id,permission,scope_kind,scope_id);
create table public.permission_grant_events (
  id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
  actor_id uuid not null references public.profiles(id), profile_id uuid not null references public.profiles(id),
  permission text not null, scope_kind text not null, scope_id uuid not null, enabled boolean not null,
  created_at timestamptz not null default now()
);
alter table public.permission_grants enable row level security;
alter table public.permission_grant_events enable row level security;
revoke all on public.permission_grants, public.permission_grant_events from anon,authenticated;
grant select on public.permission_grants, public.permission_grant_events to authenticated;

create function app.permission_allowed(p_permission text,p_kind text default 'company',p_scope uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.permission_grants g join public.profiles p on p.id=g.profile_id
 where p.id=auth.uid() and p.status='active' and p.company_id=g.company_id and g.permission=p_permission
 and ((g.scope_kind='company' and g.scope_id=p.company_id) or (g.scope_kind=p_kind and p_scope is not null and g.scope_id=p_scope)));
$$;
create function app.any_permission(p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.permission_grants g join public.profiles p on p.id=g.profile_id
 where p.id=auth.uid() and p.status='active' and p.company_id=g.company_id and g.permission=p_permission);
$$;
revoke all on function app.permission_allowed(text,text,uuid),app.any_permission(text) from public,anon;
grant execute on function app.permission_allowed(text,text,uuid),app.any_permission(text) to authenticated;
create function app.permission_company_id() returns uuid language sql stable security definer set search_path='' as $$
 select company_id from public.profiles where id=auth.uid() and status='active';
$$;
revoke all on function app.permission_company_id() from public,anon;
grant execute on function app.permission_company_id() to authenticated;
create policy permission_grant_read on public.permission_grants for select to authenticated using (
 company_id=(select app.permission_company_id())
 and (profile_id=(select auth.uid()) or (select app.permission_allowed('permissions.manage'))));
create policy permission_event_read on public.permission_grant_events for select to authenticated using (
 company_id=(select app.permission_company_id())
 and (select app.permission_allowed('permissions.manage')));

create function app.permission_revision(p_company uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(coalesce(string_agg(g.id::text||g.updated_at::text,',' order by g.id),'')) from public.permission_grants g where g.company_id=p_company;
$$;
revoke all on function app.permission_revision(uuid) from public,anon,authenticated;

create function app.list_my_permission_grants() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'permission',g.permission,'scopeKind',g.scope_kind,'scopeId',g.scope_id,
 'scopeName',case when g.scope_kind='department' then (select d.name from public.departments d where d.id=g.scope_id and d.company_id=p.company_id) else null end)), '[]'::jsonb)
 from public.permission_grants g join public.profiles p on p.id=g.profile_id
 where p.id=auth.uid() and p.status='active' and g.company_id=p.company_id;
$$;
create function public.list_my_permission_grants() returns jsonb language sql stable security invoker set search_path='' as $$ select app.list_my_permission_grants(); $$;

create function app.permission_directory() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid; result jsonb; full_access boolean:=app.permission_allowed('permissions.manage');
begin
 if not full_access and not app.any_permission('partner.manage') then raise exception '권한 지정 관리 권한이 필요합니다.' using errcode='42501'; end if;
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 select jsonb_build_object(
 'canManageAll',full_access,
 'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.display_name,'이름 미등록'),'department',coalesce(d.name,''),'position',coalesce(p.position,''),'status',p.status) order by p.display_name),'[]') from public.profiles p left join public.departments d on d.id=p.department_id and d.company_id=company where p.company_id=company),
 'scopes',(select coalesce(jsonb_agg(s),'[]') from (
 select 'company' as kind,company as id,'회사 전체' as name where full_access
 union all select 'department',d.id,d.name from public.departments d where d.company_id=company and d.is_active and full_access
 union all select 'brand',b.id,b.name from public.brands b where b.company_id=company and full_access
 union all select 'partner',t.id,t.name from public.code_usage_targets t join public.brands b on b.id=t.brand_id where b.company_id=company and (full_access or app.permission_allowed('partner.manage','brand',b.id))
 union all select 'chat_room',r.id,coalesce(r.name,'대화방') from public.chat_rooms r where r.company_id=company and full_access and app.is_chat_room_member(r.id)
 ) s),
 'grants',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'profileId',g.profile_id,'permission',g.permission,'scopeKind',g.scope_kind,'scopeId',g.scope_id,'updatedAt',g.updated_at)),'[]') from public.permission_grants g where g.company_id=company and (full_access or (g.permission='partner.edit' and g.scope_kind='partner' and exists(select 1 from public.code_usage_targets t join public.brands b on b.id=t.brand_id where t.id=g.scope_id and b.company_id=company and app.permission_allowed('partner.manage','brand',b.id))))),
 'events',(select coalesce(jsonb_agg(events order by events.id::bigint desc),'[]') from (select e.id::text as id,coalesce(a.display_name,'직원') as actor,coalesce(p.display_name,'직원') as person,e.permission,e.scope_kind as "scopeKind",e.scope_id as "scopeId",e.enabled,e.created_at as "createdAt" from public.permission_grant_events e join public.profiles a on a.id=e.actor_id join public.profiles p on p.id=e.profile_id where e.company_id=company and (full_access or (e.permission='partner.edit' and e.scope_kind='partner' and exists(select 1 from public.code_usage_targets t join public.brands b on b.id=t.brand_id where t.id=e.scope_id and b.company_id=company and app.permission_allowed('partner.manage','brand',b.id)))) order by e.id desc limit 30) events),
 'revision',app.permission_revision(company)) into result;
 return result;
end; $$;
create function public.permission_directory() returns jsonb language sql stable security invoker set search_path='' as $$ select app.permission_directory(); $$;

create function app.set_permission_grant(p_profile uuid,p_permission text,p_scope_kind text,p_scope uuid,p_enabled boolean,p_revision text)
returns void language plpgsql security definer set search_path='' as $$
declare company uuid; valid boolean:=false; changed integer;
begin
 if auth.uid() is null or (not app.permission_allowed('permissions.manage') and not app.any_permission('partner.manage')) then raise exception '권한 지정 관리 권한이 필요합니다.' using errcode='42501'; end if;
 select p.company_id into company from public.profiles p where p.id=auth.uid() and p.status='active';
 perform pg_advisory_xact_lock(hashtextextended(company::text,0));
 if p_revision is distinct from app.permission_revision(company) then raise exception '다른 관리자가 지정 내역을 변경했습니다. 새로 불러온 뒤 확인해 주세요.' using errcode='40001'; end if;
 if not app.permission_allowed('permissions.manage') and not (
  p_permission='partner.edit' and p_scope_kind='partner' and exists(select 1 from public.code_usage_targets t join public.brands b on b.id=t.brand_id where t.id=p_scope and b.company_id=company and app.permission_allowed('partner.manage','brand',b.id))
 ) then raise exception '지정된 업체 범위의 편집 담당자만 변경할 수 있습니다.' using errcode='42501'; end if;
 if p_profile=auth.uid() then raise exception '본인의 권한은 다른 권한 관리 담당자에게 요청해 주세요.' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles p where p.id=p_profile and p.company_id=company and (not p_enabled or p.status='active')) then raise exception '같은 회사의 재직 직원을 선택해 주세요.'; end if;
 if not exists(select 1 from app.permission_catalog c where c.code=p_permission and p_scope_kind=any(c.scope_kinds)) or p_scope is null or p_enabled is null then raise exception '권한과 대상 범위를 확인해 주세요.'; end if;
 case p_scope_kind
 when 'company' then valid:=p_scope=company;
 when 'department' then select exists(select 1 from public.departments d where d.id=p_scope and d.company_id=company and d.is_active) into valid;
 when 'brand' then select exists(select 1 from public.brands b where b.id=p_scope and b.company_id=company) into valid;
 when 'partner' then select exists(select 1 from public.code_usage_targets t join public.brands b on b.id=t.brand_id where t.id=p_scope and b.company_id=company) into valid;
 when 'chat_room' then select exists(select 1 from public.chat_rooms r where r.id=p_scope and r.company_id=company and app.is_chat_room_member(r.id)) into valid;
 else valid:=false;
 end case;
 -- 비활성·삭제된 대상의 오래된 지정도 정확한 한 건으로 회수할 수 있다.
 if not p_enabled and exists(select 1 from public.permission_grants g where g.company_id=company and g.profile_id=p_profile and g.permission=p_permission and g.scope_kind=p_scope_kind and g.scope_id=p_scope) then valid:=true; end if;
 if not valid then raise exception '같은 회사의 허용된 대상을 선택해 주세요.' using errcode='42501'; end if;
 if not p_enabled and p_permission='permissions.manage' and not exists(select 1 from public.permission_grants g join public.profiles p on p.id=g.profile_id where g.company_id=company and g.permission='permissions.manage' and g.profile_id<>p_profile and p.status='active') then raise exception '다른 권한 관리 담당자를 먼저 지정해 주세요.'; end if;
 if p_enabled then
  insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id,updated_by) values(company,p_profile,p_permission,p_scope_kind,p_scope,auth.uid()) on conflict do nothing;
 else
  delete from public.permission_grants g where g.company_id=company and g.profile_id=p_profile and g.permission=p_permission and g.scope_kind=p_scope_kind and g.scope_id=p_scope;
 end if;
 get diagnostics changed=row_count;
 if changed>0 then insert into public.permission_grant_events(company_id,actor_id,profile_id,permission,scope_kind,scope_id,enabled) values(company,auth.uid(),p_profile,p_permission,p_scope_kind,p_scope,p_enabled); end if;
end; $$;
create function public.set_permission_grant(p_profile uuid,p_permission text,p_scope_kind text,p_scope uuid,p_enabled boolean,p_revision text)
returns void language sql security invoker set search_path='' as $$ select app.set_permission_grant(p_profile,p_permission,p_scope_kind,p_scope,p_enabled,p_revision); $$;
revoke all on function app.list_my_permission_grants(),app.permission_directory(),app.set_permission_grant(uuid,text,text,uuid,boolean,text) from public,anon;
revoke all on function public.list_my_permission_grants(),public.permission_directory(),public.set_permission_grant(uuid,text,text,uuid,boolean,text) from public,anon;
grant execute on function app.list_my_permission_grants(),app.permission_directory(),app.set_permission_grant(uuid,text,text,uuid,boolean,text) to authenticated;
grant execute on function public.list_my_permission_grants(),public.permission_directory(),public.set_permission_grant(uuid,text,text,uuid,boolean,text) to authenticated;

insert into app.permission_catalog(code,scope_kinds) values
('basic.use',array['company']),
('attendance.exempt',array['company']),
('permissions.manage',array['company']),
('approvers.manage',array['company']),
('work.manage',array['company','department']),
('drafts.read',array['company']),
('data.planning',array['company','brand']),
('data.design',array['company','brand']),
('data.md',array['company','brand']),
('data.logistics',array['company','brand']),
('data.data',array['company','brand']),
('attendance.manage',array['company','department']),
('personnel.manage',array['company']),
('org.manage',array['company']),
('notice.company.write',array['company']),
('notice.company.delete',array['company']),
('notice.department.write',array['company','department']),
('notice.department.delete',array['company','department']),
('partner.edit',array['company','brand','partner']),
('partner.manage',array['company','brand']),
('brand.edit',array['company','brand']),
('brand.manage',array['company']),
('ai.manage',array['company','brand']),
('chat.moderate',array['company','chat_room']),
('meeting.manage',array['company']),
('company.review',array['company']),
('ideas.read',array['company']),
('preview.use',array['company']),
('system.manage',array['company']);

-- 직책·부서 예외를 일회성 개인 지정으로 이전한다. 이후 프로필 변경으로 권한이 생기지 않는다.
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,'basic.use','company',p.company_id from public.profiles p where p.status='active' and p.company_id is not null;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,c.code,'company',p.company_id from public.profiles p cross join app.permission_catalog c
where p.status='active' and p.company_id is not null and p.is_admin
and c.code in ('permissions.manage','system.manage','personnel.manage','brand.manage','brand.edit','ai.manage','partner.manage','partner.edit','meeting.manage','data.planning','data.design','data.md','data.logistics','data.data') on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,'data.'||pc.capability,'company',p.company_id from public.profiles p join public.profile_capabilities pc on pc.profile_id=p.id
where p.status='active' and p.company_id is not null on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,c.code,'company',p.company_id from public.profiles p join public.departments d on d.id=p.department_id cross join (values('org.manage'),('approvers.manage'),('attendance.manage'),('notice.company.write'),('notice.company.delete')) c(code)
where p.status='active' and d.is_active and d.name='운영지원팀' on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,c.code,'company',p.company_id from public.profiles p cross join (values('org.manage'),('approvers.manage'),('attendance.manage'),('notice.company.write'),('notice.company.delete'),('preview.use'),('ideas.read')) c(code)
where p.status='active' and p.company_id is not null and lower(p.email)='dev@atelier.local' on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,'personnel.manage','company',p.company_id from public.profiles p join public.departments d on d.id=p.department_id
where p.status='active' and d.is_active and (d.personnel_scope='members' or d.personnel_scope='leaders' and p.position in ('팀장','이사')) on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,c.code,'company',p.company_id from public.profiles p cross join (values('company.review'),('preview.use'),('ideas.read'),('drafts.read')) c(code)
where p.status='active' and p.company_id is not null and p.position='대표이사' on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,'attendance.exempt','company',p.company_id from public.profiles p where p.status='active' and p.company_id is not null and p.position in ('대표이사','부사장','전무','상무','이사') on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,c.code,'company',p.company_id from public.profiles p cross join (values('drafts.read'),('chat.moderate')) c(code)
where p.status='active' and p.company_id is not null and p.position in ('팀장','이사') on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,c.code,'department',p.department_id from public.profiles p cross join (values('work.manage'),('notice.department.write'),('notice.department.delete')) c(code)
where p.status='active' and p.company_id is not null and p.department_id is not null and p.position in ('팀장','이사') on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,'work.manage','department',p.department_id from public.profiles p where p.status='active' and p.department_id is not null and p.is_admin on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,c.code,'brand',bm.brand_id from public.profiles p join public.brand_members bm on bm.profile_id=p.id join public.brands b on b.id=bm.brand_id and b.company_id=p.company_id cross join (values('brand.edit'),('ai.manage'),('partner.manage'),('partner.edit')) c(code)
where p.status='active' and bm.is_lead on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select p.company_id,p.id,'partner.edit','partner',e.usage_target_id from public.usage_partner_editors e join public.profiles p on p.id=e.profile_id join public.brands b on b.id=e.brand_id and b.company_id=p.company_id where p.status='active' on conflict do nothing;
insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
select a.company_id,p.id,'attendance.manage','department',a.department_id from public.department_request_approvers a join public.profiles p on p.id=a.approver_id or p.id=a.substitute_id where p.status='active' and p.company_id=a.company_id on conflict do nothing;
-- 기존 승인자·대체 승인자 행을 수정하거나 삭제하지 않는다.
do $$ begin
 if exists(select 1 from public.profiles p where p.status='active' and p.company_id is not null
   and not exists(select 1 from public.permission_grants g join public.profiles manager on manager.id=g.profile_id
     where g.company_id=p.company_id and g.permission='permissions.manage' and manager.status='active')) then
  raise exception '권한 관리 담당자를 이관할 수 없는 회사가 있습니다. 적용 전에 담당자를 확인해 주세요.';
 end if;
end $$;

create or replace function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select app.permission_allowed('system.manage'); $$;

create or replace function app.is_brand_lead(target_brand_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.permission_allowed('brand.edit','brand',target_brand_id); $$;

create or replace function app.is_company_manager() returns boolean language sql stable security definer set search_path='' as $$ select app.any_permission('work.manage'); $$;

create or replace function app.can_manage_personnel() returns boolean language sql stable security definer set search_path='' as $$ select app.permission_allowed('personnel.manage'); $$;

create or replace function app.can_edit_org_assignment() returns boolean language sql stable security definer set search_path='' as $$ select app.permission_allowed('org.manage'); $$;

create or replace function app.can_view_members() returns boolean language sql stable security definer set search_path='' as $$ select app.any_permission('work.manage') or app.permission_allowed('personnel.manage') or app.permission_allowed('org.manage') or app.permission_allowed('approvers.manage') or app.permission_allowed('permissions.manage'); $$;

create or replace function app.has_capability(target_capability text) returns boolean language sql stable security definer set search_path='' as $$ select app.any_permission('data.'||target_capability); $$;

create or replace function app.has_any_capability() returns boolean language sql stable security definer set search_path='' as $$ select app.has_capability('planning') or app.has_capability('design') or app.has_capability('md') or app.has_capability('logistics') or app.has_capability('data'); $$;

create or replace function app.can_read_brand(target_brand_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.permission_allowed('basic.use') and exists(select 1 from public.brands b join public.profiles p on p.company_id=b.company_id where b.id=target_brand_id and p.id=auth.uid() and p.status='active'); $$;

create or replace function app.can_read_company(target_company_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.permission_allowed('basic.use') and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.company_id=target_company_id); $$;

create or replace function app.can_edit_brand(target_brand_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.can_read_brand(target_brand_id) and exists(select 1 from app.permission_catalog c where c.code like 'data.%' and app.permission_allowed(c.code,'brand',target_brand_id)); $$;

create or replace function app.can_edit_company(target_company_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.can_read_company(target_company_id) and app.has_any_capability(); $$;

create or replace function app.can_set_department_attendance(p_company uuid,p_department uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.can_read_company(p_company) and app.permission_allowed('attendance.manage','department',p_department); $$;

create or replace function app.company_review_company_id() returns uuid language sql stable security definer set search_path='' as $$ select p.company_id from public.profiles p where p.id=auth.uid() and p.status='active' and app.permission_allowed('company.review'); $$;

create or replace function app.mamam_inbox_company_id() returns uuid language sql stable security definer set search_path='' as $$ select p.company_id from public.profiles p where p.id=auth.uid() and p.status='active' and app.permission_allowed('ideas.read'); $$;

create or replace function app.can_moderate_chat(target_room_id uuid,target_author_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.is_chat_room_member(target_room_id) and (target_author_id=auth.uid() or app.permission_allowed('chat.moderate','chat_room',target_room_id)); $$;

create or replace function app.usage_partner_can_manage(p_brand_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.usage_partner_can_read(p_brand_id) and app.permission_allowed('partner.manage','brand',p_brand_id); $$;

create or replace function app.usage_partner_can_edit(p_brand_id uuid,p_target_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app.usage_partner_can_read(p_brand_id) and exists(select 1 from public.code_usage_targets t where t.id=p_target_id and t.brand_id=p_brand_id) and (app.permission_allowed('partner.edit','partner',p_target_id) or app.permission_allowed('partner.edit','brand',p_brand_id)); $$;

CREATE OR REPLACE FUNCTION app.guard_department_request_approvers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles%rowtype; candidate uuid;
begin
  if auth.uid() is null or not app.permission_allowed('approvers.manage') then raise exception '승인자 지정 권한이 필요합니다.'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active';
  if actor.company_id is null or new.company_id is distinct from actor.company_id then raise exception '같은 회사의 승인자만 설정할 수 있습니다.'; end if;
  if TG_OP='UPDATE' and row(new.company_id,new.department_id,new.request_type) is distinct from row(old.company_id,old.department_id,old.request_type) then raise exception '승인자 설정의 부서·종류는 변경할 수 없습니다.'; end if;
  if not exists(select 1 from public.departments where id=new.department_id and company_id=actor.company_id and is_active) then raise exception '활성 부서를 선택해 주세요.'; end if;
  foreach candidate in array array[new.approver_id,new.substitute_id] loop
    if candidate is not null and not exists(select 1 from public.profiles where id=candidate and company_id=actor.company_id and status='active') then raise exception '같은 회사의 재직 직원만 승인자로 지정할 수 있습니다.'; end if;
  end loop;
  new.updated_by:=actor.id; new.updated_at:=now();
  return new;
end;
$function$
;

do $$ declare pol record; begin for pol in select * from pg_policies where schemaname='public' and tablename='department_request_approvers' loop
 if pol.cmd<>'SELECT' then execute format('alter policy %I on public.department_request_approvers %s %s',pol.policyname,
 case when pol.qual is not null then 'using ('||replace(pol.qual,'app.can_edit_org_assignment()', 'app.permission_allowed(''approvers.manage'')')||')' else '' end,
 case when pol.with_check is not null then 'with check ('||replace(pol.with_check,'app.can_edit_org_assignment()', 'app.permission_allowed(''approvers.manage'')')||')' else '' end); end if; end loop; end $$;
-- 공지의 저장·삭제는 원래 대상과 변경할 대상 모두의 지정 권한을 확인한다.
create function app.can_write_notice(p_slot text,p_department uuid,p_delete boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select case when p_slot='department' then app.permission_allowed(case when p_delete then 'notice.department.delete' else 'notice.department.write' end,'department',p_department)
 else app.permission_allowed(case when p_delete then 'notice.company.delete' else 'notice.company.write' end) end;
$$;
revoke all on function app.can_write_notice(text,uuid,boolean) from public,anon;
grant execute on function app.can_write_notice(text,uuid,boolean) to authenticated;
create or replace function app.save_company_notice(p_id uuid,p_slot text,p_department_id uuid,p_title text,p_body text,p_starts date,p_ends date,p_published boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare company uuid; audience uuid:=p_department_id; saved uuid; original public.company_notices%rowtype;
begin
 select p.company_id into company from public.profiles p where p.id=auth.uid() and p.status='active';
 if company is null then raise exception '회사 소속을 확인해 주세요.' using errcode='42501'; end if;
 if p_slot not in ('company','department','my-attendance') or p_slot is null then raise exception '게시 위치를 확인해 주세요.'; end if;
 if p_slot='company' then audience:=null; end if;
 if p_slot='department' and audience is null then raise exception '대상 부서를 선택해 주세요.'; end if;
 if not app.can_write_notice(p_slot,audience) then raise exception '해당 공지의 작성·수정 권한이 필요합니다.' using errcode='42501'; end if;
 if p_id is not null then
  select * into original from public.company_notices n where n.id=p_id and n.company_id=company for update;
  if not found then raise exception '수정할 공지를 찾지 못했습니다.'; end if;
  if not app.can_write_notice(original.slot,original.department_id) then raise exception '원래 공지의 수정 권한이 필요합니다.' using errcode='42501'; end if;
 end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then raise exception '제목은 1자에서 80자까지 입력해 주세요.'; end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then raise exception '내용은 1자에서 4000자까지 입력해 주세요.'; end if;
 if p_starts is not null and p_ends is not null and p_ends<p_starts then raise exception '종료일은 시작일보다 빠를 수 없습니다.'; end if;
 if audience is not null and not exists(select 1 from public.departments d where d.id=audience and d.company_id=company and d.is_active) then raise exception '같은 회사의 사용 중인 부서를 선택해 주세요.'; end if;
 if p_id is null then
  insert into public.company_notices(company_id,slot,department_id,title,body,starts_on,ends_on,published,updated_by) values(company,p_slot,audience,btrim(p_title),btrim(p_body),p_starts,p_ends,coalesce(p_published,true),auth.uid()) returning id into saved;
 else
  update public.company_notices set slot=p_slot,department_id=audience,title=btrim(p_title),body=btrim(p_body),starts_on=p_starts,ends_on=p_ends,published=coalesce(p_published,true),updated_by=auth.uid(),updated_at=now() where id=p_id and company_id=company returning id into saved;
 end if;
 return saved;
end; $$;
create or replace function app.delete_company_notice(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare company uuid; original public.company_notices%rowtype;
begin
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 select * into original from public.company_notices where id=p_id and company_id=company for update;
 if not found then raise exception '삭제할 공지를 찾지 못했습니다.'; end if;
 if not app.can_write_notice(original.slot,original.department_id,true) then raise exception '해당 공지의 삭제 권한이 필요합니다.' using errcode='42501'; end if;
 delete from public.company_notices where id=p_id and company_id=company;
end; $$;
drop policy if exists company_notice_read on public.company_notices;
create policy company_notice_read on public.company_notices for select to authenticated using (
 company_id=(select app.permission_company_id()) and (
 app.can_write_notice(slot,department_id) or app.can_write_notice(slot,department_id,true)
 or (published and (starts_on is null or starts_on<=(timezone('Asia/Seoul',now()))::date) and (ends_on is null or ends_on>=(timezone('Asia/Seoul',now()))::date)
 and (department_id is null or department_id=(select p.department_id from public.profiles p where p.id=auth.uid())))
 ));

-- 기존 시스템 관리자 조건으로 다른 업무 권한을 우회하지 못하게 기능별 정책을 사용한다.
do $$ declare pol record; begin
 for pol in select * from pg_policies where schemaname='public' and tablename in ('brands','departments','ai_feature_routes') and cmd<>'SELECT' loop
  execute format('drop policy %I on public.%I',pol.policyname,pol.tablename);
 end loop;
end $$;
create policy assigned_brand_insert on public.brands for insert to authenticated with check (
 app.permission_allowed('brand.manage') and company_id=(select app.permission_company_id()));
create policy assigned_brand_update on public.brands for update to authenticated using (app.can_read_brand(id) and app.permission_allowed('brand.edit','brand',id)) with check(app.can_read_brand(id) and app.permission_allowed('brand.edit','brand',id));
create policy assigned_brand_delete on public.brands for delete to authenticated using (app.permission_allowed('brand.manage') and company_id=(select app.permission_company_id()));
create policy assigned_department_write on public.departments for all to authenticated using(app.permission_allowed('org.manage') and company_id=(select app.permission_company_id())) with check(app.permission_allowed('org.manage') and company_id=(select app.permission_company_id()));
create policy assigned_ai_write on public.ai_feature_routes for all to authenticated using(app.can_read_brand(brand_id) and app.permission_allowed('ai.manage','brand',brand_id)) with check(app.can_read_brand(brand_id) and app.permission_allowed('ai.manage','brand',brand_id));
create policy assigned_profile_update on public.profiles as restrictive for update to authenticated using(
 id=auth.uid() or (company_id=(select app.permission_company_id()) and (app.permission_allowed('personnel.manage') or app.permission_allowed('org.manage')))) with check(
 id=auth.uid() or (company_id=(select app.permission_company_id()) and (app.permission_allowed('personnel.manage') or app.permission_allowed('org.manage'))));
revoke all on app.permission_catalog from public,anon,authenticated;


CREATE OR REPLACE FUNCTION app.save_attendance_start_settings(p_month date, p_until date, p_department_id uuid, p_employee_id uuid, p_start time without time zone, p_grace integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); company uuid; target_department uuid; target_month date; inherited_time time; inherited_grace integer; count_months integer:=0;
begin
  if actor is null then raise exception '이 부서의 출근시간 설정 권한이 필요합니다.'; end if;
  select company_id into company from public.profiles where id=actor and status='active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_month is null or p_until is null or extract(day from p_month)<>1 or extract(day from p_until)<>1
    or p_until<p_month or extract(year from p_until)<>extract(year from p_month)
    or p_grace is null or p_grace<0 or p_grace>60 then raise exception '적용 월과 초과 기준을 확인해 주세요.'; end if;
  if p_start is not null and extract(second from p_start)<>0 then raise exception '출근시간은 분 단위로 입력해 주세요.'; end if;
  if p_employee_id is not null then
    select department_id into target_department from public.profiles where id=p_employee_id and company_id=company and status='active';
    if not found then raise exception '같은 회사의 재직 직원만 설정할 수 있습니다.'; end if;
  else
    if p_start is null or not exists(select 1 from public.departments where id=p_department_id and company_id=company and is_active) then raise exception '부서와 출근시간을 확인해 주세요.'; end if;
    target_department:=p_department_id;
  end if;
  if not app.can_set_department_attendance(company, target_department) then
    raise exception '이 부서의 출근시간 설정 권한이 필요합니다.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(company::text||':attendance-start',0));
  for target_month in select d::date from pg_catalog.generate_series(p_month::timestamp,p_until::timestamp,interval '1 month') d loop
    if p_employee_id is null then
      insert into public.attendance_start_settings(company_id,month,department_id,source,start_time,grace_minutes,updated_by)
      values(company,target_month,target_department,'department',p_start,p_grace,actor)
      on conflict(company_id,department_id,month) where employee_id is null do update
      set start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now();
      insert into public.attendance_start_settings(company_id,month,department_id,employee_id,source,start_time,grace_minutes,updated_by)
      select company,target_month,target_department,p.id,'department',p_start,p_grace,actor from public.profiles p
      where p.company_id=company and p.department_id=target_department and p.status='active'
      on conflict(company_id,employee_id,month) where employee_id is not null do update
      set department_id=excluded.department_id,start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now()
      where attendance_start_settings.source='department';
    else
      inherited_time:=null; inherited_grace:=5;
      if p_start is null then
        select start_time,grace_minutes into inherited_time,inherited_grace from public.attendance_start_settings
        where company_id=company and department_id=target_department and month=target_month and employee_id is null;
      end if;
      insert into public.attendance_start_settings(company_id,month,department_id,employee_id,source,start_time,grace_minutes,updated_by)
      values(company,target_month,target_department,p_employee_id,case when p_start is null then 'department' else 'individual' end,
        coalesce(p_start,inherited_time),case when p_start is null then coalesce(inherited_grace,5) else p_grace end,actor)
      on conflict(company_id,employee_id,month) where employee_id is not null do update
      set department_id=excluded.department_id,source=excluded.source,start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now();
    end if;
    count_months:=count_months+1;
  end loop;
  return count_months;
end;
$function$
;

create index permission_events_company_time on public.permission_grant_events(company_id,id desc);
revoke all on function app.save_attendance_start_settings(date,date,uuid,uuid,time,integer) from public,anon;
grant execute on function app.save_attendance_start_settings(date,date,uuid,uuid,time,integer) to authenticated;
-- 근태 집계에서도 직책 이름 대신 명시한 출퇴근 제외 설정을 사용한다.
create function app.list_company_attendance_exempt() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(p.id),'[]') from public.profiles p
 where p.status='active' and app.permission_allowed('basic.use')
 and p.company_id=(select me.company_id from public.profiles me where me.id=auth.uid() and me.status='active')
 and exists(select 1 from public.permission_grants g where g.company_id=p.company_id and g.profile_id=p.id and g.permission='attendance.exempt' and g.scope_kind='company' and g.scope_id=p.company_id);
$$;
create function public.list_company_attendance_exempt() returns jsonb language sql stable security invoker set search_path='' as $$ select app.list_company_attendance_exempt(); $$;
revoke all on function app.list_company_attendance_exempt(),public.list_company_attendance_exempt() from public,anon;
grant execute on function app.list_company_attendance_exempt(),public.list_company_attendance_exempt() to authenticated;


-- 인사 권한도 같은 회사의 다른 직원에만 적용한다. 승인 단계·본명·직책 검증은 기존 트리거를 유지한다.
create or replace function app.can_approve(target_profile_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select target_profile_id<>auth.uid() and app.permission_allowed('personnel.manage')
 and exists(select 1 from public.profiles p where p.id=target_profile_id and p.company_id=app.permission_company_id());
$$;
CREATE OR REPLACE FUNCTION app.guard_profile_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_is_admin boolean;
  actor_can_approve boolean;
  self_access_request boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- 기존 is_admin 값은 이관 기록이다. 권한을 생성하거나 우회하지 않는다.
  actor_is_admin := false;
  if new.is_admin is distinct from old.is_admin then
    raise exception '권한은 권한·담당자 설정에서 지정해 주세요.';
  end if;
  if old.status='active' and new.company_id is distinct from old.company_id then
    raise exception '재직 직원의 회사는 이 화면에서 변경할 수 없습니다.';
  end if;
  if old.status='active' and new.status is distinct from 'active'
     and exists(select 1 from public.permission_grants g where g.profile_id=old.id and g.company_id=old.company_id and g.permission='permissions.manage')
     and not exists(select 1 from public.permission_grants g join public.profiles p on p.id=g.profile_id where g.company_id=old.company_id and g.permission='permissions.manage' and p.id<>old.id and p.status='active') then
    raise exception '다른 권한 관리 담당자를 지정한 뒤 계정을 정지해 주세요.';
  end if;

  self_access_request := auth.uid() = old.id
    and old.status in ('pending', 'rejected')
    and new.status = 'pending';

  if new.department_id is distinct from old.department_id
     or new.position is distinct from old.position
     or new.job_grade is distinct from old.job_grade then
    if not app.can_edit_org_assignment()
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
      raise exception '부서와 직책·직급은 조직 관리 담당자만 바꿀 수 있습니다.';
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
    if not app.can_edit_org_assignment() and not app.can_approve(old.id) then
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
      raise exception '조직 관리 담당자는 부서와 직책·직급만 바꿀 수 있습니다.';
    end if;
    return new;
  end if;

  raise exception '프로필을 수정할 권한이 없습니다.';
end;
$function$;

-- 가입 승인 시 기본 이용만 지정한다. 업무 편집·관리 권한은 따로 지정해야 한다.
create function app.provision_basic_permission() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='active' and new.company_id is not null then
  insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id)
  values(new.company_id,new.id,'basic.use','company',new.company_id) on conflict do nothing;
 end if;
 return new;
end; $$;
revoke all on function app.provision_basic_permission() from public,anon,authenticated;
create trigger provision_basic_permission after insert or update of status on public.profiles for each row execute function app.provision_basic_permission();
-- 예전 업체 지정 API로 별도의 권한 목록이 생기지 않게 한다. 원래 지정 행은 이관 기록으로 보존한다.
create or replace function public.save_usage_partner_editors(p_brand_id uuid,p_target_id uuid,p_profile_ids uuid[])
returns void language plpgsql security invoker set search_path='' as $$
begin raise exception '업체 담당자는 권한·담당자 설정에서 지정해 주세요.' using errcode='42501'; end; $$;

create function app.get_assigned_usage_partner_access(p_brand_id uuid,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not app.can_read_brand(p_brand_id) or not exists(select 1 from public.code_usage_targets where brand_id=p_brand_id and id=p_target_id) then
  raise exception '업체 정보를 조회할 권한이 없습니다.' using errcode='42501';
 end if;
 return jsonb_build_object('canRead',true,'canEdit',app.usage_partner_can_edit(p_brand_id,p_target_id),
 'canManage',app.usage_partner_can_manage(p_brand_id),'editorIds',coalesce((select jsonb_agg(distinct g.profile_id) from public.permission_grants g join public.profiles p on p.id=g.profile_id
 where g.company_id=p.company_id and p.status='active' and p.company_id=app.permission_company_id() and g.permission='partner.edit'
 and ((g.scope_kind='company' and g.scope_id=p.company_id) or (g.scope_kind='brand' and g.scope_id=p_brand_id) or (g.scope_kind='partner' and g.scope_id=p_target_id))),'[]'::jsonb));
end; $$;
create or replace function public.get_usage_partner_access(p_brand_id uuid,p_target_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select app.get_assigned_usage_partner_access(p_brand_id,p_target_id); $$;
revoke all on function app.get_assigned_usage_partner_access(uuid,uuid),public.get_usage_partner_access(uuid,uuid) from public,anon;
grant execute on function app.get_assigned_usage_partner_access(uuid,uuid),public.get_usage_partner_access(uuid,uuid) to authenticated;

-- 공개 래퍼는 호출자의 인증을 그대로 전달하고 권한 검사는 비공개 함수에서 수행한다.
create or replace function public.save_company_notice(p_id uuid,p_slot text,p_department_id uuid,p_title text,p_body text,p_starts date,p_ends date,p_published boolean)
returns uuid language sql security invoker set search_path='' as $$ select app.save_company_notice(p_id,p_slot,p_department_id,p_title,p_body,p_starts,p_ends,p_published); $$;
create or replace function public.delete_company_notice(p_id uuid) returns void language sql security invoker set search_path='' as $$ select app.delete_company_notice(p_id); $$;
revoke all on function app.save_company_notice(uuid,text,uuid,text,text,date,date,boolean),app.delete_company_notice(uuid),public.save_company_notice(uuid,text,uuid,text,text,date,date,boolean),public.delete_company_notice(uuid) from public,anon;
grant execute on function app.save_company_notice(uuid,text,uuid,text,text,date,date,boolean),app.delete_company_notice(uuid),public.save_company_notice(uuid,text,uuid,text,text,date,date,boolean),public.delete_company_notice(uuid) to authenticated;

-- 과거 전역 관리자/멤버 조회 정책이 남아 있어도 회사 경계를 넘어가지 않는다.
create policy assigned_profile_company_read on public.profiles as restrictive for select to authenticated
using(id=(select auth.uid()) or company_id=(select app.permission_company_id()));
create policy assigned_approver_company on public.department_request_approvers as restrictive for all to authenticated
using(company_id=(select app.permission_company_id())) with check(company_id=(select app.permission_company_id()));
