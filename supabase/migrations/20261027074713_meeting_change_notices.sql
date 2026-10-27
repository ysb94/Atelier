-- 재확정 시점의 전후 값을 보존한다. 과거 초대·응답·읽음·권한은 일괄 변경하지 않는다.
begin;

alter table public.meeting_invitations add column schedule_change jsonb;
comment on column public.meeting_invitations.schedule_change is
  '기존 멤버에게 재확정한 일정·회의실·소요 시간의 전후 스냅샷. 최초 초대는 NULL.';

-- 현재 저장 함수의 알림 upsert 부분만 바꾼다. 호스트·회사·revision·예약 검사는 그대로 둔다.
-- 예상한 부분이 없으면 중단하여 이후 다른 변경을 조용히 덮어쓰지 않는다.
do $migration$
declare
  definition text := replace(pg_get_functiondef('app.meeting_write(jsonb,bigint,uuid)'::regprocedure), E'\r\n', E'\n');
  original text := $old$     insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version)
       select v_company,p_confirm,x,v_after.schedule_version from unnest(v_members) x
       on conflict(round_id,profile_id) do update set status='pending',schedule_version=excluded.schedule_version,sent_at=now(),responded_at=null,read_at=null;$old$;
  replacement text := $new$     insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version,schedule_change)
       select v_company,p_confirm,x,v_after.schedule_version,
         case when v_before.confirmed_at is not null and x=any(v_old_members) then jsonb_build_object(
           'before',jsonb_build_object(
             'startsAt',to_char(v_before.starts_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI'),
             'room',coalesce((select name from public.meeting_rooms where company_id=v_company and id=v_before.room_id),'미지정'),
             'durationMinutes',v_before.duration_minutes),
           'after',jsonb_build_object(
             'startsAt',to_char(v_after.starts_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI'),
             'room',coalesce((select name from public.meeting_rooms where company_id=v_company and id=v_after.room_id),'미지정'),
             'durationMinutes',v_after.duration_minutes),
           'membersChanged',v_member_changed) else null end
       from unnest(v_members) x
       on conflict(round_id,profile_id) do update set status='pending',schedule_version=excluded.schedule_version,
         sent_at=now(),responded_at=null,read_at=null,schedule_change=excluded.schedule_change;$new$;
begin
  original := replace(original, E'\r\n', E'\n');
  replacement := replace(replacement, E'\r\n', E'\n');
  if strpos(definition,original)=0 or strpos(definition,'schedule_change')>0 then
    raise exception '회의 저장 함수가 예상 버전과 다릅니다. 변경 내용을 확인한 뒤 적용하세요.';
  end if;
  execute replace(definition,original,replacement);
end $migration$;

-- 기존 본인 초대 조회 조건과 호스트 응답 알림 합성 경로를 유지한다.
create or replace function app.meeting_notifications_before_realtime() returns jsonb
language sql stable security definer set search_path='' as $function$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'kind','meeting_invitation',
  'title',s.title||case when i.schedule_change is null then ' · 참석 요청' else ' · 회의 정보 변경' end,
  'body',case when i.schedule_change is null then
    to_char(r.starts_at at time zone 'Asia/Seoul','MM/DD HH24:MI')||' · 참석 가능·불가로 답해 주세요.'
   else concat_ws(E'\n',
    '회의 정보가 변경되었습니다.',
    '일정: '||case when i.schedule_change#>>'{before,startsAt}'=i.schedule_change#>>'{after,startsAt}'
      then (i.schedule_change#>>'{after,startsAt}')||' (변경 없음)'
      else (i.schedule_change#>>'{before,startsAt}')||' → '||(i.schedule_change#>>'{after,startsAt}') end,
    '회의실: '||case when i.schedule_change#>>'{before,room}'=i.schedule_change#>>'{after,room}'
      then (i.schedule_change#>>'{after,room}')||' (변경 없음)'
      else (i.schedule_change#>>'{before,room}')||' → '||(i.schedule_change#>>'{after,room}') end,
    '소요 시간: '||case when i.schedule_change#>>'{before,durationMinutes}'=i.schedule_change#>>'{after,durationMinutes}'
      then (i.schedule_change#>>'{after,durationMinutes}')||'분 (변경 없음)'
      else (i.schedule_change#>>'{before,durationMinutes}')||'분 → '||(i.schedule_change#>>'{after,durationMinutes}')||'분' end,
    case when i.schedule_change->>'membersChanged'='true' then '멤버 구성이 변경되었습니다.' end,
    '참석 가능·불가로 다시 답해 주세요.') end,
  'href','/settings/profile?part=meetings&meeting='||s.id||'&round='||r.id,
  'createdAt',i.sent_at,'readAt',i.read_at) order by i.sent_at desc),'[]'::jsonb)
 from public.meeting_invitations i
 join public.meeting_rounds r on r.id=i.round_id
 join public.meeting_series s on s.id=r.series_id
 where i.profile_id=auth.uid() and i.company_id=app.meeting_company_id()
  and i.schedule_version=r.schedule_version and app.meeting_round_can_read(r.id);
$function$;

commit;
