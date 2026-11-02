-- Additive department reads; existing mutation/chat predicates are preserved.
alter table public.work_requests add column kind text not null default 'request' check(kind in ('request','internal'));
create function app.department_work_allowed(p_owner text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.company_id='e0000000-0000-4000-8000-000000000001' and p_owner in ('planning','design','md','logistics') and (p.department_id=app.work_department(p_owner) or app.work_operator()))
$$;
create function app.department_work_read(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_requests r where r.id=p_id and r.status<>'draft' and not coalesce((r.data->>'deleted')::boolean,false) and r.company_id='e0000000-0000-4000-8000-000000000001' and app.department_work_allowed(r.owner))
$$;
create policy department_work_read on public.work_requests for select to authenticated using(app.department_work_read(id));
create policy department_work_file_read on public.work_request_files for select to authenticated using(ready and app.department_work_read(request_id));
create policy department_work_object_read on storage.objects for select to authenticated using(bucket_id='company-work-requests' and exists(select 1 from public.work_request_files f where f.storage_path=name and f.ready and app.department_work_read(f.request_id)));
create function app.list_department_work(p_owner text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not app.department_work_allowed(p_owner) then raise exception '해당 부서 업무 조회 권한이 없습니다.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'title',r.data->'values'->>'title','requesterId',r.requester_id,'requesterName',p.display_name,'requesterDepartment',coalesce(d.name,''),'assigneeIds',people.ids,'assigneeNames',people.names,'status',r.status,'createdAt',r.created_at,'dueDate',coalesce(nullif(r.data->>'confirmedDueDate',''),r.data->'values'->>'dueDate',''),'brandId',coalesce(r.brand_id::text,''),'brandName',coalesce(b.name,'')) order by r.created_at,r.id)
 from public.work_requests r join public.profiles p on p.id=r.requester_id left join public.departments d on d.id=p.department_id left join public.brands b on b.id=r.brand_id
 cross join lateral (select coalesce(jsonb_agg(w.id order by w.id),'[]') ids,coalesce(jsonb_agg(w.display_name order by w.id),'[]') names from public.profiles w where w.company_id=r.company_id and w.id::text in (select nullif(r.data->>'assignee','') union select jsonb_array_elements_text(coalesce(r.data->'collaborators','[]')) union select c->>'assigneeId' from jsonb_array_elements(coalesce(r.data->'categoryAssignments','[]')) c)) people
 where r.owner=p_owner and app.department_work_read(r.id)),'[]');
end $$;
create function app.get_department_work(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.work_requests%rowtype;
begin
 select * into r from public.work_requests where id=p_id;
 if not found or not (app.department_work_read(p_id) or app.work_request_read(p_id)) or r.status='draft' or coalesce((r.data->>'deleted')::boolean,false) then raise exception '업무 조회 권한이 없습니다.' using errcode='42501'; end if;
 return jsonb_build_object('requests',jsonb_build_array(r.data||jsonb_build_object('id',r.id,'owner',r.owner,'kind',r.kind,'departmentReadable',app.department_work_read(r.id),'brandId',coalesce(r.brand_id::text,''),'requesterId',r.requester_id,'revision',r.revision,'status',r.status,'createdAt',r.created_at,'updatedAt',r.updated_at,'requesterDepartment',coalesce((select d.name from public.profiles p join public.departments d on d.id=p.department_id where p.id=r.requester_id),''),'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'roomId',m.room_id,'authorId',m.author_id,'authorName',m.author_name,'authorPosition',m.author_position,'body',m.body,'createdAt',m.created_at) order by m.created_at,m.id) from public.work_request_messages m where m.request_id=r.id and app.work_message_read(r.id,m.room_id)),'[]'))),
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'requestId',f.request_id,'path',f.storage_path,'name',f.file_name,'type',f.mime_type,'size',f.size_bytes)) from public.work_request_files f where f.request_id=p_id and f.ready),'[]'),
 'timers',coalesce((select jsonb_agg(jsonb_build_object('requestId',t.request_id,'profileId',t.profile_id,'accumulatedMs',t.accumulated_ms,'mountedAt',t.mounted_at)) from public.work_request_time_entries t where t.request_id=p_id and app.work_request_read(p_id)),'[]'),'managerAvailable',app.list_work_requests(r.owner)->'managerAvailable');
end $$;
create function app.begin_department_work(p_id uuid,p_owner text) returns bigint language plpgsql security definer set search_path='' as $$
declare revision bigint;
begin
 if not app.department_work_allowed(p_owner) then raise exception '해당 부서 업무만 등록할 수 있습니다.' using errcode='42501'; end if;
 revision:=app.begin_work_request(p_id,p_owner);
 update public.work_requests set kind='internal',data=data||jsonb_build_object('kind','internal') where id=p_id and requester_id=auth.uid() and status='draft';
 return revision;
