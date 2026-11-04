begin;
-- Additional per-round state. Existing meeting rows and read/response history are retained.
create table app.meeting_round_rosters (
 round_id uuid primary key references public.meeting_rounds(id),
 company_id uuid not null references public.companies(id)
);
create table app.meeting_round_people (
 round_id uuid not null references app.meeting_round_rosters(round_id),
 profile_id uuid not null references public.profiles(id),
 role text not null check(role in ('attendee','result','excluded')),
 primary key(round_id,profile_id)
);
create table app.meeting_round_people_history (
 id uuid primary key default gen_random_uuid(),round_id uuid not null references public.meeting_rounds(id),
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),people jsonb not null
);
create table app.meeting_result_drafts (round_id uuid primary key references public.meeting_rounds(id),body text not null);
alter table app.meeting_result_drafts enable row level security;
revoke all on app.meeting_result_drafts from public,anon,authenticated;
create table app.meeting_result_versions (
 id uuid primary key default gen_random_uuid(),round_id uuid not null references public.meeting_rounds(id),
 version integer not null,body text not null check(length(btrim(body))>0),
 shared_at timestamptz not null default clock_timestamp(),actor_id uuid not null references public.profiles(id),
 unique(round_id,version)
);
create table public.meeting_round_notices (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 round_id uuid not null references public.meeting_rounds(id),recipient_id uuid not null references public.profiles(id),
 event_key text not null,kind text not null check(kind in ('result','removed')),
 result_id uuid references app.meeting_result_versions(id),created_at timestamptz not null default clock_timestamp(),read_at timestamptz,
 unique(recipient_id,event_key)
);
alter table app.meeting_round_rosters enable row level security;
alter table app.meeting_round_people enable row level security;
alter table app.meeting_round_people_history enable row level security;
alter table app.meeting_result_versions enable row level security;
alter table public.meeting_round_notices enable row level security;
revoke all on app.meeting_round_rosters,app.meeting_round_people,app.meeting_round_people_history,app.meeting_result_versions,public.meeting_round_notices from public,anon,authenticated;
grant select on public.meeting_round_notices to authenticated;
create policy meeting_round_notices_self on public.meeting_round_notices for select to authenticated
 using(recipient_id=(select auth.uid()) and company_id=(select app.meeting_company_id()));

create function app.meeting_round_people_rows(p_round uuid) returns table(profile_id uuid,role text)
language sql stable security definer set search_path='' as $$
 select p.profile_id,p.role from app.meeting_round_people p where p.round_id=p_round
 union all
 select m.profile_id,'attendee' from public.meeting_members m join public.meeting_rounds r on r.series_id=m.series_id
 where r.id=p_round and not exists(select 1 from app.meeting_round_rosters a where a.round_id=p_round)
$$;
create function app.meeting_round_full_access(p_round uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.meeting_rounds r join public.meeting_series s on s.id=r.series_id
 where r.id=p_round and r.company_id=app.meeting_company_id() and r.deleted_at is null and s.deleted_at is null
 and (s.host_id=auth.uid() or app.is_admin() or (s.phase='preparing' and s.created_by=auth.uid())
 or (r.confirmed_at is not null and exists(select 1 from app.meeting_round_people_rows(r.id) p where p.profile_id=auth.uid() and p.role='attendee'))))
$$;
-- Keep the original function OID: existing RLS expressions reference it by OID.
do $$declare definition text; begin
 definition:=pg_get_functiondef('app.meeting_round_can_read(uuid)'::regprocedure);
 if strpos(definition,'FUNCTION app.meeting_round_can_read(')=0 then raise exception '회차 조회 함수가 변경되었습니다.'; end if;
 execute replace(definition,'FUNCTION app.meeting_round_can_read(','FUNCTION app.meeting_round_can_read_before_roles(');
