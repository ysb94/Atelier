begin;
create table app.offsite_write_context (
 transaction_id bigint primary key, actor_id uuid not null, employee_id uuid not null, operation text not null
);
alter table app.offsite_write_context enable row level security;
revoke all on app.offsite_write_context from public,anon,authenticated;
create table public.offsite_groups (
 id uuid primary key, company_id uuid not null references public.companies(id), created_by uuid not null references public.profiles(id),
 payload jsonb not null, created_at timestamptz not null default now(), unique(created_by,id)
);
alter table public.offsite_groups enable row level security;
revoke all on public.offsite_groups from public,anon,authenticated;
alter table public.company_leave_requests add column offsite_group_id uuid references public.offsite_groups(id);
create unique index offsite_group_employee on public.company_leave_requests(offsite_group_id,employee_id) where offsite_group_id is not null;
create table app.offsite_start_changes (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null, request_id uuid not null, actor_id uuid not null,
 before_start time, after_start time, changed_at timestamptz not null default now()
);
alter table app.offsite_start_changes enable row level security;
revoke all on app.offsite_start_changes from public,anon,authenticated;
-- A private transaction context is writable only by the checked RPCs, never by browser claims/settings.
do $$declare source text; needle text; begin
 source:=pg_get_functiondef('app.guard_company_leave_request()'::regprocedure);
 needle:='select * into actor from public.profiles where id = auth.uid() and status = ''active'';';
 if position(needle in source)=0 then raise exception 'Unexpected leave guard: review migration'; end if;
 source:=replace(source,needle,$patch$
 if TG_OP='UPDATE' and exists(select 1 from app.offsite_write_context x where x.transaction_id=txid_current() and x.actor_id=auth.uid() and x.employee_id=old.employee_id and x.operation='start') then
   if old.employee_id<>auth.uid() or old.kind<>'offsite' or old.status<>'approved' or (to_jsonb(new)-'offsite_work_start') is distinct from (to_jsonb(old)-'offsite_work_start') then raise exception '본인 출근 기준만 변경할 수 있습니다.'; end if;
   return new;
 end if;
 select * into actor from public.profiles where id=coalesce(
   (select x.employee_id from app.offsite_write_context x where x.transaction_id=txid_current() and x.actor_id=auth.uid() and x.operation='group' and TG_OP='INSERT' and new.kind='offsite'),auth.uid()) and status='active';
 $patch$);
 execute source;
 -- The existing trigger is invoker; checked context lookup must not grant context access to clients.
 alter function app.guard_company_leave_request() security definer;
 alter function app.guard_company_leave_request() set search_path='';
 source:=pg_get_functiondef('app.guard_offsite_workday_start()'::regprocedure);
 needle:='if tg_op=''UPDATE'' then';
 if position(needle in source)=0 then raise exception 'Unexpected workday guard'; end if;
 source:=replace(source,needle,$patch$
 if tg_op='UPDATE' and exists(select 1 from app.offsite_write_context x where x.transaction_id=txid_current() and x.actor_id=auth.uid() and x.employee_id=old.employee_id and x.operation='start') then return new; end if;
 if tg_op='UPDATE' then
 $patch$);
 execute source;
end $$;
create function app.guard_offsite_group_link() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if new.offsite_group_id is distinct from old.offsite_group_id then raise exception '단체 외근 연결은 변경할 수 없습니다.'; end if;
 elsif new.offsite_group_id is not null and not exists(select 1 from app.offsite_write_context x where x.transaction_id=txid_current() and x.actor_id=auth.uid() and x.employee_id=new.employee_id and x.operation='group') then
   raise exception '단체 외근 등록 기능을 이용해 주세요.' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function app.guard_offsite_group_link() from public,anon,authenticated;
