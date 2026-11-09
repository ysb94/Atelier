-- Additive; existing attendance records, approvals and policies are untouched.
create table app.attendance_start_reminders (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 department_id uuid not null references public.departments(id), target_month date not null,
 issued_on date, version bigint not null default 0, reads jsonb not null default '{}',
 current boolean not null default false,
 unique(company_id,department_id,target_month), check(extract(day from target_month)=1)
);
alter table app.attendance_start_reminders enable row level security;
revoke all on app.attendance_start_reminders from public,anon,authenticated;

create function app.attendance_reminder_head_office(p_employee uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare mode text;
begin
 if to_regprocedure('app.workforce_mode(uuid)') is not null then
  execute 'select app.workforce_mode($1)' into mode using p_employee;return mode='head-office';
 end if;
 return exists(select 1 from public.profiles p where p.id=p_employee and not (
  p.company_id='e0000000-0000-4000-8000-000000000001' and p.department_id in('bf926822-910c-422f-9c17-5fd3d8ddb3ba','c5d4cfca-97ce-4ca7-b30a-6beed842cf1e')));
end $$;

create function app.attendance_start_progress(p_company uuid,p_department uuid,p_month date)
returns table(total integer,missing integer,fingerprint text) language sql stable security definer set search_path='' as $$
 select count(*)::int,count(*) filter(where (case when i.id is not null then i.start_time else d.start_time end) is null)::int,
 md5(coalesce(string_agg(p.id::text,',' order by p.id) filter(where (case when i.id is not null then i.start_time else d.start_time end) is null),''))
 from public.profiles p
 left join public.attendance_start_settings i on i.company_id=p.company_id and i.employee_id=p.id and i.month=p_month
 left join public.attendance_start_settings d on d.company_id=p.company_id and d.department_id=p.department_id and d.employee_id is null and d.month=p_month
 where p.company_id=p_company and p.department_id=p_department and p.status='active'
 and app.attendance_reminder_head_office(p.id)
 and not exists(select 1 from public.attendance_exemptions e where e.company_id=p.company_id and e.profile_id=p.id);
$$;

-- No caller-controlled time. Only the server's clock can issue daily versions.
create function app.dispatch_attendance_start_reminders() returns integer
language plpgsql security definer set search_path='' as $$
declare stamp timestamp:=clock_timestamp() at time zone 'Asia/Seoul';today date:=stamp::date;
 next_month date:=(date_trunc('month',stamp)+interval '1 month')::date; r record; progress record; changed integer:=0;
begin
 if stamp::time<time '09:00' then return 0;end if;
 -- pg_cron retries/concurrent invocations must not issue a second daily version.
 if not pg_try_advisory_xact_lock(182574,903) then return 0;end if;
 if today>=next_month-7 then
  insert into app.attendance_start_reminders(company_id,department_id,target_month)
  select d.company_id,d.id,next_month from public.departments d where d.is_active
  on conflict(company_id,department_id,target_month) do nothing;
 end if;
 for r in select n.* from app.attendance_start_reminders n
  where n.current or n.target_month>=date_trunc('month',stamp)::date order by n.company_id,n.department_id,n.target_month
 loop
  select * into progress from app.attendance_start_progress(r.company_id,r.department_id,r.target_month);
  if not exists(select 1 from public.departments d where d.id=r.department_id and d.company_id=r.company_id and d.is_active) then progress.missing:=0;end if;
  if progress.missing>0 and (r.issued_on is distinct from today or not r.current) then
   update app.attendance_start_reminders set current=true,issued_on=today,version=version+1 where id=r.id;changed:=changed+1;
  elsif progress.missing=0 and r.current then
   update app.attendance_start_reminders set current=false where id=r.id;
  end if;
 end loop;
 return changed;
end $$;

create function app.list_my_attendance_start_reminders() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
 select * into actor from public.profiles where id=auth.uid() and status='active';
 if not found then raise exception '활성 계정이 필요합니다.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
  'id',n.id,'departmentId',n.department_id,'department',d.name,'month',to_char(n.target_month,'YYYY-MM'),
  'version',n.version::text||':'||p.fingerprint,'issuedAt',((n.issued_on+time '09:00') at time zone 'Asia/Seoul'),
  'readAt',case when n.reads->actor.id::text->>'version'=n.version::text||':'||p.fingerprint then n.reads->actor.id::text->>'at' else null end,
  'total',p.total,'missing',p.missing,'current',p.missing>0 and d.is_active and (n.current or n.target_month>=date_trunc('month',clock_timestamp() at time zone 'Asia/Seoul')::date),
  'overdue',(clock_timestamp() at time zone 'Asia/Seoul')::date>=n.target_month
 ) order by n.target_month,n.department_id),'[]') from app.attendance_start_reminders n
 join public.departments d on d.id=n.department_id and d.company_id=n.company_id
 cross join lateral app.attendance_start_progress(n.company_id,n.department_id,n.target_month) p
 where n.company_id=actor.company_id and n.issued_on is not null
 and (n.current or n.target_month>=date_trunc('month',clock_timestamp() at time zone 'Asia/Seoul')::date)
 and exists(select 1 from public.department_request_approvers a where a.company_id=n.company_id and a.department_id=n.department_id and actor.id in(a.approver_id,a.substitute_id)));
end $$;

create function app.read_attendance_start_reminder(p_id uuid,p_version text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update app.attendance_start_reminders n set reads=jsonb_set(n.reads,array[auth.uid()::text],jsonb_build_object('version',p_version,'at',clock_timestamp()))
 where n.id=p_id and n.version::text||':'||(select fingerprint from app.attendance_start_progress(n.company_id,n.department_id,n.target_month))=p_version and exists(select 1 from public.profiles p
  join public.department_request_approvers a on a.company_id=p.company_id and p.id in(a.approver_id,a.substitute_id)
  where p.id=auth.uid() and p.status='active' and a.company_id=n.company_id and a.department_id=n.department_id)
 and (n.reads->auth.uid()::text->>'version') is distinct from p_version;
 return found;
end $$;

create function public.list_my_attendance_start_reminders() returns jsonb language sql stable security invoker set search_path='' as $$select app.list_my_attendance_start_reminders()$$;
create function public.read_attendance_start_reminder(p_id uuid,p_version text) returns boolean language sql security invoker set search_path='' as $$select app.read_attendance_start_reminder(p_id,p_version)$$;
revoke all on function app.attendance_reminder_head_office(uuid),app.attendance_start_progress(uuid,uuid,date),app.dispatch_attendance_start_reminders(),app.list_my_attendance_start_reminders(),app.read_attendance_start_reminder(uuid,text),public.list_my_attendance_start_reminders(),public.read_attendance_start_reminder(uuid,text) from public,anon,authenticated;
grant execute on function app.list_my_attendance_start_reminders(),app.read_attendance_start_reminder(uuid,text),public.list_my_attendance_start_reminders(),public.read_attendance_start_reminder(uuid,text) to authenticated;
-- Only this new job is added. Existing schedules are unchanged.
select cron.schedule('atelier-attendance-start-reminders','0 0 * * *','select app.dispatch_attendance_start_reminders();');
select app.dispatch_attendance_start_reminders();
notify pgrst,'reload schema';
