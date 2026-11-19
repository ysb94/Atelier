-- Fix false impersonation blocks without changing notice/grant data, ACLs or RLS.
-- Shared DB application requires separate user approval.
begin;
do $preflight$
begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid='app.record_extra_leave_notice(uuid,text)'::regprocedure) is distinct from 'c961b60efc68a69789cd3613ac9f42dd' then
    raise exception '연차 안내 확인 함수가 준비한 기준과 다릅니다: record_extra_leave_notice';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid='app.record_leave_usage_notice(uuid,text)'::regprocedure) is distinct from 'b30c36ea13db4d35e91d89294fd35083' then
    raise exception '연차 안내 확인 함수가 준비한 기준과 다릅니다: record_leave_usage_notice';
  end if;
end $preflight$;

CREATE OR REPLACE FUNCTION app.record_extra_leave_notice(p_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();company uuid;session uuid;
begin
 select company_id into company from public.profiles where id=actor and status='active';
 if actor is null or company is null then raise exception '로그인이 필요합니다.' using errcode='42501';end if;
 if p_action is null or p_action not in ('read','view','confirm') then raise exception '올바르지 않은 처리입니다.';end if;
  -- Scope the receipt to the current, server-recorded login session. A different
  -- browser's open impersonation audit must not block the employee's own login.
  begin
    session := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception '본인 로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.' using errcode='42501';
  end;
  if session is null or not exists(select 1 from auth.sessions where id=session and user_id=actor) then
    raise exception '본인 로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.' using errcode='42501';
  end if;
  -- Atelier signs employees in through Google OAuth (password for the developer).
  -- Employee switching uses an admin magic link / OTP, even after its audit ends.
  -- Consult Auth's private AMR records, never client state or user_metadata.
  if not exists(select 1 from auth.mfa_amr_claims
      where session_id=session and authentication_method in ('oauth','password')) then
    raise exception '직원 계정 전환 세션에서는 본인 확인 기록을 남길 수 없습니다. 전환을 종료한 후 본인 계정으로 다시 로그인해 주세요.' using errcode='42501';
  end if;
 if p_id is null and p_action<>'read' then raise exception '안내문을 선택해 주세요.';end if;
 if p_id is not null and not exists(select 1 from public.extra_leave_usage_notices where id=p_id and employee_id=actor and company_id=company and invalidated_at is null) then
   raise exception '유효한 본인 안내문만 확인할 수 있습니다.' using errcode='42501';end if;
 if p_action='confirm' and not exists(select 1 from public.extra_leave_usage_notices where id=p_id and viewed_at is not null) then raise exception '안내문을 먼저 열람해 주세요.';end if;
 update public.extra_leave_usage_notices set
   read_at=coalesce(read_at,greatest(now(),issued_at)),
   viewed_at=case when p_action in ('view','confirm') then coalesce(viewed_at,greatest(now(),read_at,issued_at)) else viewed_at end,
   confirmed_at=case when p_action='confirm' then coalesce(confirmed_at,greatest(now(),viewed_at,read_at,issued_at)) else confirmed_at end,
   confirmed_session_id=case when p_action='confirm' then coalesce(confirmed_session_id,session) else confirmed_session_id end
 where employee_id=actor and company_id=company and invalidated_at is null and (p_id is null or id=p_id);
end $function$;

CREATE OR REPLACE FUNCTION app.record_leave_usage_notice(p_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := auth.uid(); company uuid; session uuid;
begin
  select company_id into company from public.profiles where id=actor and status='active';
  if actor is null or company is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_action not in ('read','view','confirm') or p_action is null then raise exception '올바르지 않은 처리입니다.'; end if;
  -- Scope the receipt to the current, server-recorded login session. A different
  -- browser's open impersonation audit must not block the employee's own login.
  begin
    session := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception '본인 로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.' using errcode='42501';
  end;
  if session is null or not exists(select 1 from auth.sessions where id=session and user_id=actor) then
    raise exception '본인 로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.' using errcode='42501';
  end if;
  -- Atelier signs employees in through Google OAuth (password for the developer).
  -- Employee switching uses an admin magic link / OTP, even after its audit ends.
  -- Consult Auth's private AMR records, never client state or user_metadata.
  if not exists(select 1 from auth.mfa_amr_claims
      where session_id=session and authentication_method in ('oauth','password')) then
    raise exception '직원 계정 전환 세션에서는 본인 확인 기록을 남길 수 없습니다. 전환을 종료한 후 본인 계정으로 다시 로그인해 주세요.' using errcode='42501';
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
end $function$;

commit;
