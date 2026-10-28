-- Ordinary leave reminders only. No balance reset/deduction or existing ACL/RLS changes.
create table app.leave_notice_settings (
  company_id uuid primary key references public.companies(id),
  enabled boolean not null default false,
  enabled_at timestamptz
);
alter table app.leave_notice_settings enable row level security;
revoke all on app.leave_notice_settings from public, anon, authenticated;

-- Bind a manually registered balance to its actual hire cycle; never carry it into a new year.
create table app.leave_notice_balance_cycles (
  employee_id uuid primary key references public.profiles(id),
  company_id uuid not null references public.companies(id),
  hire_date date not null,
  expires_on date not null,
  recorded_at timestamptz not null default now()
);
alter table app.leave_notice_balance_cycles enable row level security;
revoke all on app.leave_notice_balance_cycles from public, anon, authenticated;

create table public.leave_usage_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.profiles(id),
  recipient_name text not null,
  hire_date date not null,
  reset_date date not null,
  expires_on date not null,
  phase text not null check (phase in ('threeMonths','oneMonth','twoWeeks')),
  scheduled_on date not null,
  remaining_days numeric(7,2) not null check (remaining_days > 0),
  title text not null,
  body text not null,
  issued_at timestamptz not null default now(),
  read_at timestamptz,
  viewed_at timestamptz,
  confirmed_at timestamptz,
  confirmed_session_id uuid,
  unique(company_id, employee_id, expires_on, phase),
  check (expires_on = reset_date - 1),
  check (scheduled_on <= expires_on),
  check (read_at is null or read_at >= issued_at),
  check (viewed_at is null or (read_at is not null and viewed_at >= read_at)),
  check (confirmed_at is null or (viewed_at is not null and confirmed_at >= viewed_at and confirmed_session_id is not null))
);
create index leave_usage_notices_employee_issued on public.leave_usage_notices(employee_id, issued_at desc);
create index leave_usage_notices_company_expiry on public.leave_usage_notices(company_id, expires_on desc);
alter table public.leave_usage_notices enable row level security;
revoke all on public.leave_usage_notices from public, anon, authenticated;
grant select on public.leave_usage_notices to authenticated;
create policy leave_usage_notices_own_read on public.leave_usage_notices for select to authenticated
  using (employee_id = (select auth.uid()) and company_id = (select company_id from public.profiles where id = auth.uid() and status = 'active'));
comment on table public.leave_usage_notices is '일반 연차 사용 안내 원문과 서버 발송·읽음·열람·본인 확인 기록. 법정 사용촉진 절차와 별개.';

create function app.leave_notice_cycle(p_hire date, p_today date)
returns date language plpgsql immutable set search_path = '' as $$
declare y int; anniversary date;
begin
  if p_hire is null or p_today is null or p_hire > p_today then return null; end if;
  y := greatest(extract(year from p_today)::int, extract(year from p_hire)::int + 1);
  loop
    anniversary := make_date(y, extract(month from p_hire)::int, 1);
    anniversary := anniversary + least(extract(day from p_hire)::int, extract(day from anniversary + interval '1 month - 1 day')::int) - 1;
    exit when anniversary > p_today;
    y := y + 1;
  end loop;
  return anniversary;
end $$;
revoke all on function app.leave_notice_cycle(date,date) from public,anon,authenticated;

create function app.capture_leave_notice_balance_cycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare h date; c uuid; reset_on date;
begin
  select hire_date, company_id into h,c from public.profiles where id = new.profile_id;
  reset_on := app.leave_notice_cycle(h,(now() at time zone 'Asia/Seoul')::date);
  if reset_on is not null and new.remaining_annual_leave is not null then
    insert into app.leave_notice_balance_cycles(employee_id,company_id,hire_date,expires_on)
      values(new.profile_id,c,h,reset_on-1)
      on conflict(employee_id) do update set company_id=excluded.company_id,hire_date=excluded.hire_date,expires_on=excluded.expires_on,recorded_at=now();
  end if;
  return new;