end $$;
create or replace function app.meeting_round_can_read(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from app.meeting_round_rosters where round_id=p_id)
 then app.meeting_round_full_access(p_id) else app.meeting_round_can_read_before_roles(p_id) end
$$;

-- Freeze a legacy roster only when this meeting is first edited with the new controls.
create function app.meeting_materialize_rosters(p_series uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 for r in select * from public.meeting_rounds where series_id=p_series and deleted_at is null order by round_no loop
  if not exists(select 1 from app.meeting_round_rosters where round_id=r.id) then
   insert into app.meeting_round_rosters values(r.id,r.company_id);
   insert into app.meeting_round_people select r.id,m.profile_id,'attendee' from public.meeting_members m where m.series_id=p_series;
  end if;
 end loop;
end $$;

create function app.meeting_sync_round_group(p_series uuid) returns void
language plpgsql security definer set search_path='' as $$
declare rid uuid; room uuid; host uuid;
begin
 select host_id into host from public.meeting_series where id=p_series;
 select id into rid from public.meeting_rounds where series_id=p_series and deleted_at is null and confirmed_at is not null order by round_no desc limit 1;
 select room_id into room from public.meeting_chat_rooms where series_id=p_series;
 if room is null or rid is null then return; end if;
 delete from public.chat_room_members m where m.room_id=room and m.profile_id<>host and not exists(
  select 1 from app.meeting_round_people_rows(rid) p where p.profile_id=m.profile_id and p.role='attendee');
 insert into public.chat_room_members(room_id,profile_id)
 select room,p.profile_id from app.meeting_round_people_rows(rid) p join public.profiles u on u.id=p.profile_id
 where p.role='attendee' and u.status='active' on conflict do nothing;
 insert into public.chat_room_members(room_id,profile_id) values(room,host) on conflict do nothing;
end $$;

create function app.meeting_set_round_people(p_round uuid,p_revision bigint,p_people jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare s public.meeting_series; r public.meeting_rounds; person jsonb; old_ids uuid[]; new_ids uuid[]; result bigint; snapshot jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(app.meeting_company_id()::text,7341));
 select ss.* into s from public.meeting_series ss join public.meeting_rounds rr on rr.series_id=ss.id
 where rr.id=p_round and ss.company_id=app.meeting_company_id() and ss.host_id=auth.uid() and ss.deleted_at is null for update of ss;
 if s.id is null or s.status<>'in_progress' then raise exception '진행 중인 회의의 호스트만 명단을 변경할 수 있습니다.' using errcode='42501'; end if;
 if s.revision is distinct from p_revision then raise exception '회의가 변경되었습니다. 최신 명단을 확인하세요.' using errcode='40001'; end if;
 select * into r from public.meeting_rounds where id=p_round and deleted_at is null for update;
 if r.id is null or jsonb_typeof(p_people) is distinct from 'array' or jsonb_array_length(p_people)>200 then raise exception '명단을 확인하세요.' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(p_people) x where x->>'role' not in ('attendee','result','excluded') or x->>'role' is null
  or not exists(select 1 from public.profiles u where u.id=(x->>'id')::uuid and u.company_id=s.company_id and u.status='active')
  or (x->>'id')::uuid=s.host_id or (s.kind='meeting' and x->>'role'='result'))
  or (select count(*) from jsonb_array_elements(p_people))<>(select count(distinct x->>'id') from jsonb_array_elements(p_people) x)
 then raise exception '같은 회사의 재직자와 올바른 역할을 선택하세요.' using errcode='23514'; end if;
 perform app.meeting_materialize_rosters(s.id);
 select coalesce(array_agg(profile_id),'{}') into old_ids from app.meeting_round_people where round_id=r.id and role='attendee';
 select coalesce(jsonb_agg(jsonb_build_object('id',profile_id,'role',role) order by profile_id),'[]') into snapshot from app.meeting_round_people where round_id=r.id;
 if snapshot=(select coalesce(jsonb_agg(x order by x->>'id'),'[]') from jsonb_array_elements(p_people) x) then return s.revision; end if;
 update app.meeting_round_people set role='excluded' where round_id=r.id;
 for person in select * from jsonb_array_elements(p_people) loop
  insert into app.meeting_round_people values(r.id,(person->>'id')::uuid,person->>'role')
  on conflict(round_id,profile_id) do update set role=excluded.role;
 end loop;
 select coalesce(array_agg(profile_id),'{}') into new_ids from app.meeting_round_people where round_id=r.id and role='attendee';
 if r.confirmed_at is not null then
  insert into public.meeting_round_notices(company_id,round_id,recipient_id,event_key,kind)
  select s.company_id,r.id,id,'removed:'||r.id||':'||(s.revision+1),'removed' from unnest(old_ids) id where not id=any(new_ids)
  on conflict do nothing;
  -- Keep previous responses as history. Current invitation queries only expose actual attendees.
  insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version)
  select s.company_id,r.id,id,r.schedule_version from unnest(new_ids) id where not id=any(old_ids) and s.kind<>'meeting'
  on conflict(round_id,profile_id) do update set status='pending',schedule_version=excluded.schedule_version,sent_at=clock_timestamp(),responded_at=null,read_at=null;
 end if;
 delete from app.meeting_round_decisions where round_id=r.id;
 insert into app.meeting_round_people_history(round_id,actor_id,people) values(r.id,auth.uid(),p_people);
 update public.meeting_series set revision=revision+1,updated_at=clock_timestamp() where id=s.id returning revision into result;
 perform app.meeting_sync_round_group(s.id);
 return result;
