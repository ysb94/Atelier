-- Only work-request management changes. No user/grant/attendance/overtime data changes.
create or replace function app.work_manage_allowed(p_domain text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_domain in ('planning','design','md','logistics')
 and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
 and p.company_id='e0000000-0000-4000-8000-000000000001'
 and (app.work_operator() or app.permission_allowed('work.manage','department',app.work_department(p_domain))))
$$;

CREATE OR REPLACE FUNCTION app.list_work_requests(p_owner text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'requests',coalesce((select jsonb_agg(r.data||jsonb_build_object('id',r.id,'owner',r.owner,'brandId',coalesce(r.brand_id::text,''),'requesterId',r.requester_id,'requesterDepartment',coalesce((select d.name from public.profiles p left join public.departments d on d.id=p.department_id where p.id=r.requester_id),''),'revision',r.revision,'status',r.status,'createdAt',r.created_at,'updatedAt',r.updated_at,'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'roomId',m.room_id,'authorId',m.author_id,'authorName',m.author_name,'authorPosition',m.author_position,'body',m.body,'createdAt',m.created_at) order by m.created_at,m.id) from public.work_request_messages m where m.request_id=r.id and app.work_message_read(r.id,m.room_id)),'[]')) order by r.updated_at desc) from public.work_requests r where app.work_request_read(r.id) and r.status<>'draft' and not coalesce((r.data->>'deleted')::boolean,false) and (p_owner is null or r.owner=p_owner)),'[]'),
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'requestId',f.request_id,'path',f.storage_path,'name',f.file_name,'type',f.mime_type,'size',f.size_bytes,'deleted',r.requester_id=auth.uid() and coalesce((r.data->>'deleted')::boolean,false))) from public.work_request_files f join public.work_requests r on r.id=f.request_id where f.ready and app.work_request_read(r.id) and (p_owner is null or r.owner=p_owner)),'[]'),
 'timers',coalesce((select jsonb_agg(jsonb_build_object('requestId',t.request_id,'profileId',t.profile_id,'accumulatedMs',t.accumulated_ms,'mountedAt',t.mounted_at)) from public.work_request_time_entries t join public.work_requests r on r.id=t.request_id where app.work_request_read(r.id) and (p_owner is null or r.owner=p_owner)),'[]'),
 'managerAvailable',exists(select 1 from public.profiles p where p.status='active' and p.company_id='e0000000-0000-4000-8000-000000000001'
 and (p.id in ('d0000000-0000-4000-8000-000000000001','a5afdd00-4a61-44dc-a1a3-082fa8a1345d','56074867-fdc2-4ce5-8e97-cea431decc36')
 or exists(select 1 from public.permission_grants g where g.profile_id=p.id and g.company_id=p.company_id and g.permission='work.manage'
 and ((g.scope_kind='company' and g.scope_id=p.company_id) or (g.scope_kind='department' and g.scope_id=app.work_department(p_owner)))))))
 where exists(select 1 from public.profiles me where me.id=auth.uid() and me.status='active' and me.company_id='e0000000-0000-4000-8000-000000000001')
$function$
;
notify pgrst,'reload schema';
