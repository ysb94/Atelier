-- Company-owned work requests. All mutations validate the authenticated actor.
create table public.work_requests(
 id uuid primary key, company_id uuid not null references public.companies(id), owner text not null check(owner in ('planning','design','md','logistics')),
 requester_id uuid not null references public.profiles(id), brand_id uuid references public.brands(id),
 status text not null default 'draft' check(status in ('draft','requested','reviewing','accepted','inProgress','waiting','completionReview','completionConfirm','completed','cancelled','rejected')),
 data jsonb not null default '{}',revision bigint not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index work_requests_queue on public.work_requests(company_id,owner,status,updated_at desc);
create index work_requests_requester on public.work_requests(requester_id,updated_at desc);
create table public.work_request_messages(id uuid primary key,request_id uuid not null references public.work_requests(id) on delete cascade,room_id text not null,author_id uuid not null references public.profiles(id),author_name text not null,author_position text not null default '',body text not null check(length(body) between 1 and 10000),created_at timestamptz not null default now());
create index work_messages_room on public.work_request_messages(request_id,room_id,created_at);
create table public.work_request_files(id uuid primary key,request_id uuid not null references public.work_requests(id) on delete cascade,uploader_id uuid not null references public.profiles(id),storage_path text unique not null,file_name text not null,mime_type text not null,size_bytes bigint not null check(size_bytes between 1 and 20971520),ready boolean not null default false,created_at timestamptz not null default now());
create table public.work_request_time_entries(request_id uuid not null references public.work_requests(id) on delete cascade,profile_id uuid not null references public.profiles(id),accumulated_ms bigint not null default 0,mounted_at timestamptz,primary key(request_id,profile_id));
create unique index work_one_active_timer on public.work_request_time_entries(profile_id) where mounted_at is not null;
create table public.work_request_commands(actor_id uuid not null references public.profiles(id),command_id uuid not null,request_id uuid not null,created_at timestamptz not null default now(),primary key(actor_id,command_id));
alter table public.work_requests enable row level security;
alter table public.work_request_messages enable row level security;
alter table public.work_request_files enable row level security;
alter table public.work_request_time_entries enable row level security;
alter table public.work_request_commands enable row level security;
grant select on public.work_requests,public.work_request_messages,public.work_request_files,public.work_request_time_entries to authenticated;
revoke all on public.work_requests,public.work_request_messages,public.work_request_files,public.work_request_time_entries,public.work_request_commands from anon;

create function app.work_request_assigned(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_requests r join public.profiles p on p.id=auth.uid() and p.status='active' and p.company_id=r.company_id where r.id=p_id and (r.data->>'assignee'=p.id::text or coalesce(r.data->'collaborators','[]') ? p.id::text))
$$;
create function app.work_request_read(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_requests r join public.profiles p on p.id=auth.uid() and p.status='active' and p.company_id=r.company_id where r.id=p_id and (r.requester_id=p.id or (r.status<>'draft' and (app.work_manage_allowed(r.owner) or app.work_request_assigned(r.id)))))
$$;
create function app.work_message_read(p_request uuid,p_room text) returns boolean language sql stable security definer set search_path='' as $$
 select app.work_request_read(p_request) and exists(select 1 from public.work_requests r where r.id=p_request and (app.work_manage_allowed(r.owner) or (p_room='requester' and r.requester_id=auth.uid()) or (p_room=auth.uid()::text and app.work_request_assigned(r.id))))
$$;
create policy work_request_read on public.work_requests for select to authenticated using(app.work_request_read(id));
create policy work_message_read on public.work_request_messages for select to authenticated using(app.work_message_read(request_id,room_id));
create policy work_file_read on public.work_request_files for select to authenticated using(app.work_request_read(request_id));
create policy work_time_read on public.work_request_time_entries for select to authenticated using(app.work_request_read(request_id));

create function app.begin_work_request(p_id uuid,p_owner text) returns bigint language plpgsql security definer set search_path='' as $$
declare me public.profiles%rowtype; r public.work_requests%rowtype;
begin
 select * into me from public.profiles where id=auth.uid() and status='active' and company_id='e0000000-0000-4000-8000-000000000001';
 if not found then raise exception '재직 직원만 요청할 수 있습니다.' using errcode='42501'; end if;
 if p_owner not in ('planning','design','md','logistics') then raise exception '요청 부서를 확인해 주세요.'; end if;
 insert into public.work_requests(id,company_id,owner,requester_id,data) values(p_id,me.company_id,p_owner,me.id,jsonb_build_object('values',jsonb_build_object('requester',me.display_name,'requesterPosition',coalesce(me.position,'')),'collaborators','[]'::jsonb,'assignee','','assignedBy','')) on conflict(id) do nothing;
 select * into r from public.work_requests where id=p_id for update;
 if r.requester_id<>me.id or r.owner<>p_owner or r.status<>'draft' then raise exception '요청 작성 상태가 바뀌었습니다.' using errcode='40001'; end if;
 return r.revision;
end $$;

create function app.save_work_request(p_id uuid,p_revision bigint,p_patch jsonb,p_command uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare r public.work_requests%rowtype; me public.profiles%rowtype; managing boolean; own boolean; assigned boolean; primary_worker boolean;
 next_status text; k text; person_id text; target uuid; merged jsonb; patch jsonb;
begin
 select * into r from public.work_requests where id=p_id for update;
 if not found or not app.work_request_read(p_id) then raise exception '요청을 수정할 권한이 없습니다.' using errcode='42501'; end if;
 select * into me from public.profiles where id=auth.uid() and status='active' and company_id=r.company_id;
 if not found then raise exception '직원 정보를 확인해 주세요.' using errcode='42501'; end if;
 if exists(select 1 from public.work_request_commands where actor_id=me.id and command_id=p_command and request_id=p_id) then return r.revision; end if;
 if r.revision<>p_revision then raise exception '다른 직원이 수정했습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 if jsonb_typeof(p_patch)<>'object' or p_command is null then raise exception '저장 요청을 확인해 주세요.'; end if;
 if p_patch='{}'::jsonb then return r.revision; end if;
 managing:=app.work_manage_allowed(r.owner); own:=r.requester_id=me.id; assigned:=app.work_request_assigned(r.id); primary_worker:=r.data->>'assignee'=me.id::text;
 patch:=p_patch; next_status:=coalesce(patch->>'status',r.status);
 for k in select jsonb_object_keys(patch) loop
  if k not in ('values','brandId','status','managerPriority','assignee','collaborators','confirmedDueDate','plannedStart','plannedEnd','completionResult') then raise exception '변경할 수 없는 요청 항목입니다: %',k; end if;
  if k='values' and not (own and r.status in ('draft','requested')) then raise exception '접수 전 본인 요청만 수정할 수 있습니다.' using errcode='42501'; end if;
  if k in ('managerPriority','assignee','collaborators','confirmedDueDate','plannedStart','plannedEnd') and not managing then raise exception '업무 관리 담당자만 배정·일정을 변경할 수 있습니다.' using errcode='42501'; end if;
  if k='brandId' and not ((own and r.status in ('draft','requested')) or (managing and r.brand_id is null)) then raise exception '브랜드를 변경할 수 없습니다.'; end if;
  if k='completionResult' and not (primary_worker or managing) then raise exception '담당 작업자만 결과를 저장할 수 있습니다.'; end if;
 end loop;
 if r.status in ('completed','cancelled','rejected') then raise exception '종료된 요청은 수정할 수 없습니다.'; end if;
 if next_status<>r.status then
  if not (
   (own and r.status='draft' and next_status='requested') or
   (managing and r.status='requested' and next_status='reviewing') or
   (managing and r.status in ('requested','reviewing') and next_status in ('accepted','rejected')) or
   (primary_worker and r.status in ('accepted','inProgress','waiting') and next_status in ('inProgress','waiting')) or
   (primary_worker and r.status in ('accepted','inProgress','waiting') and next_status=case when nullif(r.data->>'assignedBy','') is not null and r.data->>'assignedBy'<>me.id::text then 'completionReview' else 'completionConfirm' end) or
   (managing and r.status='completionReview' and next_status in ('completionConfirm','inProgress')) or
   (own and r.status='completionConfirm' and next_status in ('completed','inProgress')) or
   (own and next_status='cancelled' and r.status<>'draft')
  ) then raise exception '허용되지 않은 업무 단계 변경입니다.' using errcode='42501'; end if;
 end if;
 merged:=r.data||(patch-array['status','brandId']);
 if patch ? 'values' then
  if jsonb_typeof(patch->'values')<>'object' or jsonb_typeof(patch->'values'->'blocks')<>'array' or jsonb_typeof(patch->'values'->'referenceFiles')<>'array' or octet_length((patch->'values')::text)>1048576 then raise exception '본문과 첨부 형식을 확인해 주세요.'; end if;
  if length(trim(coalesce(patch->'values'->>'title','')))=0 or length(coalesce(patch->'values'->>'title',''))>200 or nullif(patch->'values'->>'dueDate','') is null or jsonb_array_length(coalesce(patch->'values'->'blocks','[]'))=0 then raise exception '제목·마감일·본문을 확인해 주세요.'; end if;
  perform (patch->'values'->>'dueDate')::date;
  merged:=jsonb_set(merged,'{values}',(patch->'values')||jsonb_build_object('requester',me.display_name,'requesterPosition',coalesce(me.position,'')));
  -- Every file reference is checked below; browser File/URL objects never enter the DB.
  if exists(select 1 from jsonb_path_query(patch->'values','$.**.fileRef') t(value) where not exists(select 1 from public.work_request_files f where f.id::text=t.value#>>'{}' and f.request_id=r.id and f.ready)) then raise exception '업로드가 완료되지 않은 첨부가 있습니다.'; end if;
 end if;
 if next_status='requested' and r.status='draft' and (length(trim(coalesce(merged->'values'->>'title','')))=0 or nullif(merged->'values'->>'dueDate','') is null or jsonb_array_length(coalesce(merged->'values'->'blocks','[]'))=0) then raise exception '제목·마감일·본문을 확인해 주세요.'; end if;
 if length(coalesce(merged->>'completionResult',''))>10000 then raise exception '완료 결과는 10000자 이하로 입력하세요.'; end if;
 if patch ? 'brandId' then
  target:=nullif(patch->>'brandId','')::uuid;
  if target is not null and not exists(select 1 from public.brands b where b.id=target and b.company_id=r.company_id) then raise exception '같은 회사 브랜드만 지정할 수 있습니다.'; end if;
  r.brand_id:=target;
 end if;
 if patch ? 'managerPriority' and patch->>'managerPriority' not in ('urgent','high','normal','low','') then raise exception '우선순위를 확인해 주세요.'; end if;
 if patch ? 'assignee' or patch ? 'collaborators' then
  if jsonb_typeof(coalesce(merged->'collaborators','[]'))<>'array' then raise exception '협업자 목록을 확인해 주세요.'; end if;
  for person_id in select jsonb_array_elements_text(coalesce(merged->'collaborators','[]')||case when nullif(merged->>'assignee','') is null then '[]'::jsonb else jsonb_build_array(merged->>'assignee') end) loop
   if not exists(select 1 from public.profiles p where p.id::text=person_id and p.status='active' and p.company_id=r.company_id and p.department_id=app.work_department(r.owner)) then raise exception '대상 부서의 재직 직원만 배정할 수 있습니다.'; end if;
  end loop;
  if patch ? 'assignee' and merged->>'assignee' is distinct from r.data->>'assignee' then merged:=merged||jsonb_build_object('assignedBy',me.id,'assignedAt',clock_timestamp()); end if;
 end if;
 if next_status in ('completionReview','completionConfirm') and next_status<>r.status then merged:=merged||jsonb_build_object('completionRequestedAt',clock_timestamp()); end if;
 if next_status='inProgress' and r.status in ('completionReview','completionConfirm') then merged:=merged||jsonb_build_object('completionRejectCount',coalesce((r.data->>'completionRejectCount')::int,0)+1); end if;
 if next_status='completed' then merged:=merged||jsonb_build_object('completedAt',clock_timestamp()); end if;
 if nullif(merged->>'plannedStart','') is not null and nullif(merged->>'plannedEnd','') is not null and (merged->>'plannedEnd')::timestamp<=(merged->>'plannedStart')::timestamp then raise exception '작업 종료는 시작보다 뒤여야 합니다.'; end if;
 if next_status in ('completed','cancelled','rejected','completionReview','completionConfirm') then
  update public.work_request_time_entries set accumulated_ms=accumulated_ms+greatest(0,(extract(epoch from (clock_timestamp()-mounted_at))*1000)::bigint),mounted_at=null where request_id=p_id and mounted_at is not null;
 end if;
 update public.work_requests set data=merged,brand_id=r.brand_id,status=next_status,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning revision into r.revision;
 insert into public.work_request_commands values(me.id,p_command,p_id,now());
 return r.revision;
end $$;

create function app.delete_work_request(p_id uuid,p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.work_requests%rowtype;
begin
 select * into r from public.work_requests where id=p_id for update;
 if not found or not app.work_request_read(p_id) or r.requester_id<>auth.uid() or (r.status not in ('draft','requested') and not coalesce((r.data->>'deleted')::boolean,false)) then raise exception '접수 전 본인 요청만 삭제할 수 있습니다.' using errcode='42501'; end if;
 if coalesce((r.data->>'deleted')::boolean,false) then return (select coalesce(jsonb_agg(storage_path),'[]') from public.work_request_files where request_id=p_id); end if;
 if r.revision<>p_revision then raise exception '다른 직원이 수정했습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 -- Keep file metadata so the uploader can finish authenticated object cleanup.
 if exists(select 1 from public.work_request_files where request_id=p_id) then
  update public.work_requests set status='cancelled',data=data||'{"deleted":true}',revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 else delete from public.work_requests where id=p_id; end if;
 return (select coalesce(jsonb_agg(storage_path),'[]') from public.work_request_files where request_id=p_id);
end $$;

create function app.finish_work_request_delete(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.work_requests r where r.id=p_id and r.requester_id=auth.uid() and coalesce((r.data->>'deleted')::boolean,false)
 and not exists(select 1 from public.work_request_files f join storage.objects o on o.bucket_id='company-work-requests' and o.name=f.storage_path where f.request_id=r.id);
end $$;

create function app.send_work_request_message(p_id uuid,p_room text,p_body text,p_command uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.work_requests%rowtype; me public.profiles%rowtype;
begin
 select * into r from public.work_requests where id=p_id for update;
 if not app.work_message_read(p_id,p_room) or r.status='draft' then raise exception '대화 참여 권한이 없습니다.' using errcode='42501'; end if;
 if p_room<>'requester' and not (coalesce(r.data->'collaborators','[]') ? p_room or r.data->>'assignee'=p_room) then raise exception '배정되지 않은 대화 대상입니다.'; end if;
 if length(trim(p_body)) not between 1 and 10000 or p_command is null then raise exception '대화 내용을 확인해 주세요.'; end if;
 if exists(select 1 from public.work_request_messages where id=p_command and request_id=p_id and author_id=auth.uid()) then return; end if;
 select * into me from public.profiles where id=auth.uid();
 insert into public.work_request_messages(id,request_id,room_id,author_id,author_name,author_position,body) values(p_command,p_id,p_room,me.id,me.display_name,coalesce(me.position,''),trim(p_body));
 if app.work_manage_allowed(r.owner) and r.status='requested' then update public.work_requests set status='reviewing',revision=revision+1,updated_at=clock_timestamp() where id=p_id; end if;
end $$;

create function app.set_active_work_request(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if p_id is not null and not exists(select 1 from public.work_requests where id=p_id and app.work_request_assigned(id) and status in ('accepted','inProgress','waiting')) then raise exception '배정된 진행 업무만 시작할 수 있습니다.' using errcode='42501'; end if;
 update public.work_request_time_entries set accumulated_ms=accumulated_ms+greatest(0,(extract(epoch from (clock_timestamp()-mounted_at))*1000)::bigint),mounted_at=null where profile_id=auth.uid() and mounted_at is not null and request_id is distinct from p_id;
 if p_id is not null then insert into public.work_request_time_entries(request_id,profile_id,mounted_at) values(p_id,auth.uid(),clock_timestamp()) on conflict(request_id,profile_id) do update set mounted_at=coalesce(public.work_request_time_entries.mounted_at,excluded.mounted_at); end if;
end $$;

create function app.list_work_requests(p_owner text default null) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'requests',coalesce((select jsonb_agg(r.data||jsonb_build_object('id',r.id,'owner',r.owner,'brandId',coalesce(r.brand_id::text,''),'requesterId',r.requester_id,'requesterDepartment',coalesce((select d.name from public.profiles p left join public.departments d on d.id=p.department_id where p.id=r.requester_id),''),'revision',r.revision,'status',r.status,'createdAt',r.created_at,'updatedAt',r.updated_at,'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'roomId',m.room_id,'authorId',m.author_id,'authorName',m.author_name,'authorPosition',m.author_position,'body',m.body,'createdAt',m.created_at) order by m.created_at,m.id) from public.work_request_messages m where m.request_id=r.id and app.work_message_read(r.id,m.room_id)),'[]')) order by r.updated_at desc) from public.work_requests r where app.work_request_read(r.id) and r.status<>'draft' and not coalesce((r.data->>'deleted')::boolean,false) and (p_owner is null or r.owner=p_owner)),'[]'),
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'requestId',f.request_id,'path',f.storage_path,'name',f.file_name,'type',f.mime_type,'size',f.size_bytes,'deleted',r.requester_id=auth.uid() and coalesce((r.data->>'deleted')::boolean,false))) from public.work_request_files f join public.work_requests r on r.id=f.request_id where f.ready and app.work_request_read(r.id) and (p_owner is null or r.owner=p_owner)),'[]'),
 'timers',coalesce((select jsonb_agg(jsonb_build_object('requestId',t.request_id,'profileId',t.profile_id,'accumulatedMs',t.accumulated_ms,'mountedAt',t.mounted_at)) from public.work_request_time_entries t join public.work_requests r on r.id=t.request_id where app.work_request_read(r.id) and (p_owner is null or r.owner=p_owner)),'[]'),
 'managerAvailable',exists(select 1 from public.profiles p where p.status='active' and p.company_id='e0000000-0000-4000-8000-000000000001' and ((p.department_id=app.work_department(p_owner) and (p.is_admin or p.position in ('팀장','이사'))) or exists(select 1 from public.permission_grants g where g.profile_id=p.id and g.company_id=p.company_id and g.permission='work.manage' and ((g.scope_kind='company' and g.scope_id=p.company_id) or (g.scope_kind='department' and g.scope_id=app.work_department(p_owner)))))))
 where exists(select 1 from public.profiles me where me.id=auth.uid() and me.status='active' and me.company_id='e0000000-0000-4000-8000-000000000001')
$$;

insert into storage.buckets(id,name,public,file_size_limit) values('company-work-requests','company-work-requests',false,20971520) on conflict(id) do nothing;
create function app.begin_work_request_file(p_request uuid,p_name text,p_type text,p_size bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare file_id uuid:=gen_random_uuid(); object_path text; company uuid;
begin
 if not app.work_request_read(p_request) or length(p_name) not between 1 and 255 or p_size not between 1 and 20971520 or p_name ~* '\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$' then raise exception '20MB 이하의 실행 파일이 아닌 자료만 첨부할 수 있습니다.'; end if;
 if not exists(select 1 from public.work_requests where id=p_request and ((requester_id=auth.uid() and status in ('draft','requested')) or app.work_request_assigned(id) or app.work_manage_allowed(owner))) then raise exception '첨부 권한이 없습니다.' using errcode='42501'; end if;
 select company_id into company from public.work_requests where id=p_request;
 object_path:=company::text||'/'||p_request::text||'/'||file_id::text;
 insert into public.work_request_files(id,request_id,uploader_id,storage_path,file_name,mime_type,size_bytes) values(file_id,p_request,auth.uid(),object_path,p_name,coalesce(p_type,'application/octet-stream'),p_size);
 return jsonb_build_object('id',file_id,'path',object_path);
end $$;
create function app.finish_work_request_file(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.work_request_files f set ready=true where f.id=p_id and f.uploader_id=auth.uid() and app.work_request_read(f.request_id) and exists(select 1 from storage.objects o where o.bucket_id='company-work-requests' and o.name=f.storage_path and coalesce((o.metadata->>'size')::bigint,0)=f.size_bytes);
 if not found then raise exception '업로드된 파일을 확인하지 못했습니다.'; end if;
end $$;
create policy work_object_insert on storage.objects for insert to authenticated with check(bucket_id='company-work-requests' and exists(select 1 from public.work_request_files f where f.storage_path=name and f.uploader_id=auth.uid() and not f.ready and app.work_request_read(f.request_id)));
create policy work_object_select on storage.objects for select to authenticated using(bucket_id='company-work-requests' and exists(select 1 from public.work_request_files f where f.storage_path=name and app.work_request_read(f.request_id) and (f.ready or f.uploader_id=auth.uid())));
create policy work_object_delete on storage.objects for delete to authenticated using(bucket_id='company-work-requests' and exists(select 1 from public.work_request_files f join public.work_requests r on r.id=f.request_id where f.storage_path=name and f.uploader_id=auth.uid() and app.work_request_read(f.request_id) and (not f.ready or (r.requester_id=auth.uid() and (r.status in ('draft','requested') or coalesce((r.data->>'deleted')::boolean,false))))));

-- Expose only invoker wrappers; keep definer implementations outside the API schema.
do $wrappers$
declare f record; signature text; args text; argnames text;
begin
 for f in select p.oid,p.proname,pg_get_function_arguments(p.oid) a,pg_get_function_result(p.oid) result,p.proargnames,p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname in ('begin_work_request','save_work_request','delete_work_request','finish_work_request_delete','send_work_request_message','set_active_work_request','list_work_requests','begin_work_request_file','finish_work_request_file') loop
  select string_agg(quote_ident(a),',') into argnames from unnest(f.proargnames[1:f.pronargs]) a;
  execute format('create function public.%I(%s) returns %s language sql set search_path='''' as %L',f.proname,f.a,f.result,format('select app.%I(%s)',f.proname,argnames));
  signature:=pg_get_function_identity_arguments(f.oid);
  execute format('revoke all on function app.%I(%s) from public,anon',f.proname,signature);
  execute format('grant execute on function app.%I(%s) to authenticated',f.proname,signature);
  execute format('revoke all on function public.%I(%s) from public,anon',f.proname,signature);
  execute format('grant execute on function public.%I(%s) to authenticated',f.proname,signature);
 end loop;
end $wrappers$;
revoke all on function app.work_request_assigned(uuid),app.work_request_read(uuid),app.work_message_read(uuid,text) from public,anon;
grant execute on function app.work_request_assigned(uuid),app.work_request_read(uuid),app.work_message_read(uuid,text) to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.work_requests,public.work_request_messages,public.work_request_time_entries;
 end if;
end $$;
