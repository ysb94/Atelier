-- Additive, no existing meetings or responses are rewritten.
create table app.meeting_round_decisions (
 round_id uuid primary key references public.meeting_rounds(id),
 company_id uuid not null references public.companies(id),
 schedule_version integer not null, actor_id uuid not null references public.profiles(id),
 member_ids uuid[] not null, excluded_ids uuid[] not null,
 decided_at timestamptz not null default clock_timestamp()
);
create table app.meeting_round_decision_history (
 id uuid primary key default gen_random_uuid(), round_id uuid not null references public.meeting_rounds(id),
 company_id uuid not null, schedule_version integer not null, actor_id uuid not null,
 member_ids uuid[] not null, excluded_ids uuid[] not null, responses jsonb not null,
 decided_at timestamptz not null default clock_timestamp()
);
alter table app.meeting_round_decisions enable row level security;
alter table app.meeting_round_decision_history enable row level security;
revoke all on app.meeting_round_decisions,app.meeting_round_decision_history from public,anon,authenticated;

create function app.meeting_round_decision(p_round uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('excludedIds',d.excluded_ids,'decidedAt',d.decided_at,'actorId',d.actor_id)
 from app.meeting_round_decisions d join public.meeting_rounds r on r.id=d.round_id
 join public.meeting_series s on s.id=r.series_id
 where r.id=p_round and r.schedule_version=d.schedule_version and s.host_id=d.actor_id
 and d.member_ids=(select coalesce(array_agg(m.profile_id order by m.profile_id),'{}'::uuid[]) from public.meeting_members m where m.series_id=s.id)
$$;
revoke all on function app.meeting_round_decision(uuid) from public,anon,authenticated;

create function app.meeting_manual_confirm(p_round uuid,p_revision bigint,p_version integer,p_excluded uuid[]) returns bigint
language plpgsql security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id(); s public.meeting_series; r public.meeting_rounds;
 members uuid[]; excluded uuid[]; expected uuid[]; replies jsonb; result bigint;
begin
 if company is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(company::text,7341));
 select s0.* into s from public.meeting_series s0 join public.meeting_rounds r0 on r0.series_id=s0.id
 where r0.id=p_round and s0.company_id=company and s0.host_id=auth.uid() for update of s0;
 if s.id is null or s.company_id<>company or s.host_id<>auth.uid() or s.deleted_at is not null
  or s.phase<>'published' or s.status<>'in_progress' or s.kind='meeting' then
  raise exception '진행 중인 회의의 호스트만 수동 확정할 수 있습니다.' using errcode='42501'; end if;
 select * into r from public.meeting_rounds where id=p_round for update;
 if r.deleted_at is not null or r.confirmed_at is null or r.schedule_version is distinct from p_version then
  raise exception '일정이 변경되었습니다. 새로고침 후 확인해 주세요.' using errcode='40001'; end if;
 select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into expected from unnest(p_excluded) x;
 if app.meeting_round_decision(p_round) is not null then
  if (select excluded_ids from app.meeting_round_decisions where round_id=p_round)=expected then return s.revision; end if;
  raise exception '이미 수동 확정된 회차입니다.' using errcode='40001'; end if;
 if s.revision is distinct from p_revision then raise exception '회의가 변경되었습니다. 새로고침 후 확인해 주세요.' using errcode='40001'; end if;
 select coalesce(array_agg(m.profile_id order by m.profile_id),'{}'::uuid[]) into members from public.meeting_members m where m.series_id=s.id;
 if cardinality(members)=0 or exists(select 1 from unnest(members) m left join public.meeting_invitations i
  on i.round_id=p_round and i.profile_id=m and i.schedule_version=p_version where coalesce(i.status,'pending')='pending') then
  raise exception '모든 멤버의 참석 응답이 완료되어야 합니다.' using errcode='23514'; end if;
 select coalesce(array_agg(profile_id order by profile_id),'{}'::uuid[]) into excluded
  from public.meeting_invitations where round_id=p_round and schedule_version=p_version and profile_id=any(members) and status='unavailable';
 if cardinality(excluded)=0 or excluded is distinct from expected then
  raise exception '불참 멤버가 변경되었습니다. 명단을 다시 확인해 주세요.' using errcode='40001'; end if;
 select jsonb_agg(jsonb_build_object('profileId',profile_id,'status',status,'revision',response_revision,'respondedAt',responded_at) order by profile_id)
 into replies from public.meeting_invitations where round_id=p_round and schedule_version=p_version and profile_id=any(members);
 insert into app.meeting_round_decisions(round_id,company_id,schedule_version,actor_id,member_ids,excluded_ids)
 values(p_round,company,p_version,auth.uid(),members,excluded)
 on conflict(round_id) do update set schedule_version=excluded.schedule_version,actor_id=excluded.actor_id,
  member_ids=excluded.member_ids,excluded_ids=excluded.excluded_ids,decided_at=clock_timestamp();
 insert into app.meeting_round_decision_history(round_id,company_id,schedule_version,actor_id,member_ids,excluded_ids,responses)
 values(p_round,company,p_version,auth.uid(),members,excluded,replies);
 update public.meeting_invitations set sent_at=clock_timestamp(),read_at=null where round_id=p_round and schedule_version=p_version;
 update public.meeting_series set revision=revision+1,updated_at=clock_timestamp() where id=s.id returning revision into result;
 return result;
