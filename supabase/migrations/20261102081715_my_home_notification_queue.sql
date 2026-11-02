-- Additive notification state only. Existing business rows, policies and RPC signatures are preserved.
-- Applied to Atelier on 2026-11-02; filename matches the server migration history.
create table public.my_home_notification_reads (
 reader_id uuid not null references public.profiles(id),
 event_key text not null check(length(event_key) between 1 and 250),
 read_at timestamptz not null default clock_timestamp(),
 primary key(reader_id,event_key)
);
alter table public.my_home_notification_reads enable row level security;
revoke all on public.my_home_notification_reads from public,anon,authenticated;
grant select,insert on public.my_home_notification_reads to authenticated;
create policy my_home_reads_own on public.my_home_notification_reads for select to authenticated
 using(reader_id=(select auth.uid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and status='active'));
create policy my_home_reads_insert_own on public.my_home_notification_reads for insert to authenticated
 with check(reader_id=(select auth.uid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and status='active'));

create table public.my_home_request_events (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 employee_id uuid not null references public.profiles(id),
 request_id uuid not null references public.company_leave_requests(id),
 status text not null check(status in ('approved','rejected')),
 snapshot jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,status)
);
alter table public.my_home_request_events enable row level security;
revoke all on public.my_home_request_events from public,anon,authenticated;
grant select on public.my_home_request_events to authenticated;
create policy my_home_events_own on public.my_home_request_events for select to authenticated using (
 employee_id=(select auth.uid()) and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
);
create index my_home_events_employee on public.my_home_request_events(employee_id,created_at desc);
create function app.emit_my_home_request_result() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status in ('approved','rejected') then
  insert into public.my_home_request_events(company_id,employee_id,request_id,status,snapshot)
  values(new.company_id,new.employee_id,new.id,new.status,jsonb_build_object('note',new.note,'decision_note',new.decision_note)) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function app.emit_my_home_request_result() from public,anon,authenticated;
create trigger my_home_request_result after update of status on public.company_leave_requests
 for each row execute function app.emit_my_home_request_result();

-- Runs as the caller: existing row policies and department approval scope still apply.
create function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$
 with eligible as (
  select r.* from public.list_my_approval_requests() r
  where (r.status='pending' or exists(select 1 from public.my_home_notification_reads h where h.reader_id=auth.uid() and h.event_key='request-approval:'||r.id)) and (r.kind in ('overtime','correction') or r.advance_requested)
   and app.is_department_request_approver(r.company_id,r.department_id,r.kind)
   and (r.employee_id<>(select auth.uid()) or (r.kind in ('overtime','correction') and not r.advance_requested))
 ), clock_candidates as (
  select * from public.list_effective_attendance_clocks('2026-10-26'::date,(now() at time zone 'Asia/Seoul')::date,auth.uid()) c
  where c.employee_id=(select auth.uid()) and not exists(select 1 from public.attendance_exemptions e where e.profile_id=(select auth.uid()))
 ), missing_clocks as (
  select c.* from clock_candidates c where c.clock_out_at is null
   and (c.auto_closed_at is not null or c.work_date=(select max(x.work_date) from clock_candidates x where x.work_date<(now() at time zone 'Asia/Seoul')::date))
   and not exists(select 1 from public.company_leave_requests r where r.employee_id=c.employee_id and r.kind='correction' and r.from_date=c.work_date and r.status in ('pending','approved'))
 ), notifications as (
  select 'request-approval:'||r.id as event_key,r.id::text as entity_id,r.created_at,
   'approval'::text as event_type,'approvals'::text as tab,r.kind,r.employee_name,r.from_date,r.to_date,r.start_time,r.end_time,r.note,r.decision_note,
   (r.status='pending') as action_needed,r.status,(r.status='pending') as current
  from eligible r
  union all
  select 'request-result:'||e.id,r.id::text,e.created_at,'result',case when r.kind='overtime' then 'overtime' else 'my-attendance' end,
   r.kind,r.employee_name,r.from_date,r.to_date,r.start_time,r.end_time,e.snapshot->>'note',e.snapshot->>'decision_note',false,e.status,(r.status=e.status)
  from public.my_home_request_events e join public.company_leave_requests r on r.id=e.request_id
  where e.employee_id=(select auth.uid())
  union all
  select 'checkout:'||c.work_date,c.work_date::text,coalesce(c.auto_closed_at,((c.work_date+time '23:59') at time zone 'Asia/Seoul')),
   'checkout','my-attendance','correction','',c.work_date,c.work_date,c.clock_in,null::time,
   '실제 퇴근시간을 확인해 등록해 주세요. 오늘 자동 종료된 기록은 다음 출근 후 등록할 수 있습니다.',null::text,true,'pending',true
  from missing_clocks c
 )
 select coalesce(jsonb_agg(to_jsonb(n)||jsonb_build_object('read_at',reads.read_at) order by n.created_at desc,n.event_key),'[]'::jsonb)
 from notifications n left join public.my_home_notification_reads reads on reads.reader_id=(select auth.uid()) and reads.event_key=n.event_key
 where exists(select 1 from public.profiles where id=(select auth.uid()) and status='active');