end $$;

create function app.meeting_publish_result(p_round uuid,p_revision bigint) returns bigint
language plpgsql security definer set search_path='' as $$
declare s public.meeting_series; r public.meeting_rounds; v app.meeting_result_versions; result bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(app.meeting_company_id()::text,7341));
 select ss.* into s from public.meeting_series ss join public.meeting_rounds rr on rr.series_id=ss.id
 where rr.id=p_round and ss.company_id=app.meeting_company_id() and ss.host_id=auth.uid() and ss.deleted_at is null for update of ss;
 if s.id is null then raise exception '호스트만 결과를 공유할 수 있습니다.' using errcode='42501'; end if;
 select * into r from public.meeting_rounds where id=p_round and deleted_at is null for update;
 r.result:=coalesce((select body from app.meeting_result_drafts where round_id=r.id),r.result);
 if r.confirmed_at is null or s.kind='meeting' or length(btrim(r.result))=0 then raise exception '확정된 회차의 결과를 먼저 저장하세요.' using errcode='23514'; end if;
 select * into v from app.meeting_result_versions where round_id=r.id order by version desc limit 1;
 if v.body=r.result then return s.revision; end if;
 perform app.meeting_materialize_rosters(s.id);
 if s.revision is distinct from p_revision then raise exception '회의가 변경되었습니다. 최신 결과를 확인하세요.' using errcode='40001'; end if;
 insert into app.meeting_result_versions(round_id,version,body,actor_id) values(r.id,coalesce(v.version,0)+1,r.result,auth.uid()) returning * into v;
 insert into public.meeting_round_notices(company_id,round_id,recipient_id,event_key,kind,result_id)
 select s.company_id,r.id,p.profile_id,'result:'||v.id,'result',v.id from app.meeting_round_people_rows(r.id) p
 join public.profiles u on u.id=p.profile_id where p.role in ('attendee','result') and p.profile_id<>s.host_id and u.status='active';
 update public.meeting_series set revision=revision+1,updated_at=clock_timestamp() where id=s.id returning revision into result;
 return result;
end $$;

