begin;
-- 화면의 표시명·숨김 상태만 저장한다. 직원 정보와 사용자 추가 헤더/입력값은 수정하지 않는다.
create table public.employee_roster_header_settings (
  company_id uuid not null references public.companies(id),
  header_key text not null check (char_length(header_key) between 1 and 80 and header_key ~ '^([a-zA-Z][a-zA-Z0-9]*|column:[a-zA-Z0-9-]+)$'),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  hidden boolean not null default false,
  primary key (company_id,header_key)
);
alter table public.employee_roster_header_settings enable row level security;
revoke all on public.employee_roster_header_settings from public,anon,authenticated;
grant select,insert,update on public.employee_roster_header_settings to authenticated;
create policy roster_headers_read on public.employee_roster_header_settings for select to authenticated using (
  company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
);
create policy roster_headers_insert on public.employee_roster_header_settings for insert to authenticated with check (
  ((select app.can_edit_org_assignment()) or app.basic_work_allowed('operations'))
  and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
);
create policy roster_headers_update on public.employee_roster_header_settings for update to authenticated using (
  ((select app.can_edit_org_assignment()) or app.basic_work_allowed('operations'))
  and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
) with check (
  ((select app.can_edit_org_assignment()) or app.basic_work_allowed('operations'))
  and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
);
commit;
