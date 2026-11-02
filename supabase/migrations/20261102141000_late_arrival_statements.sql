begin;

create table public.late_arrival_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.profiles(id),
  work_date date not null,
  department_name text not null,
  employee_name text not null,
  position_name text not null,
  baseline_time time not null,
  actual_time time not null,
  late_minutes integer not null check (late_minutes > 0),
  prior_approval text not null,
  reason_kind text not null,
  detail text not null,
  prevention text not null,
  written_on date not null,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

comment on table public.late_arrival_statements is '지각 출근 때 직원이 사이트에서 작성한 지각 사유서. 출근 기록과 날짜로 연결된다.';

create index late_arrival_statements_company_date on public.late_arrival_statements(company_id, work_date);
alter table public.late_arrival_statements enable row level security;
revoke all on public.late_arrival_statements from public, anon, authenticated;
grant select on public.late_arrival_statements to authenticated;

create policy late_arrival_statement_read on public.late_arrival_statements for select to authenticated
using (
  employee_id = (select auth.uid())
  or (
    company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
    and ((select app.can_edit_org_assignment()) or company_id = (select app.company_review_company_id()))
  )
);

create function app.save_my_late_statement(p_prior text, p_reason text, p_detail text, p_prevention text)
returns public.late_arrival_statements
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  person public.profiles%rowtype;
  department_name text;
  today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
  clock_in time;
  start_at time;
  minutes integer;
  saved public.late_arrival_statements%rowtype;
  prior text := btrim(coalesce(p_prior, ''));
  reason text := btrim(coalesce(p_reason, ''));
  detail text := btrim(coalesce(p_detail, ''));
  prevention text := btrim(coalesce(p_prevention, ''));
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select * into person from public.profiles where id = actor and status = 'active';
  if person.id is null then raise exception '재직 중인 직원만 사유서를 제출할 수 있습니다.'; end if;
  if prior = '' or reason = '' or detail = '' or prevention = '' then raise exception '사전 승인, 사유 구분, 상세 사유, 재발 방지 대책을 입력해 주세요.'; end if;
  if char_length(prior) > 40 or char_length(reason) > 40 or char_length(detail) > 1000 or char_length(prevention) > 1000 then
    raise exception '사유서 내용이 너무 깁니다.';
  end if;
  select c.clock_in into clock_in from public.attendance_clock_ins c where c.employee_id = actor and c.work_date = today;
  if clock_in is null then raise exception '오늘 출근을 먼저 기록해 주세요.'; end if;
  select s.start_time into start_at from public.attendance_start_settings s
    where s.company_id = person.company_id and s.month = date_trunc('month', today)::date
      and (s.employee_id = actor or (s.employee_id is null and s.department_id = person.department_id))
    order by (s.employee_id = actor) desc nulls last, s.updated_at desc, s.id
    limit 1;
  if start_at is null then raise exception '출근 기준이 없어 지각 사유서를 작성하지 않습니다.'; end if;
  minutes := floor(extract(epoch from (clock_in - start_at)) / 60)::integer;
  if minutes <= 5 then raise exception '지각이 아니라서 사유서가 필요하지 않습니다.'; end if;
  select coalesce(d.name, '소속 없음') into department_name from public.departments d where d.id = person.department_id;
  insert into public.late_arrival_statements(
    company_id, employee_id, work_date, department_name, employee_name, position_name,
    baseline_time, actual_time, late_minutes, prior_approval, reason_kind, detail, prevention, written_on
  ) values (
    person.company_id, actor, today, coalesce(department_name, '소속 없음'),
    coalesce(nullif(btrim(person.display_name), ''), '이름 없음'),
    coalesce(nullif(btrim(person.position), ''), '직위 미지정'),
    start_at, clock_in, minutes, prior, reason, detail, prevention, today
  )
  on conflict (employee_id, work_date) do update set
    prior_approval = excluded.prior_approval,
    reason_kind = excluded.reason_kind,
    detail = excluded.detail,
    prevention = excluded.prevention
  returning * into saved;
  return saved;
end;
$$;

revoke all on function app.save_my_late_statement(text, text, text, text) from public, anon, authenticated;
grant execute on function app.save_my_late_statement(text, text, text, text) to authenticated;

create function public.save_my_late_statement(p_prior text, p_reason text, p_detail text, p_prevention text)
returns public.late_arrival_statements
language sql security invoker set search_path = '' as $$
  select app.save_my_late_statement(p_prior, p_reason, p_detail, p_prevention);
$$;

revoke all on function public.save_my_late_statement(text, text, text, text) from public, anon;
grant execute on function public.save_my_late_statement(text, text, text, text) to authenticated;

commit;
