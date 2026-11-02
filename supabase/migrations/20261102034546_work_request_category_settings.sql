-- Company-level Visual request forms; existing request ownership and workflow stay unchanged.
create table public.work_request_settings (
 company_id uuid not null references public.companies(id),
 owner text not null check(owner='design'), categories jsonb not null check(jsonb_typeof(categories)='array'),
 revision bigint not null default 1, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
 primary key(company_id,owner)
);
alter table public.work_request_settings enable row level security;
revoke all on public.work_request_settings from public,anon,authenticated;
grant select on public.work_request_settings to authenticated;
create policy work_request_settings_read on public.work_request_settings for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active' and p.company_id=work_request_settings.company_id));

insert into public.work_request_settings(company_id,owner,categories) select id,'design',$default_seed$[{"id":"image","label":"이미지 작업","enabled":true,"assigneeId":"","fields":[]},{"id":"video","label":"영상","enabled":true,"assigneeId":"","fields":[]},{"id":"banner","label":"배너","enabled":true,"assigneeId":"","fields":[{"id":"field-1","label":"배너 용도","type":"text","required":false,"placeholder":""},{"id":"field-2","label":"적용 채널","type":"text","required":false,"placeholder":""},{"id":"field-3","label":"메인 타이틀","type":"text","required":false,"placeholder":""},{"id":"field-4","label":"서브 문구 및 혜택","type":"text","required":false,"placeholder":""},{"id":"field-5","label":"적용 기간","type":"text","required":false,"placeholder":""},{"id":"field-6","label":"이미지 사이즈 / 비율","type":"text","required":false,"placeholder":""},{"id":"field-7","label":"제품 및 참고 자료","type":"text","required":false,"placeholder":""}]},{"id":"revision","label":"수정 요청","enabled":true,"assigneeId":"","fields":[]},{"id":"promotion","label":"프로모션","enabled":true,"assigneeId":"","fields":[]},{"id":"print","label":"인쇄","enabled":true,"assigneeId":"","fields":[]},{"id":"advertising","label":"광고 소재","enabled":true,"assigneeId":"","fields":[{"id":"field-1","label":"광고 채널","type":"text","required":false,"placeholder":""},{"id":"field-2","label":"광고 유형 / 노출 위치","type":"text","required":false,"placeholder":""},{"id":"field-3","label":"광고 목적 / 대상 제품","type":"text","required":false,"placeholder":""},{"id":"field-4","label":"메인 타이틀","type":"text","required":false,"placeholder":""},{"id":"field-5","label":"서브 문구 및 혜택","type":"text","required":false,"placeholder":""},{"id":"field-6","label":"진행 기간","type":"text","required":false,"placeholder":""},{"id":"field-7","label":"이미지 사이즈 / 비율","type":"text","required":false,"placeholder":""},{"id":"field-8","label":"제품 및 참고 자료","type":"text","required":false,"placeholder":""}]},{"id":"sns","label":"SNS","enabled":true,"assigneeId":"","fields":[]},{"id":"detail1","label":"상세(1)","enabled":true,"assigneeId":"","fields":[]},{"id":"detail2","label":"상세(2)","enabled":true,"assigneeId":"","fields":[]},{"id":"detail3","label":"상세(3)","enabled":true,"assigneeId":"","fields":[]}]$default_seed$::jsonb from public.companies;