end $$;
revoke all on function app.meeting_manual_confirm(uuid,bigint,integer,uuid[]) from public,anon;
grant execute on function app.meeting_manual_confirm(uuid,bigint,integer,uuid[]) to authenticated;
create function public.manually_confirm_meeting_round(p_round uuid,p_revision bigint,p_version integer,p_excluded uuid[]) returns bigint
language sql security invoker set search_path='' as $$select app.meeting_manual_confirm(p_round,p_revision,p_version,p_excluded)$$;
revoke all on function public.manually_confirm_meeting_round(uuid,bigint,integer,uuid[]) from public,anon;
grant execute on function public.manually_confirm_meeting_round(uuid,bigint,integer,uuid[]) to authenticated;

-- Existing clients cannot forge a confirmation in their save payload.
alter function app.meeting_write(jsonb,bigint,uuid) rename to meeting_write_before_manual_confirmation;
revoke all on function app.meeting_write_before_manual_confirmation(jsonb,bigint,uuid) from public,anon,authenticated;
create function app.meeting_write(p_series jsonb,p_revision bigint,p_confirm uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare result bigint; before_members uuid[]; after_members uuid[]; company uuid:=app.meeting_company_id();
begin
 if company is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(company::text,7341));
 select array_agg(profile_id order by profile_id) into before_members from public.meeting_members where series_id=(p_series->>'id')::uuid;
 result:=app.meeting_write_before_manual_confirmation(p_series,p_revision,p_confirm);
 select array_agg(profile_id order by profile_id) into after_members from public.meeting_members where series_id=(p_series->>'id')::uuid;
 if before_members is distinct from after_members then
  delete from app.meeting_round_decisions where round_id in(select id from public.meeting_rounds where series_id=(p_series->>'id')::uuid);
 end if;
 return result;
end $$;
revoke all on function app.meeting_write(jsonb,bigint,uuid) from public,anon,authenticated;

alter function app.meeting_respond(uuid,integer,text) rename to meeting_respond_before_manual_confirmation;
revoke all on function app.meeting_respond_before_manual_confirmation(uuid,integer,text) from public,anon,authenticated;
create function app.meeting_respond(p_round uuid,p_version integer,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id();
begin
 if company is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(company::text,7341));
 if app.meeting_round_decision(p_round) is not null then
  raise exception '수동 확정된 회차입니다. 변경이 필요하면 호스트에게 일정 변경을 요청해 주세요.' using errcode='42501'; end if;
 perform app.meeting_respond_before_manual_confirmation(p_round,p_version,p_status);
