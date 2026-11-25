create role anon;
create role authenticated;
create schema app;
create schema auth;
grant usage on schema public,app,auth to anon,authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function fixture_id(n int) returns uuid language sql immutable as $$
  select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function fixture_today() returns date language sql stable as $$select (now() at time zone 'Asia/Seoul')::date$$;
create table companies(id uuid primary key);
insert into companies values ('e0000000-0000-4000-8000-000000000001'),(fixture_id(91));
create table departments(id uuid primary key,company_id uuid,is_active boolean default true);
create table department_workforce_policies(department_id uuid primary key,company_id uuid,mode text);
create table profiles(id uuid primary key,company_id uuid,department_id uuid,status text);
insert into profiles select fixture_id(n),case when n=5 then fixture_id(91) else 'e0000000-0000-4000-8000-000000000001'::uuid end,
  case n when 3 then 'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e'::uuid
         when 4 then 'bf926822-910c-422f-9c17-5fd3d8ddb3ba'::uuid else fixture_id(90) end,
  case when n=7 then 'inactive' else 'active' end from generate_series(1,25) n;
insert into departments(id,company_id) select distinct department_id,company_id from profiles where company_id<>fixture_id(91);
create function app.permission_company_id() returns uuid language sql stable security definer set search_path='' as $$
  select company_id from public.profiles where id=auth.uid() and status='active'
$$;
create function app.can_edit_org_assignment() returns boolean language sql stable as $$select auth.uid()=public.fixture_id(2)$$;
create function app.is_operations_department_member() returns boolean language sql stable as $$select auth.uid()=public.fixture_id(2)$$;
create function app.company_review_company_id() returns uuid language sql stable as $$select null::uuid$$;
create table company_leave_requests(id uuid primary key,company_id uuid not null,employee_id uuid not null,department_id uuid,
  employee_name text default 'fixture',kind text,from_date date,to_date date,start_time time default '09:00',
  end_time time default '19:00',end_next_day boolean default false,note text,decision_note text,
  status text,decided_at timestamptz,decided_by uuid,created_at timestamptz default now(),advance_requested boolean default false);
create index requests_employee_created on company_leave_requests(employee_id,created_at desc);
alter table company_leave_requests enable row level security;
create policy read_requests on company_leave_requests for select to authenticated using
  (company_id=(select app.permission_company_id()) and (employee_id=(select auth.uid()) or decided_by=(select auth.uid())
    or (select app.can_edit_org_assignment()) or auth.uid()=fixture_id(25)));
create table attendance_clock_ins(company_id uuid,employee_id uuid,work_date date,clock_in time default '09:00',
  clock_out_at timestamptz,clock_out_reported_at timestamptz,auto_closed_at timestamptz,work_confirmed_at timestamptz,
  offsite_returned_at timestamptz,clock_in_source text,clock_out_source text,primary key(employee_id,work_date));
alter table attendance_clock_ins enable row level security;
create policy read_clocks on attendance_clock_ins for select to authenticated using (employee_id=(select auth.uid()));
create table attendance_exemptions(profile_id uuid primary key);
create table late_arrival_statements(id uuid primary key, employee_id uuid);
create table app.holiday_work_days(id uuid primary key,employee_id uuid);
create table fixture_deliveries(ordinal bigint generated always as identity primary key,recipient uuid,payload jsonb);
alter table fixture_deliveries enable row level security;
create policy read_deliveries on fixture_deliveries for select to authenticated using (recipient=(select auth.uid()));
grant select on profiles,company_leave_requests,attendance_clock_ins,attendance_exemptions,fixture_deliveries to authenticated;

-- Closed historical days with sparse old and current open records. Raw and
-- effective checkouts differ for offsite overtime and approved corrections.
insert into attendance_clock_ins(company_id,employee_id,work_date,clock_out_at,clock_out_source)
  select company_id,id,fixture_today()-i,case when i in (1,4,8) then null else now() end,
    case when i=8 then 'offsite' else 'manual' end
  from profiles cross join generate_series(0,29) i where id in(fixture_id(1),fixture_id(2),fixture_id(3),fixture_id(4));
update attendance_clock_ins set auto_closed_at=now() where work_date in(fixture_today()-4,fixture_today()-8);
insert into company_leave_requests(id,company_id,employee_id,department_id,kind,from_date,to_date,note,status,created_at)
  select fixture_id(1000+series),p.company_id,p.id,p.department_id,'overtime',
    fixture_today()-10,fixture_today()-10,'fixture '||series,'pending',now()-series*interval '1 minute'
  from generate_series(1,160) series join profiles p on p.id=fixture_id(
    case series%6 when 0 then 1 when 1 then 3 when 2 then 4 else 8+series%16 end);
insert into company_leave_requests(id,company_id,employee_id,department_id,kind,from_date,to_date,status)
  select fixture_id(500),company_id,id,department_id,'overtime',fixture_today()-8,fixture_today()-8,'approved'
  from profiles where id=fixture_id(1);
insert into app.holiday_work_days select fixture_id(700),fixture_id(1);
insert into fixture_deliveries(recipient,payload)
  select fixture_id(2),jsonb_build_object('event_key',event,'entity_id',entity,'event_type','holiday-settle',
    'tab','holiday-work','current',true,'created_at',now(),'action_needed',true,'action_key','holiday:'||entity,'read_at',null)
  from (values ('holiday-visible',fixture_id(700)::text),('external',fixture_id(1002)::text),
    ('logistics',fixture_id(1001)::text),('legacy-null',null),('legacy-invalid','pre-uuid-date')) events(event,entity);
-- Multiple versions and a repeated action identity on one work item are
-- intentional. Deduplicating eligibility must never deduplicate these events.
insert into fixture_deliveries(recipient,payload)
  select fixture_id(2),jsonb_build_object('event_key','holiday-version-'||n,'entity_id',fixture_id(700),
    'event_type','holiday-settle','tab','holiday-work','current',n>9,'created_at',now(),'action_needed',true,
    'action_key','holiday:'||fixture_id(700),'read_at',case when n<5 then now() end)
  from generate_series(1,12) n;
