-- Concurrent transactions can start before another tab records read/view. Preserve monotonic first timestamps.
create or replace function app.record_leave_usage_notice(p_id uuid, p_action text)
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
    viewed_at=case when p_action in ('view','confirm') then coalesce(viewed_at,greatest(now(),read_at)) else viewed_at end,
    confirmed_at=case when p_action='confirm' then coalesce(confirmed_at,greatest(now(),viewed_at,read_at)) else confirmed_at end,
    confirmed_session_id=case when p_action='confirm' then coalesce(confirmed_session_id,session) else confirmed_session_id end
  where employee_id=actor and company_id=company and (p_id is null or id=p_id);
end $$;