end $$;
revoke all on function app.capture_leave_notice_balance_cycle() from public,anon,authenticated;
create trigger capture_leave_notice_balance_cycle after insert or update of remaining_annual_leave
on public.employee_roster for each row execute function app.capture_leave_notice_balance_cycle();

create function app.dispatch_leave_usage_notices()
returns integer language plpgsql security definer set search_path = '' as $$
declare added int; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- A cron-only worker: no client grant and no user-supplied employee/date/balance.
  with candidates as (
    select p.id,p.company_id,coalesce(nullif(btrim(p.display_name),''),'직원') as recipient_name,p.hire_date,
      r.remaining_annual_leave as remaining_days, app.leave_notice_cycle(p.hire_date,today) as reset_date
    from public.profiles p join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
    join app.leave_notice_settings s on s.company_id=p.company_id and s.enabled
    where p.status='active' and p.hire_date<=today and r.remaining_annual_leave>0
      and r.resigned_on is null
  ), due as (
    select c.*, c.reset_date-1 as expires_on, stage.phase,stage.scheduled_on
    from candidates c
    join app.leave_notice_balance_cycles b on b.employee_id=c.id and b.company_id=c.company_id and b.hire_date=c.hire_date and b.expires_on=c.reset_date-1
    cross join lateral (
      select v.phase,v.scheduled_on from (values
        ('threeMonths', ((c.reset_date-1)-interval '3 months')::date),
        ('oneMonth', ((c.reset_date-1)-interval '1 month')::date),
        ('twoWeeks', c.reset_date-15)
      ) v(phase,scheduled_on) where v.scheduled_on<=today and v.scheduled_on>=c.hire_date
      order by v.scheduled_on desc limit 1
    ) stage
  )
  insert into public.leave_usage_notices(company_id,employee_id,recipient_name,hire_date,reset_date,expires_on,phase,scheduled_on,remaining_days,title,body)
  select company_id,id,recipient_name,hire_date,reset_date,expires_on,phase,scheduled_on,remaining_days,
    case phase when 'threeMonths' then '연차 사용 안내' when 'oneMonth' then '연차 사용 재안내' else '연차 사용기한 임박 안내' end,
    '안녕하세요. E&J 운영지원팀입니다.'||chr(10)||chr(10)||recipient_name||'님, 연차 사용기한까지 '||(expires_on-today)::text||'일 남아 안내드립니다.'||chr(10)||chr(10)||
    '남은 연차: '||rtrim(rtrim(to_char(remaining_days,'FM999990.00'),'0'),'.')||'일'||chr(10)||'사용기한: '||to_char(expires_on,'YYYY년 MM월 DD일')||'까지'||chr(10)||chr(10)||
    '업무 일정에 맞춰 사용기한 내 남은 연차를 사용해 주시기 바랍니다.'||chr(10)||chr(10)||
    '잔여 연차와 사용기한을 확인하신 후 아래 ‘확인하고 닫기’ 버튼을 눌러 주세요.'||chr(10)||
    '문의사항이 있으시면 운영지원팀으로 연락해 주세요.'||chr(10)||chr(10)||'감사합니다.'||chr(10)||'E&J 운영지원팀'
  from due on conflict(company_id,employee_id,expires_on,phase) do nothing;
  get diagnostics added = row_count;
  return added;
end $$;
revoke all on function app.dispatch_leave_usage_notices() from public,anon,authenticated;