create function app.get_work_request_settings(p_owner text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare company uuid; row public.work_request_settings%rowtype;
begin
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 if company is null or p_owner is distinct from 'design' then raise exception '설정 조회 권한이 없습니다.' using errcode='42501'; end if;
 select * into row from public.work_request_settings where company_id=company and owner=p_owner;
 return jsonb_build_object('revision',coalesce(row.revision,0),'categories',coalesce(row.categories,'[]'::jsonb),'canManage',app.work_manage_allowed(p_owner));
end $$;

create function app.save_work_request_settings(p_owner text,p_revision bigint,p_categories jsonb) returns bigint
 language plpgsql security definer set search_path='' as $$
declare company uuid; current_revision bigint; category jsonb; field jsonb; person uuid;
begin
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 if company is null or p_owner is distinct from 'design' or not app.work_manage_allowed(p_owner) then raise exception '기존 Visual 업무 관리 담당자만 설정할 수 있습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('work-request-settings:'||company::text,0));
 select revision into current_revision from public.work_request_settings where company_id=company and owner=p_owner for update;
 if p_revision is distinct from coalesce(current_revision,0) then raise exception '다른 관리자가 설정을 변경했습니다. 다시 불러온 뒤 저장하세요.' using errcode='40001'; end if;
 if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_array_length(p_categories)>40 or octet_length(p_categories::text)>262144 then raise exception '분류 설정 형식을 확인하세요.'; end if;
 if exists(select 1 from jsonb_array_elements(p_categories) c group by c->>'id' having count(*)>1)
 or exists(select 1 from jsonb_array_elements(p_categories) c group by trim(c->>'label') having count(*)>1) then raise exception '분류 ID 또는 이름이 중복됩니다.'; end if;
 for category in select * from jsonb_array_elements(p_categories) loop
  if jsonb_typeof(category) is distinct from 'object' or coalesce(category->>'id','') !~ '^[a-zA-Z0-9_-]{1,64}$' or category->>'id'='main'
  or jsonb_typeof(category->'label') is distinct from 'string' or length(trim(category->>'label')) not between 1 and 80
  or jsonb_typeof(category->'enabled') is distinct from 'boolean' or jsonb_typeof(category->'assigneeId') is distinct from 'string'
  or jsonb_typeof(category->'fields') is distinct from 'array' or jsonb_array_length(category->'fields')>30 then raise exception '분류 이름·표시 여부·입력 항목을 확인하세요.'; end if;
  person:=nullif(category->>'assigneeId','')::uuid;
  if person is not null and not exists(select 1 from public.profiles p where p.id=person and p.company_id=company and p.status='active' and p.department_id=app.work_department(p_owner)) then raise exception '해당 부서의 재직 직원만 담당자로 지정할 수 있습니다.'; end if;
  if exists(select 1 from jsonb_array_elements(category->'fields') f group by f->>'id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(category->'fields') f group by trim(f->>'label') having count(*)>1) then raise exception '입력 항목 ID 또는 이름이 중복됩니다.'; end if;
  for field in select * from jsonb_array_elements(category->'fields') loop
   if jsonb_typeof(field) is distinct from 'object' or coalesce(field->>'id','') !~ '^[a-zA-Z0-9_-]{1,64}$'
   or jsonb_typeof(field->'label') is distinct from 'string' or length(trim(field->>'label')) not between 1 and 100
   or coalesce(field->>'type','') not in ('text','textarea','number','date') or jsonb_typeof(field->'required') is distinct from 'boolean'
   or jsonb_typeof(field->'placeholder') is distinct from 'string' or length(field->>'placeholder')>300 then raise exception '입력 항목 형식·필수 여부·안내 문구를 확인하세요.'; end if;
  end loop;
 end loop;
 insert into public.work_request_settings(company_id,owner,categories,updated_by) values(company,p_owner,p_categories,auth.uid())
 on conflict(company_id,owner) do update set categories=excluded.categories,revision=work_request_settings.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp()
 returning revision into current_revision;
 return current_revision;
end $$;

-- Runs inside the existing, validated save transaction. Clients cannot choose assignment identities.
create function app.apply_work_request_categories() returns trigger
 language plpgsql security definer set search_path='' as $$
declare settings public.work_request_settings%rowtype; previous jsonb:='[]'; assignments jsonb; selected jsonb;
 category jsonb; definition jsonb; prior jsonb; answers jsonb; field jsonb; value text; person uuid;
 normalized jsonb:='[]'; labels jsonb; collaborators jsonb;
begin
 if new.owner<>'design' or new.status='draft' then return new; end if;
 if tg_op='UPDATE' then previous:=coalesce(old.data->'categoryAssignments','[]'); end if;
 assignments:=coalesce(new.data->'categoryAssignments','[]');
 if new.status='requested' and (old.status='draft' or new.data->'values' is distinct from old.data->'values') then
  select * into settings from public.work_request_settings where company_id=new.company_id and owner='design' for share;
  selected:=new.data->'values'->'visualRequest'->'categories';
  if selected is null then
   -- Old clients keep their normal body. Recognized section markers can still be routed.
   select coalesce(jsonb_agg(jsonb_build_object('id',substring(b->>'id' from 24),'fields','{}'::jsonb)),'[]') into selected
    from jsonb_array_elements(coalesce(new.data->'values'->'blocks','[]')) b
    where b->>'type'='text' and b->>'id' like 'visual-request-section:%'
    and exists(select 1 from jsonb_array_elements(coalesce(settings.categories,'[]')) c where c->>'id'=substring(b->>'id' from 24));
  end if;
  if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected)>40 then raise exception '요청 분류를 확인하세요.'; end if;
  if exists(select 1 from jsonb_array_elements(selected) c group by c->>'id' having count(*)>1) then raise exception '요청 분류가 중복됩니다.'; end if;
  assignments:='[]';
  for category in select * from jsonb_array_elements(selected) loop
   select c into definition from jsonb_array_elements(coalesce(settings.categories,'[]')) c where c->>'id'=category->>'id';
   select c into prior from jsonb_array_elements(previous) c where c->>'categoryId'=category->>'id';
   if definition is null or not coalesce((definition->>'enabled')::boolean,false) then
    if prior is null then raise exception '사용할 수 없는 분류입니다. 설정을 다시 조회하세요.' using errcode='40001'; end if;
   end if;
   answers:=coalesce(category->'fields','{}'); labels:='{}';
   if jsonb_typeof(answers) is distinct from 'object' then raise exception '분류별 입력 값을 확인하세요.'; end if;
   if exists(select 1 from jsonb_each(answers) a where jsonb_typeof(a.value)<>'string' or length(a.value#>>'{}')>10000) then raise exception '입력 값은 10000자 이하의 글자여야 합니다.'; end if;
   for field in select * from jsonb_array_elements(coalesce(prior->'formFields',definition->'fields','[]')) loop
     value:=trim(coalesce(answers->>(field->>'id'),''));
     if coalesce((field->>'required')::boolean,false) and value='' then raise exception '%: % 항목을 입력하세요.',definition->>'label',field->>'label'; end if;
     if value<>'' and field->>'type'='number' then perform value::numeric; end if;
     if value<>'' and field->>'type'='date' then perform value::date; end if;
     labels:=labels||jsonb_build_object(field->>'id',field->>'label');
   end loop;
   if exists(select 1 from jsonb_object_keys(answers) k where not exists(select 1 from jsonb_array_elements(coalesce(prior->'formFields',definition->'fields','[]')) f where f->>'id'=k)) then raise exception '설정에 없는 입력 항목입니다.'; end if;
   if prior is null then
    person:=nullif(definition->>'assigneeId','')::uuid;
    if person is not null and not exists(select 1 from public.profiles p where p.id=person and p.status='active' and p.company_id=new.company_id and p.department_id=app.work_department(new.owner)) then person:=null; end if;
    prior:=jsonb_build_object('categoryId',category->>'id','label',definition->>'label','formFields',definition->'fields','assigneeId',coalesce(person::text,''),'assignedBy',case when person is null then '' else coalesce(settings.updated_by::text,'') end,'assignedAt',case when person is null then '' else clock_timestamp()::text end);
   end if;
   assignments:=assignments||jsonb_build_array(prior);
   normalized:=normalized||jsonb_build_array(jsonb_build_object('id',category->>'id','label',prior->>'label','fields',answers,'fieldLabels',labels));
  end loop;
  new.data:=jsonb_set(new.data,'{categoryAssignments}',assignments);
  if new.data->'values' ? 'visualRequest' then new.data:=jsonb_set(new.data,'{values,visualRequest,categories}',normalized); end if;
 end if;
 -- Preserve ordinary manual collaborators; add all per-work assignees to existing participant ACLs.
 if jsonb_array_length(assignments)>0 or jsonb_array_length(previous)>0 then
  select coalesce(jsonb_agg(distinct person_id),'[]') into collaborators from (
   select x as person_id from jsonb_array_elements_text(coalesce(new.data->'collaborators','[]')) x where not exists(select 1 from jsonb_array_elements(previous) p where p->>'assigneeId'=x)
   union select a->>'assigneeId' from jsonb_array_elements(assignments) a where coalesce(a->>'assigneeId','')<>''
  ) people;
  new.data:=jsonb_set(new.data,'{collaborators}',collaborators);
 end if;
 return new;
end $$;
create trigger apply_work_request_categories before update on public.work_requests for each row execute function app.apply_work_request_categories();

create function app.assign_work_request_category(p_request uuid,p_category text,p_assignee uuid,p_revision bigint) returns bigint
 language plpgsql security definer set search_path='' as $$
declare row public.work_requests%rowtype; tasks jsonb;
begin
 select * into row from public.work_requests where id=p_request for update;
 if not found or not app.work_request_read(p_request) or not app.work_manage_allowed(row.owner) then raise exception '업무 관리 담당자만 배정할 수 있습니다.' using errcode='42501'; end if;
 if row.revision is distinct from p_revision then raise exception '다른 직원이 수정했습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 if row.status in ('draft','completed','cancelled','rejected') then raise exception '배정할 수 없는 요청 상태입니다.'; end if;
 if p_assignee is not null and not exists(select 1 from public.profiles p where p.id=p_assignee and p.status='active' and p.company_id=row.company_id and p.department_id=app.work_department(row.owner)) then raise exception '대상 부서의 재직 직원만 배정할 수 있습니다.'; end if;
 if not exists(select 1 from jsonb_array_elements(coalesce(row.data->'categoryAssignments','[]')) a where a->>'categoryId'=p_category) then raise exception '요청에 없는 작업 분류입니다.'; end if;
 select jsonb_agg(case when a->>'categoryId'=p_category then a||jsonb_build_object('assigneeId',coalesce(p_assignee::text,''),'assignedBy',auth.uid(),'assignedAt',clock_timestamp()) else a end order by ord) into tasks
 from jsonb_array_elements(row.data->'categoryAssignments') with ordinality t(a,ord);
 update public.work_requests set data=jsonb_set(data,'{categoryAssignments}',tasks),revision=revision+1,updated_at=clock_timestamp() where id=p_request returning revision into row.revision;
 return row.revision;
end $$;

revoke all on function app.apply_work_request_categories() from public,anon,authenticated;
revoke all on function app.get_work_request_settings(text),app.save_work_request_settings(text,bigint,jsonb),app.assign_work_request_category(uuid,text,uuid,bigint) from public,anon;
grant execute on function app.get_work_request_settings(text),app.save_work_request_settings(text,bigint,jsonb),app.assign_work_request_category(uuid,text,uuid,bigint) to authenticated;
create function public.get_work_request_settings(p_owner text) returns jsonb language sql stable security invoker set search_path='' as $$select app.get_work_request_settings(p_owner)$$;
create function public.save_work_request_settings(p_owner text,p_revision bigint,p_categories jsonb) returns bigint language sql security invoker set search_path='' as $$select app.save_work_request_settings(p_owner,p_revision,p_categories)$$;
create function public.assign_work_request_category(p_request uuid,p_category text,p_assignee uuid,p_revision bigint) returns bigint language sql security invoker set search_path='' as $$select app.assign_work_request_category(p_request,p_category,p_assignee,p_revision)$$;
revoke all on function public.get_work_request_settings(text),public.save_work_request_settings(text,bigint,jsonb),public.assign_work_request_category(uuid,text,uuid,bigint) from public,anon;
grant execute on function public.get_work_request_settings(text),public.save_work_request_settings(text,bigint,jsonb),public.assign_work_request_category(uuid,text,uuid,bigint) to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.work_request_settings;
 end if;
end $$;
notify pgrst,'reload schema';