$$;
create function public.read_my_home_work_notification(p_key text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from jsonb_array_elements(public.list_my_home_work_notifications()) item where item->>'event_key'=p_key) then
  raise exception '현재 접근 가능한 알림이 아닙니다.' using errcode='42501';
 end if;
 insert into public.my_home_notification_reads(reader_id,event_key) values(auth.uid(),p_key) on conflict do nothing;
end $$;

-- Both changing a schedule and reading its invitation lock the same round first.
create function app.read_meeting_notice_version(p_id uuid,p_sent_at timestamptz,p_schedule_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb; round_id uuid;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 select i.round_id into round_id from public.meeting_invitations i where i.id=p_id and i.profile_id=auth.uid();
 if round_id is null then select n.round_id into round_id from public.meeting_host_notices n where n.id=p_id and n.recipient_id=auth.uid(); end if;
 if round_id is null then raise exception '알림 접근 권한이 없습니다.' using errcode='42501'; end if;
 perform 1 from public.meeting_rounds r where r.id=round_id for update;
 if not exists(select 1 from public.meeting_rounds r where r.id=round_id and r.schedule_version=p_schedule_version) then raise exception '일정이 변경되었습니다. 최신 내용을 확인해 주세요.'; end if;
 select value into item from jsonb_array_elements(app.meeting_notifications()) where value->>'id'=p_id::text;
 if item is null or (item->>'createdAt')::timestamptz is distinct from p_sent_at then
  raise exception '일정이 변경되었습니다. 최신 내용을 확인해 주세요.';
 end if;
 perform app.meeting_read_invitation(p_id);
end $$;
create function public.read_meeting_notice_version(p_id uuid,p_sent_at timestamptz,p_schedule_version integer) returns void
language sql security invoker set search_path='' as $$ select app.read_meeting_notice_version(p_id,p_sent_at,p_schedule_version); $$;
revoke all on function public.list_my_home_work_notifications(),public.read_my_home_work_notification(text),public.read_meeting_notice_version(uuid,timestamptz,integer),app.read_meeting_notice_version(uuid,timestamptz,integer) from public,anon;
grant execute on function public.list_my_home_work_notifications(),public.read_my_home_work_notification(text),public.read_meeting_notice_version(uuid,timestamptz,integer),app.read_meeting_notice_version(uuid,timestamptz,integer) to authenticated;

create function public.confirm_my_home_host_notice(p_id uuid,p_sent_at timestamptz,p_schedule_version integer) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.meeting_host_notices n where n.id=p_id and n.recipient_id=(select auth.uid()) and n.schedule_version=p_schedule_version and n.created_at=p_sent_at) then
  raise exception '현재 확인 가능한 호스트 알림이 아닙니다.' using errcode='42501';
 end if;
 perform public.read_meeting_notice_version(p_id,p_sent_at,p_schedule_version);
 insert into public.my_home_notification_reads(reader_id,event_key) values(auth.uid(),'host-action:'||p_id) on conflict do nothing;
end $$;
revoke all on function public.confirm_my_home_host_notice(uuid,timestamptz,integer) from public,anon;
grant execute on function public.confirm_my_home_host_notice(uuid,timestamptz,integer) to authenticated;

-- Only new notification tables are added; existing business publication settings stay intact.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.my_home_request_events,public.my_home_notification_reads;
 end if;
end $$;
