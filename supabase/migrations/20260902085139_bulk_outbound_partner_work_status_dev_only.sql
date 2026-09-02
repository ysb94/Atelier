-- 대량출고 업체 상태(대기·작업중·완료)는 개발자 계정만 바꾼다.
-- 다른 구성원이 업체 목록을 저장해도 기존 상태를 덮지 않는다.

create or replace function app.is_dev_login()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (
        p.id = 'd0000000-0000-4000-8000-000000000001'::uuid
        or lower(p.email) = 'dev@atelier.local'
      )
  );
$function$;

revoke all on function app.is_dev_login() from public, anon, authenticated;

create or replace function app.keep_bulk_outbound_partner_work_status()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
begin
  if app.is_dev_login() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.work_status := 'idle';
  elsif tg_op = 'UPDATE' then
    new.work_status := old.work_status;
  end if;
  return new;
end;
$function$;

revoke all on function app.keep_bulk_outbound_partner_work_status() from public, anon, authenticated;

drop trigger if exists bulk_outbound_partner_configs_work_status_guard
  on public.bulk_outbound_partner_configs;
create trigger bulk_outbound_partner_configs_work_status_guard
before insert or update on public.bulk_outbound_partner_configs
for each row execute function app.keep_bulk_outbound_partner_work_status();

comment on function app.is_dev_login() is
  '개발 로그인 계정(dev@atelier.local)인지. 업체 상태 변경에만 쓴다.';