-- Exact event reads; reading a previous publication never clears a later result.
create function app.meeting_read_round_notice(p_id uuid,p_created timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.meeting_round_notices n set read_at=coalesce(read_at,clock_timestamp())
 where n.id=p_id and n.recipient_id=auth.uid() and n.company_id=app.meeting_company_id() and n.created_at=p_created
 and exists(select 1 from public.meeting_rounds r join public.meeting_series s on s.id=r.series_id where r.id=n.round_id and r.deleted_at is null and s.deleted_at is null);
 if not found then raise exception '현재 열람 가능한 알림이 아닙니다.' using errcode='42501'; end if;
end $$;

create function public.set_meeting_round_people(p_round uuid,p_revision bigint,p_people jsonb) returns bigint
language sql security invoker set search_path='' as $$select app.meeting_set_round_people(p_round,p_revision,p_people)$$;
create function public.publish_meeting_result(p_round uuid,p_revision bigint) returns bigint
language sql security invoker set search_path='' as $$select app.meeting_publish_result(p_round,p_revision)$$;
create function public.read_meeting_round_notice(p_id uuid,p_created timestamptz) returns void
language sql security invoker set search_path='' as $$select app.meeting_read_round_notice(p_id,p_created)$$;

alter function app.meeting_list() rename to meeting_list_before_round_roles;
revoke all on function app.meeting_list_before_round_roles() from public,anon,authenticated;
create function app.meeting_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb:='[]'; item jsonb; rr jsonb; rounds jsonb; people jsonb; publications jsonb; access text; rid uuid;
begin
 for item in select * from jsonb_array_elements(app.meeting_list_before_round_roles()) loop
  rounds:='[]';
  for rr in select * from jsonb_array_elements(item->'rounds') loop
   rid:=(rr->>'id')::uuid;
   select coalesce(jsonb_agg(jsonb_build_object('person',app.meeting_person(p.profile_id),'role',p.role) order by p.profile_id),'[]') into people from app.meeting_round_people_rows(rid) p;
   select coalesce(jsonb_agg(jsonb_build_object('version',v.version,'body',v.body,'sharedAt',v.shared_at) order by v.version),'[]') into publications
   from app.meeting_result_versions v where v.round_id=rid and ((item#>>'{host,id}')::uuid=auth.uid() or exists(
    select 1 from public.meeting_round_notices n where n.result_id=v.id and n.recipient_id=auth.uid()));
   access:=case when app.meeting_round_can_read(rid) then 'full'
    when exists(select 1 from app.meeting_round_people_rows(rid) p where p.profile_id=auth.uid() and p.role='result') or jsonb_array_length(publications)>0
    or exists(select 1 from public.meeting_round_notices n where n.round_id=rid and n.recipient_id=auth.uid() and n.kind='removed') then 'result' else 'none' end;
   if access='full' then
    rr:=rr|| (select jsonb_build_object('content',r.content,'result',case when (item#>>'{host,id}')::uuid=auth.uid() then coalesce((select body from app.meeting_result_drafts where round_id=r.id),r.result) else r.result end,'prepMaterials',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.file_name,'size',f.size_bytes,'type',f.content_type,'url','','storagePath',f.storage_path,'uploadedBy',app.meeting_person(f.uploaded_by)) order by f.created_at,f.id) from public.meeting_files f where f.round_id=r.id and f.ready and f.deleted_at is null),'[]'::jsonb)) from public.meeting_rounds r where r.id=rid);
   end if;
   if access<>'full' then rr:=rr||jsonb_build_object('content','','result','','prepMaterials','[]'::jsonb,'responses','[]'::jsonb); end if;
   if (item#>>'{host,id}')::uuid<>auth.uid() and exists(select 1 from app.meeting_round_rosters where round_id=rid) then
    rr:=rr||jsonb_build_object('result',coalesce(publications->-1->>'body',''));
   end if;
   rr:=rr||jsonb_build_object('membership',people,'detailAccess',access,'sharedResults',publications);
   rr:=rr||jsonb_build_object('responses',case when access='full' then coalesce((select jsonb_agg(jsonb_build_object('profileId',p.profile_id,'status',coalesce(i.status,'pending'))) from app.meeting_round_people_rows(rid) p left join public.meeting_invitations i on i.round_id=rid and i.profile_id=p.profile_id and i.schedule_version=(rr->>'scheduleVersion')::integer where p.role='attendee'),'[]'::jsonb) else '[]'::jsonb end);
   rounds:=rounds||jsonb_build_array(rr);
  end loop;
  items:=items||jsonb_build_array(item||jsonb_build_object('roundMembershipReady',true,'rounds',rounds));
 end loop;
 return items;
end $$;

-- Preserve underlying booking checks and notes. Roster mutations use the separate checked API.
alter function app.meeting_write(jsonb,bigint,uuid) rename to meeting_write_before_round_roles;
revoke all on function app.meeting_write_before_round_roles(jsonb,bigint,uuid) from public,anon,authenticated;
create function app.meeting_write(p_series jsonb,p_revision bigint,p_confirm uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare s public.meeting_series; result bigint; v_round record; previous uuid; payload jsonb; incoming jsonb;
begin
 select * into s from public.meeting_series where id=(p_series->>'id')::uuid;
 if exists(select 1 from app.meeting_round_rosters a join public.meeting_rounds r on r.id=a.round_id where r.series_id=s.id) then
  if s.host_id<>auth.uid() then raise exception '회의 내용은 호스트만 변경할 수 있습니다.' using errcode='42501'; end if;
  if (select coalesce(array_agg(x->>'id' order by x->>'id'),'{}') from jsonb_array_elements(p_series->'members') x)
    is distinct from (select coalesce(array_agg(profile_id::text order by profile_id::text),'{}') from public.meeting_members where series_id=s.id)
  then raise exception '멤버 변경은 회차별 명단 관리에서 진행해 주세요. 최신 화면을 열어 주세요.' using errcode='23514'; end if;
 end if;
 payload:=p_series;
 if s.id is null or exists(select 1 from app.meeting_round_rosters a join public.meeting_rounds q on q.id=a.round_id where q.series_id=s.id) then
  payload:=jsonb_set(payload,'{rounds}',coalesce((select jsonb_agg(x||jsonb_build_object('result',coalesce((select q.result from public.meeting_rounds q where q.id=(x->>'id')::uuid),''))) from jsonb_array_elements(p_series->'rounds') x),'[]'));
 end if;
 result:=app.meeting_write_before_round_roles(payload,p_revision,p_confirm);
 if s.id is null or exists(select 1 from app.meeting_round_rosters a join public.meeting_rounds q on q.id=a.round_id where q.series_id=(p_series->>'id')::uuid) then
  for incoming in select * from jsonb_array_elements(p_series->'rounds') loop
   insert into app.meeting_result_drafts values((incoming->>'id')::uuid,coalesce(incoming->>'result','')) on conflict(round_id) do update set body=excluded.body;
  end loop;
 end if;
 if s.id is null then perform app.meeting_materialize_rosters((p_series->>'id')::uuid); end if;
 -- New rounds copy the preceding roster, never changing a preceding round.
 for v_round in select * from public.meeting_rounds where series_id=(p_series->>'id')::uuid and deleted_at is null order by round_no loop
  if not exists(select 1 from app.meeting_round_rosters where round_id=v_round.id) then
   select rr.id into previous from public.meeting_rounds rr join app.meeting_round_rosters a on a.round_id=rr.id
   where rr.series_id=v_round.series_id and rr.round_no<v_round.round_no and rr.deleted_at is null order by rr.round_no desc limit 1;
   if previous is not null then
    insert into app.meeting_round_rosters values(v_round.id,v_round.company_id);
    insert into app.meeting_round_people select v_round.id,p.profile_id,p.role from app.meeting_round_people p where p.round_id=previous and p.role<>'excluded';
   end if;
  end if;
 end loop;
 if p_confirm is not null and exists(select 1 from app.meeting_round_rosters where round_id=p_confirm) then
  select * into v_round from public.meeting_rounds where id=p_confirm;
  -- Existing invitation rows remain for historical reads; filters suppress non-attendees.
  insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version)
  select v_round.company_id,v_round.id,p.profile_id,v_round.schedule_version from app.meeting_round_people_rows(v_round.id) p
  join public.meeting_series ss on ss.id=v_round.series_id where p.role='attendee' and ss.kind<>'meeting'
  on conflict(round_id,profile_id) do update set schedule_version=excluded.schedule_version,status='pending',sent_at=clock_timestamp(),responded_at=null,read_at=null
  where public.meeting_invitations.schedule_version<>excluded.schedule_version;
  perform app.meeting_sync_round_group(v_round.series_id);
 end if;
 return result;
end $$;

alter function app.meeting_notifications() rename to meeting_notifications_before_round_roles;
revoke all on function app.meeting_notifications_before_round_roles() from public,anon,authenticated;
create function app.meeting_notifications() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by item->>'createdAt' desc),'[]') from (
 select case when value#>>'{meeting,role}'='host' and exists(select 1 from app.meeting_round_people_history h where h.round_id=(value#>>'{meeting,roundId}')::uuid and h.created_at>(value->>'createdAt')::timestamptz) then value||jsonb_build_object('current',false) else value end item from jsonb_array_elements(app.meeting_notifications_before_round_roles())
 where coalesce(value#>>'{meeting,role}','member')='host' or exists(
  select 1 from app.meeting_round_people_rows((split_part(split_part(value->>'href','&round=',2),'&',1))::uuid) p where p.profile_id=auth.uid() and p.role='attendee')
 union all
 select jsonb_build_object('id',n.id,'kind',case n.kind when 'result' then 'meeting_result' else 'meeting_removed' end,
 'title',s.title||' · '||r.round_no||'차 '||case n.kind when 'result' then '회의 결과 공유' else '참석 대상 해제' end,
 'body',case n.kind when 'result' then '회의 결과가 공유되었습니다.' else '해당 회차에 참석하지 않으셔도 됩니다.' end,
 'href','/settings/profile?part=meetings&meeting='||s.id||'&round='||r.id||'&meetingNotice='||n.id||case when n.kind='result' then '&resultVersion=result:'||(select version from app.meeting_result_versions where id=n.result_id) else '' end,
 'createdAt',n.created_at,'readAt',n.read_at)
 from public.meeting_round_notices n join public.meeting_rounds r on r.id=n.round_id join public.meeting_series s on s.id=r.series_id
 where n.company_id=app.meeting_company_id() and n.recipient_id=auth.uid() and s.deleted_at is null and r.deleted_at is null
 ) notices
$$;

-- Keep exact installed definitions/config/ACL; abort if a guarded source target drifted.
do $patch$
declare definition text; sig regprocedure; old text; fresh text;
begin
 for sig,old,fresh in select * from (values
 ('app.meeting_begin_file_before_invitations(uuid,text,text,bigint)'::regprocedure,'app.meeting_can_read(v_round.series_id)','app.meeting_round_can_read(v_round.id)'),
 ('app.meeting_finish_file(uuid)'::regprocedure,'app.meeting_can_read(r.series_id)','app.meeting_round_can_read(r.id)'),
 ('app.meeting_availability(uuid,date,uuid[],uuid)'::regprocedure,
 'exists(select 1 from public.meeting_members m where m.series_id=s.id and m.profile_id=p.id)',
 'exists(select 1 from app.meeting_round_people_rows(r.id) m where m.profile_id=p.id and m.role=''attendee'')')
 ) patches loop
  definition:=pg_get_functiondef(sig);
  if strpos(definition,old)=0 then raise exception '회의 함수 % 버전이 변경되었습니다.',sig; end if;
  execute replace(definition,old,fresh);
 end loop;
end $patch$;

-- A checked per-round response path; legacy rows keep their existing implementation.
alter function app.meeting_respond(uuid,integer,text) rename to meeting_respond_before_round_roles;
revoke all on function app.meeting_respond_before_round_roles(uuid,integer,text) from public,anon,authenticated;
create function app.meeting_respond(p_round uuid,p_version integer,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.meeting_rounds; s public.meeting_series; old text; rev bigint; all_available boolean;
begin
 if not exists(select 1 from app.meeting_round_rosters where round_id=p_round) then
  perform app.meeting_respond_before_round_roles(p_round,p_version,p_status); return; end if;
 perform pg_advisory_xact_lock(hashtextextended(app.meeting_company_id()::text,7341));
 select * into r from public.meeting_rounds where id=p_round for update;
 select * into s from public.meeting_series where id=r.series_id;
 if not app.meeting_round_can_read(p_round) or s.kind='meeting' or r.confirmed_at is null
 or not exists(select 1 from app.meeting_round_people_rows(p_round) p where p.profile_id=auth.uid() and p.role='attendee')
 or app.meeting_round_decision(p_round) is not null then raise exception '현재 참석 응답 대상이 아닙니다.' using errcode='42501'; end if;
 if r.schedule_version is distinct from p_version then raise exception '일정이 변경되었습니다.' using errcode='40001'; end if;
 if p_status is null or p_status not in ('available','unavailable') then raise exception '참석 여부를 선택하세요.' using errcode='23514'; end if;
 select status into old from public.meeting_invitations where round_id=p_round and profile_id=auth.uid();
 if old=p_status then return; end if;
 insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version,status,responded_at,read_at,response_revision)
 values(r.company_id,r.id,auth.uid(),p_version,p_status,clock_timestamp(),clock_timestamp(),1)
 on conflict(round_id,profile_id) do update set status=excluded.status,responded_at=excluded.responded_at,read_at=excluded.read_at,response_revision=public.meeting_invitations.response_revision+1
 returning response_revision into rev;
 select not exists(select 1 from app.meeting_round_people_rows(r.id) p left join public.meeting_invitations i on i.round_id=r.id and i.profile_id=p.profile_id and i.schedule_version=p_version
 where p.role='attendee' and coalesce(i.status,'pending')<>'available') into all_available;
 if s.status='in_progress' and (p_status='unavailable' or all_available) then
 insert into public.meeting_host_notices(company_id,round_id,recipient_id,source_profile_id,schedule_version,response_revision,kind,body)
 values(r.company_id,r.id,s.host_id,auth.uid(),p_version,rev,case when p_status='unavailable' then 'unavailable' else 'available' end,
 case when p_status='unavailable' then '참석 불가 응답이 있습니다.' else '이번 회차 참석자 모두 참석 가능합니다.' end) on conflict do nothing;
 end if;
end $$;

create or replace function app.meeting_open_group(p_series uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.meeting_series; rid uuid; room uuid;
begin
 select * into s from public.meeting_series where id=p_series and company_id=app.meeting_company_id() and deleted_at is null for update;
 select id into rid from public.meeting_rounds where series_id=s.id and confirmed_at is not null and deleted_at is null order by round_no desc limit 1;
 if s.id is null or s.phase<>'published' or rid is null or (s.host_id<>auth.uid() and not exists(
 select 1 from app.meeting_round_people_rows(rid) p where p.profile_id=auth.uid() and p.role='attendee')) then
 raise exception '현재 회차 참석자만 단체 대화를 열 수 있습니다.' using errcode='42501'; end if;
 select room_id into room from public.meeting_chat_rooms where series_id=s.id;
 if room is null then
  perform app.assert_chat_member_profiles(array[s.host_id]||(select coalesce(array_agg(profile_id),'{}') from app.meeting_round_people_rows(rid) where role='attendee'));
  if (select count(*) from app.meeting_round_people_rows(rid) where role='attendee')>100 then raise exception '한 방에 초대할 수 있는 사람은 100명까지입니다.'; end if;
  insert into public.chat_rooms(company_id,kind,name,created_by) values(s.company_id,'group',btrim(left('회의 · '||s.title,80)),auth.uid()) returning id into room;
  insert into public.meeting_chat_rooms values(s.id,room);
 end if;
 perform app.meeting_sync_round_group(s.id);
 return room;
end $$;

-- Legacy booking writes must not erase per-round invitation history.
do $$declare definition text; begin
 definition:=pg_get_functiondef('app.meeting_write_before_manual_confirmation(jsonb,bigint,uuid)'::regprocedure);
 if strpos(definition,'delete from public.meeting_invitations where round_id=p_confirm and not profile_id=any(v_members)')=0 then raise exception '회의 초대 저장 함수가 변경되었습니다.'; end if;
 if strpos(definition,'from unnest(v_members) x where v_kind<>''meeting''')=0 then raise exception '회의 초대 수신자 함수가 변경되었습니다.'; end if;
 definition:=replace(definition,'from unnest(v_members) x where v_kind<>''meeting''',
 'from unnest(v_members) x where v_kind<>''meeting'' and (not exists(select 1 from app.meeting_round_rosters where round_id=p_confirm) or exists(select 1 from app.meeting_round_people_rows(p_confirm) rp where rp.profile_id=x and rp.role=''attendee''))');
 definition:=replace(definition,'delete from public.meeting_invitations where round_id=p_confirm and not profile_id=any(v_members)',
 'delete from public.meeting_invitations where round_id=p_confirm and not profile_id=any(v_members) and not exists(select 1 from app.meeting_round_rosters where round_id=p_confirm)');
 execute definition;
end $$;

-- Existing manual confirmation must inspect this round, not a series-wide roster.
do $$declare definition text; begin
 definition:=pg_get_functiondef('app.meeting_manual_confirm(uuid,bigint,integer,uuid[])'::regprocedure);
 if strpos(definition,'from public.meeting_members m where m.series_id=s.id')=0 then raise exception '수동 확정 함수가 변경되었습니다.'; end if;
 definition:=replace(definition,'from public.meeting_members m where m.series_id=s.id','from app.meeting_round_people_rows(p_round) m where m.role=''attendee''');
 execute definition;
 definition:=pg_get_functiondef('app.meeting_round_decision(uuid)'::regprocedure);
 if strpos(definition,'from public.meeting_members m where m.series_id=s.id')=0 then raise exception '회의 확정 조회 함수가 변경되었습니다.'; end if;
 execute replace(definition,'from public.meeting_members m where m.series_id=s.id','from app.meeting_round_people_rows(p_round) m where m.role=''attendee''');
end $$;

-- Internal roster readers must never be used as public data export endpoints.
do $$declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='app' and p.proname in ('meeting_round_people_rows','meeting_round_full_access','meeting_materialize_rosters','meeting_sync_round_group','meeting_set_round_people','meeting_publish_result','meeting_read_round_notice','meeting_round_can_read','meeting_list','meeting_notifications','meeting_respond','meeting_write','meeting_round_can_read_before_roles'))
 or (n.nspname='public' and p.proname in ('set_meeting_round_people','publish_meeting_result','read_meeting_round_notice')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.signature::text not like 'app.meeting_round_can_read_before_roles(%' and f.signature::text not like 'app.meeting_write(%' and f.signature::text not like 'app.meeting_materialize_rosters(%' and f.signature::text not like 'app.meeting_sync_round_group(%' and f.signature::text not like 'app.meeting_round_people_rows(%' then
 execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;

do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.meeting_round_notices; end if; end $$;
notify pgrst,'reload schema';

commit;