create function app.record_leave_usage_notice(p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); company uuid; session uuid;
begin
  select company_id into company from public.profiles where id=actor and status='active';
  if actor is null or company is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_action not in ('read','view','confirm') or p_action is null then raise exception '올바르지 않은 처리입니다.'; end if;
  -- Existing account-switch sessions must never be accepted as employee acknowledgements.
  if exists(select 1 from public.impersonation_events where target_id=actor and ended_at is null) then
    raise exception '직원 계정 전환 중에는 본인 확인 기록을 남길 수 없습니다. 전환을 종료한 후 직원 본인 계정으로 로그인해 주세요.' using errcode='42501';
  end if;
  if p_action='confirm' then
    session := nullif(auth.jwt()->>'session_id','')::uuid;
    if session is null or not exists(select 1 from auth.sessions where id=session and user_id=actor) then
      raise exception '본인 로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.' using errcode='42501';
    end if;
  end if;
  if p_id is null and p_action<>'read' then raise exception '안내문을 선택해 주세요.'; end if;
  if p_id is not null and not exists(select 1 from public.leave_usage_notices where id=p_id and employee_id=actor and company_id=company) then
    raise exception '본인 안내문만 확인할 수 있습니다.' using errcode='42501';
  end if;
  if p_action='confirm' and not exists(select 1 from public.leave_usage_notices where id=p_id and viewed_at is not null) then
    raise exception '안내문을 먼저 열람해 주세요.';
  end if;
  update public.leave_usage_notices set
    read_at=coalesce(read_at,now()),
    viewed_at=case when p_action in ('view','confirm') then coalesce(viewed_at,now()) else viewed_at end,
    confirmed_at=case when p_action='confirm' then coalesce(confirmed_at,now()) else confirmed_at end,
    confirmed_session_id=case when p_action='confirm' then coalesce(confirmed_session_id,session) else confirmed_session_id end
  where employee_id=actor and company_id=company and (p_id is null or id=p_id);
end $$;
revoke all on function app.record_leave_usage_notice(uuid,text) from public,anon,authenticated;
grant execute on function app.record_leave_usage_notice(uuid,text) to authenticated;
create function public.record_leave_usage_notice(p_id uuid, p_action text)
returns void language sql security invoker set search_path = '' as $$select app.record_leave_usage_notice(p_id,p_action)$$;
revoke all on function public.record_leave_usage_notice(uuid,text) from public,anon,authenticated;
grant execute on function public.record_leave_usage_notice(uuid,text) to authenticated;

create function app.leave_usage_notice_management()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare company uuid; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null or not coalesce(app.can_edit_org_assignment(),false) then raise exception '명부 관리 권한이 필요합니다.' using errcode='42501'; end if;
  return jsonb_build_object('today',today,'enabled',coalesce((select enabled from app.leave_notice_settings where company_id=company),false),
    'employees',coalesce((select jsonb_agg(x order by x.display_name) from (
      select p.id,p.display_name,coalesce(d.name,'소속 없음') as department,p.hire_date,
        app.leave_notice_cycle(p.hire_date,today) as reset_date,r.remaining_annual_leave as remaining_days,
        r.resigned_on,
        coalesce(b.hire_date=p.hire_date and b.expires_on=app.leave_notice_cycle(p.hire_date,today)-1,false) as balance_current
      from public.profiles p left join public.departments d on d.id=p.department_id
      left join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
      left join app.leave_notice_balance_cycles b on b.employee_id=p.id and b.company_id=p.company_id
      where p.company_id=company and p.status='active'
    ) x),'[]'::jsonb),
    'notices',coalesce((select jsonb_agg(to_jsonb(n)-'confirmed_session_id' order by issued_at desc) from public.leave_usage_notices n where company_id=company),'[]'::jsonb));
end $$;
revoke all on function app.leave_usage_notice_management() from public,anon,authenticated;
grant execute on function app.leave_usage_notice_management() to authenticated;
create function public.leave_usage_notice_management()
returns jsonb language sql stable security invoker set search_path = '' as $$select app.leave_usage_notice_management()$$;
revoke all on function public.leave_usage_notice_management() from public,anon,authenticated;
grant execute on function public.leave_usage_notice_management() to authenticated;

-- Activation is separate: no employees are notified while this schema is being installed.