end $$;
revoke all on function app.meeting_respond(uuid,integer,text) from public,anon;
grant execute on function app.meeting_respond(uuid,integer,text) to authenticated;

alter function app.meeting_list() rename to meeting_list_before_manual_confirmation;
revoke all on function app.meeting_list_before_manual_confirmation() from public,anon,authenticated;
create function app.meeting_list() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item||jsonb_build_object('manualConfirmationReady',true,'rounds',
  (select coalesce(jsonb_agg(r||jsonb_build_object('manualConfirmation',app.meeting_round_decision((r->>'id')::uuid))),'[]'::jsonb)
  from jsonb_array_elements(item->'rounds') r))),'[]'::jsonb)
 from jsonb_array_elements(app.meeting_list_before_manual_confirmation()) item
$$;
revoke all on function app.meeting_list() from public,anon;
grant execute on function app.meeting_list() to authenticated;

-- Server-side availability releases only excluded members, never the room.
do $patch$
declare definition text;
begin
 select pg_get_functiondef('app.meeting_availability(uuid,date,uuid[],uuid)'::regprocedure) into definition;
 if position('and (r.starts_at at time zone' in definition)=0 then raise exception '회의 가용 시간 함수가 변경되었습니다.'; end if;
 definition:=replace(definition,'and (r.starts_at at time zone',
 'and not coalesce((app.meeting_round_decision(r.id)->''excludedIds'') ? p.id::text,false) and (r.starts_at at time zone');
 execute definition;
end $patch$;

alter function app.meeting_notifications() rename to meeting_notifications_before_manual_confirmation;
revoke all on function app.meeting_notifications_before_manual_confirmation() from public,anon,authenticated;
create function app.meeting_notifications() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(case when decision is null then item else item||jsonb_build_object(
  'title',case when (decision->'excludedIds') ? auth.uid()::text then '이번 차수 참석 제외' else '회의 진행 확정' end,
  'body',case when (decision->'excludedIds') ? auth.uid()::text then '호스트가 불참자를 제외하고 이번 차수를 확정했습니다. 다음 차수에는 다시 참석 대상에 포함됩니다.' else '호스트가 불참자를 제외하고 이번 차수를 확정했습니다. 예정된 일정으로 진행합니다.' end,
  'meeting',jsonb_build_object('role','member','roundId',round_id,'finalized',true)) end),'[]'::jsonb)
 from (select item,round_id,app.meeting_round_decision(round_id) as decision from (
  select item,case when item->>'href' like '%&round=%' then split_part(item->>'href','&round=',2)::uuid else null end round_id
  from jsonb_array_elements(app.meeting_notifications_before_manual_confirmation()) item) notices) decisions
 where decision is null or coalesce(item#>>'{meeting,role}','member')<>'host'
$$;
revoke all on function app.meeting_notifications() from public,anon;
grant execute on function app.meeting_notifications() to authenticated;
alter function app.meeting_calendar(date,date) rename to meeting_calendar_before_manual_confirmation;
revoke all on function app.meeting_calendar_before_manual_confirmation(date,date) from public,anon,authenticated;
create function app.meeting_calendar(p_from date,p_to date) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(case when app.meeting_round_decision((item->>'id')::uuid) is null then item else
  item||jsonb_build_object('members',(select coalesce(jsonb_agg(person),'[]'::jsonb)
   from jsonb_array_elements(coalesce(item->'members','[]'::jsonb)) person
   where not coalesce((app.meeting_round_decision((item->>'id')::uuid)->'excludedIds') ? (person->>'id'),false))) end),'[]'::jsonb)
 from jsonb_array_elements(app.meeting_calendar_before_manual_confirmation(p_from,p_to)) item
$$;
revoke all on function app.meeting_calendar(date,date) from public,anon;
grant execute on function app.meeting_calendar(date,date) to authenticated;
notify pgrst,'reload schema';