create trigger zz_offsite_group_link before insert or update on public.company_leave_requests for each row execute function app.guard_offsite_group_link();
create function app.register_offsite_group(p_id uuid,p_employees uuid[],p_form jsonb) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare actor public.profiles%rowtype; member public.profiles%rowtype; prior public.offsite_groups%rowtype; target uuid; ids uuid[]; payload jsonb;
begin
 select * into actor from public.profiles where id=auth.uid() and status='active';
 if actor.id is null then raise exception '재직 중인 직원만 등록할 수 있습니다.' using errcode='42501'; end if;
 select array_agg(distinct x order by x) into ids from unnest(p_employees) x where x is not null;
 if coalesce(cardinality(ids),0)=0 then raise exception '참여 직원을 선택해 주세요.'; end if;
 payload:=jsonb_build_object('employees',to_jsonb(ids),'form',p_form);
 perform pg_advisory_xact_lock(hashtextextended('offsite-group:'||p_id::text,0));
 select * into prior from public.offsite_groups where id=p_id;
 if found then
   if prior.created_by<>actor.id or prior.payload<>payload then raise exception '같은 등록 번호의 내용이 다릅니다. 목록을 확인해 주세요.'; end if;
   return p_id;
 end if;
 foreach target in array ids loop
   perform pg_advisory_xact_lock(hashtextextended(target::text,0));
   if not exists(select 1 from public.profiles where id=target and company_id=actor.company_id and status='active') then raise exception '참여 직원의 재직 상태를 다시 확인해 주세요.'; end if;
 end loop;
 insert into public.offsite_groups(id,company_id,created_by,payload) values(p_id,actor.company_id,actor.id,payload);
 foreach target in array ids loop
   select * into member from public.profiles where id=target;
   insert into app.offsite_write_context values(txid_current(),actor.id,target,'group');
   begin
     insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note,place,end_next_day,offsite_continuous,offsite_group_id)
     values(actor.company_id,target,'','','offsite',(p_form->>'from')::date,(p_form->>'to')::date,(p_form->>'start')::time,(p_form->>'end')::time,coalesce(p_form->>'note',''),p_form->>'place',coalesce((p_form->>'endNextDay')::boolean,false),coalesce((p_form->>'offsiteContinuous')::boolean,false),p_id);
   exception when others then
     raise exception '%: 일정이 겹치거나 외근 입력 조건을 충족하지 않습니다. 전체 등록을 보류했습니다.',member.display_name using errcode='23514', detail=case when SQLERRM like '%같은 시간%' then '같은 시간에 기존 신청이 있습니다.' else '날짜·시간·장소와 근무 기준을 확인해 주세요.' end;
   end;
   delete from app.offsite_write_context where transaction_id=txid_current();
 end loop;
 if actor.id=any(ids) and nullif(p_form->>'offsiteWorkStart','') is not null then perform app.set_my_offsite_start((select id from public.company_leave_requests where offsite_group_id=p_id and employee_id=actor.id),(p_form->>'offsiteWorkStart')::time); end if;
 return p_id;
end $$;
create function public.register_offsite_group(p_id uuid,p_employees uuid[],p_form jsonb) returns uuid language sql security invoker set search_path='' as $$select app.register_offsite_group(p_id,p_employees,p_form)$$;
create function app.set_my_offsite_start(p_request uuid,p_start time) returns void language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare r public.company_leave_requests%rowtype; actor uuid:=auth.uid(); item public.company_leave_requests%rowtype;
begin
 if not exists(select 1 from public.profiles where id=actor and status='active') then raise exception '재직 계정을 확인해 주세요.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 select * into r from public.company_leave_requests where id=p_request and employee_id=actor and company_id=(select company_id from public.profiles where id=actor) and kind='offsite' and status='approved';
 if not found then raise exception '본인의 유효한 외근만 변경할 수 있습니다.' using errcode='42501'; end if;
 if r.from_date<(clock_timestamp() at time zone 'Asia/Seoul')::date or (r.from_date<>r.to_date and not r.offsite_continuous) then raise exception '오늘 이후 외근의 시작일만 변경할 수 있습니다.'; end if;
 if p_start is not null and (p_start>=time '24:00' or extract(second from p_start)<>0 or app.attendance_start_for_date(actor,r.from_date) is null or not exists(select 1 from public.attendance_start_options where company_id=r.company_id and start_time=p_start)) then raise exception '근무 기준과 회사 출근시간 선택지를 확인해 주세요.'; end if;
 if exists(select 1 from public.offsite_settlements s join public.company_leave_requests x on x.id=s.request_id where x.employee_id=actor and x.from_date=r.from_date) then raise exception '후처리된 외근의 기준은 변경할 수 없습니다.'; end if;
 insert into app.offsite_write_context values(txid_current(),actor,actor,'start');
 for item in select * from public.company_leave_requests where employee_id=actor and company_id=r.company_id and kind='offsite' and status='approved' and from_date=r.from_date and (from_date=to_date or offsite_continuous) order by id for update loop
   if item.offsite_work_start is distinct from p_start then
     insert into app.offsite_start_changes(employee_id,request_id,actor_id,before_start,after_start) values(actor,item.id,actor,item.offsite_work_start,p_start);
     update public.company_leave_requests set offsite_work_start=p_start where id=item.id;
   end if;
 end loop;
 delete from app.offsite_write_context where transaction_id=txid_current();
