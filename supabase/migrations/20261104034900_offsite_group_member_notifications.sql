-- Return only the authenticated employee's group notices; do not widen profiles RLS.
create function app.my_offsite_group_notices() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_agg(jsonb_build_object(
 'event_key','offsite-group:'||r.id,'entity_id',r.id,'created_at',g.created_at,'event_type','offsite-group','tab','my-attendance','kind','offsite',
 'employee_name',p.display_name,'from_date',r.from_date,'to_date',r.to_date,'start_time',r.start_time,'end_time',r.end_time,'note',r.note,'decision_note',null,
 'action_needed',false,'status',r.status,'current',r.status='approved','read_at',reads.read_at))
 from public.company_leave_requests r join public.offsite_groups g on g.id=r.offsite_group_id join public.profiles p on p.id=g.created_by
 left join public.my_home_notification_reads reads on reads.reader_id=auth.uid() and reads.event_key='offsite-group:'||r.id
 where r.employee_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and company_id=g.company_id and status='active')),'[]'::jsonb);
$$;
revoke all on function app.my_offsite_group_notices() from public,anon,authenticated;
grant execute on function app.my_offsite_group_notices() to authenticated;
create or replace function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$
 select app.home_notifications_before_offsite_groups() || app.my_offsite_group_notices();
$$;
notify pgrst, 'reload schema';
