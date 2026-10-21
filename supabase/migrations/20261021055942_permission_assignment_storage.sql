-- 담당자 지정·저장·해제만 추가한다. 기존 함수·RLS·트리거·사용자·승인자 원본은 변경하지 않는다.
-- 운영 DB 적용: 2026-10-21. 실제 마이그레이션 버전과 파일명을 일치시킨다.
-- 새 지정이 실제 업무 권한에 적용되는 전환은 별도 승인 뒤 수행한다.
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

-- 저장 화면의 관리 권한만 검사한다. 기존 업무 권한 함수는 교체하지 않는다.
create function app.assignment_manager() returns boolean language sql stable security definer set search_path='' as $$
 select app.is_admin() or app.permission_allowed('permissions.manage');
$$;
create function app.assignment_partner_manager(p_brand uuid) returns boolean language sql stable security definer set search_path='' as $$
 select app.usage_partner_can_manage(p_brand) or app.permission_allowed('partner.manage','brand',p_brand);
$$;
create function app.assignment_has_partner_management() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.brands b where b.company_id=app.permission_company_id() and app.assignment_partner_manager(b.id));
$$;
revoke all on function app.assignment_manager(),app.assignment_partner_manager(uuid),app.assignment_has_partner_management() from public,anon;
grant execute on function app.assignment_manager(),app.assignment_partner_manager(uuid),app.assignment_has_partner_management() to authenticated;

create policy permission_grant_read on public.permission_grants for select to authenticated using (
 company_id=(select app.permission_company_id())
 and (profile_id=(select auth.uid()) or (select app.assignment_manager())));
create policy permission_event_read on public.permission_grant_events for select to authenticated using (
 company_id=(select app.permission_company_id())
 and (select app.assignment_manager()));

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
declare company uuid; result jsonb; full_access boolean:=app.assignment_manager();
begin
 if not full_access and not app.assignment_has_partner_management() then raise exception '권한 지정 관리 권한이 필요합니다.' using errcode='42501'; end if;
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 select jsonb_build_object(
 'canManageAll',full_access,
 'activation','pending',
 'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.display_name,'이름 미등록'),'department',coalesce(d.name,''),'position',coalesce(p.position,''),'status',p.status) order by p.display_name),'[]') from public.profiles p left join public.departments d on d.id=p.department_id and d.company_id=company where p.company_id=company),
 'scopes',(select coalesce(jsonb_agg(s),'[]') from (
 select 'company' as kind,company as id,'회사 전체' as name where full_access
 union all select 'department',d.id,d.name from public.departments d where d.company_id=company and d.is_active and full_access
 union all select 'brand',b.id,b.name from public.brands b where b.company_id=company and full_access
 union all select 'partner',t.id,t.name from public.code_usage_targets t join public.brands b on b.id=t.brand_id where b.company_id=company and (full_access or app.assignment_partner_manager(b.id))
 union all select 'chat_room',r.id,coalesce(r.name,'대화방') from public.chat_rooms r where r.company_id=company and full_access and app.is_chat_room_member(r.id)
 ) s),
 'grants',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'profileId',g.profile_id,'permission',g.permission,'scopeKind',g.scope_kind,'scopeId',g.scope_id,'updatedAt',g.updated_at)),'[]') from public.permission_grants g where g.company_id=company and (full_access or (g.permission='partner.edit' and g.scope_kind='partner' and exists(select 1 from public.code_usage_targets t join public.brands b on b.id=t.brand_id where t.id=g.scope_id and b.company_id=company and app.assignment_partner_manager(b.id))))),
 'events',(select coalesce(jsonb_agg(events order by events.id::bigint desc),'[]') from (select e.id::text as id,coalesce(a.display_name,'직원') as actor,coalesce(p.display_name,'직원') as person,e.permission,e.scope_kind as "scopeKind",e.scope_id as "scopeId",e.enabled,e.created_at as "createdAt" from public.permission_grant_events e join public.profiles a on a.id=e.actor_id join public.profiles p on p.id=e.profile_id where e.company_id=company and (full_access or (e.permission='partner.edit' and e.scope_kind='partner' and exists(select 1 from public.code_usage_targets t join public.brands b on b.id=t.brand_id where t.id=e.scope_id and b.company_id=company and app.assignment_partner_manager(b.id)))) order by e.id desc limit 30) events),
 'revision',app.permission_revision(company)) into result;
 return result;
end; $$;
create function public.permission_directory() returns jsonb language sql stable security invoker set search_path='' as $$ select app.permission_directory(); $$;

create function app.set_permission_grant(p_profile uuid,p_permission text,p_scope_kind text,p_scope uuid,p_enabled boolean,p_revision text)
returns void language plpgsql security definer set search_path='' as $$
declare company uuid; valid boolean:=false; changed integer;
begin
 if auth.uid() is null or (not app.assignment_manager() and not app.assignment_has_partner_management()) then raise exception '권한 지정 관리 권한이 필요합니다.' using errcode='42501'; end if;
 select p.company_id into company from public.profiles p where p.id=auth.uid() and p.status='active';
 perform pg_advisory_xact_lock(hashtextextended(company::text,0));
 if p_revision is distinct from app.permission_revision(company) then raise exception '다른 관리자가 지정 내역을 변경했습니다. 새로 불러온 뒤 확인해 주세요.' using errcode='40001'; end if;
 if not app.assignment_manager() and not (
  p_permission='partner.edit' and p_scope_kind='partner' and exists(select 1 from public.code_usage_targets t join public.brands b on b.id=t.brand_id where t.id=p_scope and b.company_id=company and app.assignment_partner_manager(b.id))
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
 if not p_enabled and p_permission='permissions.manage' and not exists(select 1 from public.profiles p where p.company_id=company and p.status='active' and p.is_admin and p.id<>p_profile) and not exists(select 1 from public.permission_grants g join public.profiles p on p.id=g.profile_id where g.company_id=company and g.permission='permissions.manage' and g.profile_id<>p_profile and p.status='active') then raise exception '다른 권한 관리 담당자를 먼저 지정해 주세요.'; end if;
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
revoke all on app.permission_catalog from public,anon,authenticated;