end $$;
create function public.set_my_offsite_start(p_request uuid,p_start time) returns void language sql security invoker set search_path='' as $$select app.set_my_offsite_start(p_request,p_start)$$;
create function app.my_offsite_groups() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'createdBy',g.created_by,'createdByName',p.display_name,'createdAt',g.created_at,'participants',(
 select jsonb_agg(jsonb_build_object('requestId',r.id,'name',r.employee_name,'state',case when r.status='cancelled' then '취소' when c.clock_out_at is not null then '퇴근' when d.returned_at is not null then '복귀' when now()<((r.from_date+r.start_time) at time zone 'Asia/Seoul') then '예정' when now()<app.offsite_finish(r,r.from_date) then '외근 중' else '자동 퇴근 대기' end) order by r.employee_name)
 from public.company_leave_requests r left join app.offsite_attendance_days d on d.employee_id=r.employee_id and d.work_date=r.from_date left join public.attendance_clock_ins c on c.employee_id=r.employee_id and c.work_date=r.from_date where r.offsite_group_id=g.id and (g.created_by=auth.uid() or r.employee_id=auth.uid())) ) order by g.created_at desc),'[]'::jsonb)
 from public.offsite_groups g join public.profiles p on p.id=g.created_by
 where g.company_id=(select company_id from public.profiles where id=auth.uid() and status='active') and (g.created_by=auth.uid() or exists(select 1 from public.company_leave_requests r where r.offsite_group_id=g.id and r.employee_id=auth.uid()));
$$;
create function public.my_offsite_groups() returns jsonb language sql stable security invoker set search_path='' as $$select app.my_offsite_groups()$$;
-- Preserve the installed notification composition, including offsite settlement and meeting work.
do $$declare source text; begin
 source:=pg_get_functiondef('public.list_my_home_work_notifications()'::regprocedure);
 source:=replace(source,'public.list_my_home_work_notifications()','app.home_notifications_before_offsite_groups()');
 execute source;
end $$;
create or replace function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$
 select app.home_notifications_before_offsite_groups() || coalesce((select jsonb_agg(jsonb_build_object(
 'event_key','offsite-group:'||r.id,'entity_id',r.id,'created_at',g.created_at,'event_type','offsite-group','tab','my-attendance','kind','offsite',
 'employee_name',p.display_name,'from_date',r.from_date,'to_date',r.to_date,'start_time',r.start_time,'end_time',r.end_time,'note',r.note,'decision_note',null,
 'action_needed',false,'status',r.status,'current',r.status='approved','read_at',reads.read_at))
 from public.company_leave_requests r join public.offsite_groups g on g.id=r.offsite_group_id join public.profiles p on p.id=g.created_by
 left join public.my_home_notification_reads reads on reads.reader_id=auth.uid() and reads.event_key='offsite-group:'||r.id
 where r.employee_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and company_id=g.company_id and status='active')),'[]'::jsonb);
$$;
grant select(id,company_id,created_by,created_at) on public.offsite_groups to authenticated;
create policy offsite_groups_read on public.offsite_groups for select to authenticated using(company_id=(select company_id from public.profiles where id=auth.uid() and status='active') and (created_by=auth.uid() or exists(select 1 from public.company_leave_requests r where r.offsite_group_id=offsite_groups.id and r.employee_id=auth.uid())));
revoke all on function app.register_offsite_group(uuid,uuid[],jsonb),app.set_my_offsite_start(uuid,time),app.my_offsite_groups(),app.home_notifications_before_offsite_groups(),public.register_offsite_group(uuid,uuid[],jsonb),public.set_my_offsite_start(uuid,time),public.my_offsite_groups() from public,anon,authenticated;
grant execute on function app.register_offsite_group(uuid,uuid[],jsonb),app.set_my_offsite_start(uuid,time),app.my_offsite_groups(),app.home_notifications_before_offsite_groups(),public.register_offsite_group(uuid,uuid[],jsonb),public.set_my_offsite_start(uuid,time),public.my_offsite_groups() to authenticated;
commit;
