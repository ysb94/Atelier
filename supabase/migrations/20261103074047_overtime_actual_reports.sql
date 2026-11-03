-- Append-only employee reports. Existing requests, attendance and permissions are unchanged.
create table public.overtime_actual_reports (
 request_id uuid not null references public.company_leave_requests(id),
 revision bigint not null check(revision>0),
 start_at timestamptz not null,
 end_at timestamptz not null,
 break_minutes integer not null check(break_minutes>=0),
 saved_at timestamptz not null default clock_timestamp(),
 primary key(request_id,revision),
 check(end_at>start_at and end_at-start_at<=interval '24 hours'),
 check(break_minutes<=floor(extract(epoch from end_at-start_at)/60))
);
alter table public.overtime_actual_reports enable row level security;
revoke all on public.overtime_actual_reports from public,anon,authenticated;
grant select,insert on public.overtime_actual_reports to authenticated;
create policy overtime_actual_read on public.overtime_actual_reports for select to authenticated using (
 exists(select 1 from public.company_leave_requests r where r.id=request_id)
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active')
);
create policy overtime_actual_create on public.overtime_actual_reports for insert to authenticated with check (
 exists(select 1 from public.company_leave_requests r join public.profiles p on p.id=(select auth.uid())
 where r.id=request_id and r.employee_id=p.id and r.company_id=p.company_id and p.status='active' and r.kind='overtime' and r.status='approved')
);
create function app.guard_overtime_actual() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.company_leave_requests%rowtype; current_revision bigint; approved_start timestamptz; approved_end timestamptz;
begin
 -- Match request transitions' employee lock without requiring UPDATE rights on an approved request.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.company_leave_requests where id=new.request_id;
 if not found or r.employee_id is distinct from auth.uid() or r.kind<>'overtime' or r.status<>'approved'
   or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and p.company_id=r.company_id)
 then raise exception '본인의 승인된 야근에만 실제 시간을 입력할 수 있습니다.' using errcode='42501'; end if;
 approved_start:=(r.from_date+r.start_time) at time zone 'Asia/Seoul';
 approved_end:=((r.to_date+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul';
 if r.from_date<>r.to_date or new.start_at<approved_start or new.end_at>approved_end or new.end_at>clock_timestamp()
   or new.start_at<>date_trunc('minute',new.start_at) or new.end_at<>date_trunc('minute',new.end_at)
 then raise exception '승인된 야근 시간 안에서 실제로 근무한 시각을 분 단위로 입력해 주세요. 미래 시간은 등록할 수 없습니다.' using errcode='23514'; end if;
 select coalesce(max(revision),0) into current_revision from public.overtime_actual_reports where request_id=r.id;
 if new.revision<>current_revision+1 then raise exception '기록이 변경됐습니다. 다시 불러와 주세요.' using errcode='40001'; end if;
 new.saved_at:=clock_timestamp();
 return new;
end $$;
revoke all on function app.guard_overtime_actual() from public,anon,authenticated;
create trigger overtime_actual_guard before insert on public.overtime_actual_reports for each row execute function app.guard_overtime_actual();
create view public.overtime_actual_latest with(security_invoker=true) as
 select distinct on(request_id) * from public.overtime_actual_reports order by request_id,revision desc;
revoke all on public.overtime_actual_latest from public,anon,authenticated;
grant select on public.overtime_actual_latest to authenticated;
create function public.save_overtime_actual(p_request uuid,p_start timestamptz,p_end timestamptz,p_break integer,p_revision bigint)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_revision is null or p_revision<0 then raise exception '기록을 다시 불러와 주세요.' using errcode='40001'; end if;
 insert into public.overtime_actual_reports(request_id,revision,start_at,end_at,break_minutes) values(p_request,p_revision+1,p_start,p_end,p_break);
end $$;
revoke all on function public.save_overtime_actual(uuid,timestamptz,timestamptz,integer,bigint) from public,anon;
grant execute on function public.save_overtime_actual(uuid,timestamptz,timestamptz,integer,bigint) to authenticated;
notify pgrst,'reload schema';