end $$;
create function app.publish_department_work(p_id uuid,p_revision bigint,p_command uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare r public.work_requests%rowtype;
begin
 select * into r from public.work_requests where id=p_id for update;
 if not found or r.kind<>'internal' or r.requester_id<>auth.uid() or not app.department_work_allowed(r.owner) then raise exception '본인이 등록한 부서 업무만 시작할 수 있습니다.' using errcode='42501'; end if;
 if exists(select 1 from public.work_request_commands where actor_id=auth.uid() and command_id=p_command and request_id=p_id) then return r.revision; end if;
 if p_command is null or r.revision<>p_revision or r.status<>'requested' then raise exception '업무 상태가 바뀌었습니다.' using errcode='40001'; end if;
 update public.work_requests set status='inProgress',data=data||jsonb_build_object('assignee',auth.uid()::text,'assignedBy',auth.uid()::text,'assignedAt',clock_timestamp(),'collaborators','[]'::jsonb),revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into r;
 insert into public.work_request_commands(actor_id,command_id,request_id) values(auth.uid(),p_command,p_id);
 return r.revision;
end $$;
create function app.complete_department_work(p_id uuid,p_revision bigint,p_command uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare r public.work_requests%rowtype;
begin
 select * into r from public.work_requests where id=p_id for update;
 if not found or r.kind<>'internal' or r.requester_id<>auth.uid() or coalesce(r.data->>'assignee','')<>auth.uid()::text or not app.department_work_allowed(r.owner) then raise exception '본인이 등록하고 담당하는 업무만 완료할 수 있습니다.' using errcode='42501'; end if;
 if exists(select 1 from public.work_request_commands where actor_id=auth.uid() and command_id=p_command and request_id=p_id) then return r.revision; end if;
 if p_command is null or r.revision<>p_revision or r.status not in ('inProgress','waiting','accepted') then raise exception '업무 상태가 바뀌었습니다.' using errcode='40001'; end if;
 update public.work_requests set status='completed',data=data||jsonb_build_object('completedAt',clock_timestamp()),revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into r;
 update public.work_request_time_entries set accumulated_ms=accumulated_ms+greatest(0,extract(epoch from clock_timestamp()-mounted_at)*1000)::bigint,mounted_at=null where request_id=p_id and mounted_at is not null;
 insert into public.work_request_commands(actor_id,command_id,request_id) values(auth.uid(),p_command,p_id);
 return r.revision;
end $$;
-- Keep original request validation and auto-assignment unchanged for incoming requests.
do $patch$ declare definition text;
begin
 definition:=pg_get_functiondef('app.apply_work_request_categories()'::regprocedure);
 if position('if new.owner' in definition)=0 then raise exception '분류 트리거 정의가 변경되었습니다.'; end if;
 execute replace(definition,'if new.owner', 'if new.kind=''internal'' then new.data:=jsonb_set(new.data,''{categoryAssignments}'',''[]''::jsonb); return new; end if; if new.owner');
end $patch$;
create function app.save_department_work(p_id uuid,p_revision bigint,p_patch jsonb,p_command uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare r public.work_requests%rowtype; revision bigint;
begin
 select * into r from public.work_requests where id=p_id for update;
 if not found or r.kind<>'internal' or r.requester_id<>auth.uid() or not app.department_work_allowed(r.owner) then raise exception '본인 부서 업무 등록 권한이 없습니다.' using errcode='42501'; end if;
 if exists(select 1 from public.work_request_commands where actor_id=auth.uid() and command_id=p_command and request_id=p_id) then return r.revision; end if;
 if r.status<>'draft' then raise exception '이미 등록된 업무입니다. 다시 조회하세요.' using errcode='40001'; end if;
 revision:=app.save_work_request(p_id,p_revision,p_patch,p_command);
 -- Use a distinct command for the internal publication inside the same transaction.
 return app.publish_department_work(p_id,revision,gen_random_uuid());
end $$;
do $wrappers$ declare f record;
begin
 for f in select p.oid,p.proname,pg_get_function_arguments(p.oid) args,pg_get_function_identity_arguments(p.oid) identity_args,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname in ('list_department_work','get_department_work','begin_department_work','publish_department_work','complete_department_work','save_department_work') loop
 execute format('create function public.%I(%s) returns %s language sql security invoker set search_path='''' as %L',f.proname,f.args,pg_get_function_result(f.oid),format('select app.%I(%s)',f.proname,(select string_agg(quote_ident(v),',') from unnest(f.proargnames) v)));
 execute format('revoke all on function public.%I(%s) from public,anon',f.proname,f.identity_args);
 execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.identity_args);
 execute format('revoke all on function app.%I(%s) from public,anon',f.proname,f.identity_args);
 execute format('grant execute on function app.%I(%s) to authenticated',f.proname,f.identity_args);
 end loop;
end $wrappers$;
revoke all on function app.department_work_allowed(text),app.department_work_read(uuid) from public,anon;
grant execute on function app.department_work_allowed(text),app.department_work_read(uuid) to authenticated;
notify pgrst,'reload schema';
