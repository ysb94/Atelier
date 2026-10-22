-- 회의 전용 추가. 기존 사용자/승인/권한 함수·정책·트리거는 변경하지 않는다.
create table public.meeting_rooms (
  company_id uuid not null references public.companies(id),
  id text not null,
  name text not null,
  sort_order integer not null default 0,
  primary key(company_id,id)
);
insert into public.meeting_rooms(company_id,id,name,sort_order)
select c.id,r.id,r.name,r.sort_order from public.companies c
cross join (values ('room-1','대회의실',1),('room-2','소회의실',2)) r(id,name,sort_order);

create table public.meeting_series (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  host_id uuid not null references public.profiles(id),
  title text not null check(length(btrim(title)) between 1 and 300),
  status text not null check(status in ('in_progress','done')),
  duration_minutes integer not null check(duration_minutes in (30,60,90,120,180)),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  unique(company_id,id)
);
create index meeting_series_company_idx on public.meeting_series(company_id,updated_at desc) where deleted_at is null;
create index meeting_series_host_idx on public.meeting_series(host_id);
create table public.meeting_members (
  company_id uuid not null,
  series_id uuid not null,
  profile_id uuid not null references public.profiles(id),
  primary key(series_id,profile_id),
  foreign key(company_id,series_id) references public.meeting_series(company_id,id)
);
create index meeting_members_profile_idx on public.meeting_members(profile_id,series_id);
create table public.meeting_rounds (
  id uuid primary key,
  company_id uuid not null,
  series_id uuid not null,
  round_no integer not null check(round_no between 1 and 10000),
  room_id text,
  starts_at timestamptz,
  duration_minutes integer not null check(duration_minutes in (30,60,90,120,180)),
  content text not null default '' check(length(content)<=100000),
  result text not null default '' check(length(result)<=100000),
  deleted_at timestamptz,
  foreign key(company_id,series_id) references public.meeting_series(company_id,id),
  foreign key(company_id,room_id) references public.meeting_rooms(company_id,id),
  unique(company_id,id),
  check((starts_at is null)=(room_id is null))
);
create unique index meeting_round_number_idx on public.meeting_rounds(series_id,round_no) where deleted_at is null;
create unique index meeting_pending_round_idx on public.meeting_rounds(series_id) where deleted_at is null and starts_at is null;
create index meeting_round_calendar_idx on public.meeting_rounds(company_id,room_id,starts_at) where deleted_at is null;
create table public.meeting_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  round_id uuid not null,
  uploaded_by uuid not null references public.profiles(id),
  file_name text not null check(length(file_name) between 1 and 255),
  content_type text not null,
  size_bytes bigint not null check(size_bytes between 1 and 52428800),
  storage_path text not null unique,
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key(company_id,round_id) references public.meeting_rounds(company_id,id)
);
create index meeting_files_round_idx on public.meeting_files(round_id) where deleted_at is null;
create index meeting_files_uploader_idx on public.meeting_files(uploaded_by);

create function app.meeting_company_id() returns uuid
language sql stable security definer set search_path='' as $$
  select company_id from public.profiles where id=auth.uid() and status='active';
$$;
-- 현재 화면의 기존 meeting.manage 원본은 is_admin. 미적용 권한 지정은 활성화하지 않는다.
create function app.meeting_can_read(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.meeting_series s
    where s.id=p_id and s.company_id=app.meeting_company_id() and s.deleted_at is null
      and (s.host_id=auth.uid() or app.is_admin() or exists(
        select 1 from public.meeting_members m where m.series_id=s.id and m.profile_id=auth.uid())));
$$;
create function app.meeting_person(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'name',coalesce(nullif(p.display_name,''),'이름 없음'),
    'position',p.position,'departmentId',p.department_id,'departmentName',d.name)
  from public.profiles p left join public.departments d on d.id=p.department_id
  where p.id=p_id and p.company_id=app.meeting_company_id();
$$;
create function app.meeting_list() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'title',s.title,'host',app.meeting_person(s.host_id),
    'status',s.status,'durationMinutes',s.duration_minutes,'revision',s.revision,
    'members',coalesce((select jsonb_agg(app.meeting_person(m.profile_id) order by m.profile_id)
      from public.meeting_members m where m.series_id=s.id),'[]'::jsonb),
    'rounds',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'round',r.round_no,'startsAt',coalesce(to_char(r.starts_at at time zone 'Asia/Seoul','YYYY-MM-DD"T"HH24:MI'),''),
      'roomId',coalesce(r.room_id,''),'durationMinutes',r.duration_minutes,
      'content',r.content,'result',r.result,
      'prepMaterials',coalesce((select jsonb_agg(jsonb_build_object(
        'id',f.id,'name',f.file_name,'size',f.size_bytes,'type',f.content_type,'url','',
        'storagePath',f.storage_path,'uploadedBy',app.meeting_person(f.uploaded_by)) order by f.created_at,f.id)
        from public.meeting_files f where f.round_id=r.id and f.ready and f.deleted_at is null),'[]'::jsonb)
    ) order by r.round_no) from public.meeting_rounds r where r.series_id=s.id and r.deleted_at is null),'[]'::jsonb)
  ) order by s.updated_at desc,s.id),'[]'::jsonb)
  from public.meeting_series s where app.meeting_can_read(s.id);
$$;
create function app.meeting_directory() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(app.meeting_person(p.id) order by p.display_name,p.id),'[]'::jsonb)
  from public.profiles p where p.company_id=app.meeting_company_id() and p.status='active';
$$;
create function app.meeting_calendar(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then
    raise exception '회의 일정 조회 범위를 확인해 주세요.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'seriesId',r.series_id,
    'title','예약된 회의','round',r.round_no,'roomId',r.room_id,
    'startsAt',to_char(r.starts_at at time zone 'Asia/Seoul','YYYY-MM-DD"T"HH24:MI'),
    'durationMinutes',r.duration_minutes,'quarterId','q1',
    'host',jsonb_build_object('id','','name',''),'members','[]'::jsonb) order by r.starts_at,r.id)
    from public.meeting_rounds r join public.meeting_series s on s.id=r.series_id
    where r.company_id=app.meeting_company_id() and r.deleted_at is null and s.deleted_at is null
      and r.starts_at >= (p_from::timestamp at time zone 'Asia/Seoul')
      and r.starts_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul')),'[]'::jsonb);
end $$;

create function app.meeting_save(p_series jsonb,p_revision bigint) returns bigint
language plpgsql security definer set search_path='' as $$
declare
  v_company uuid:=app.meeting_company_id(); v_actor uuid:=auth.uid();
  v_id uuid:=(p_series->>'id')::uuid; v_old public.meeting_series;
  v_round jsonb; v_round_id uuid; v_start timestamptz; v_room text;
  v_duration integer; v_old_round public.meeting_rounds; v_revision bigint;
  v_members uuid[]; v_round_ids uuid[];
begin
  if v_company is null then raise exception '승인된 직원만 회의를 저장할 수 있습니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company::text,7341));
  select * into v_old from public.meeting_series where id=v_id for update;
  if found then
    if not app.meeting_can_read(v_id) then raise exception '회의 수정 권한이 없습니다.' using errcode='42501'; end if;
    if v_old.revision is distinct from p_revision then raise exception '다른 사람이 회의를 수정했습니다. 새로고침 후 다시 저장해 주세요.' using errcode='40001'; end if;
    if (p_series#>>'{host,id}')::uuid<>v_old.host_id then raise exception '주최자는 변경할 수 없습니다.' using errcode='42501'; end if;
  else
    if p_revision is distinct from 0 then raise exception '회의가 삭제되었거나 변경되었습니다.' using errcode='40001'; end if;
    if (p_series#>>'{host,id}')::uuid is distinct from v_actor then raise exception '본인 주최 회의만 만들 수 있습니다.' using errcode='42501'; end if;
  end if;
  if jsonb_typeof(p_series->'members') is distinct from 'array' or jsonb_array_length(p_series->'members')>200
    or jsonb_typeof(p_series->'rounds') is distinct from 'array' or jsonb_array_length(p_series->'rounds') not between 1 and 200 then
    raise exception '회의 멤버·회차를 확인해 주세요.';
  end if;
  select coalesce(array_agg(distinct (x->>'id')::uuid),'{}'::uuid[]) into v_members from jsonb_array_elements(p_series->'members') x;
  if v_old.id is null and cardinality(v_members)=0 then raise exception '멤버를 추가하세요.'; end if;
  if v_actor=any(v_members) and v_old.id is null then raise exception '주최자는 멤버에 중복 등록할 수 없습니다.'; end if;
  if exists(select 1 from unnest(v_members) x where not exists(select 1 from public.profiles p where p.id=x and p.company_id=v_company and p.status='active')) then
    raise exception '같은 회사의 재직 중인 직원만 멤버로 지정할 수 있습니다.' using errcode='42501';
  end if;
  select array_agg((x->>'id')::uuid) into v_round_ids from jsonb_array_elements(p_series->'rounds') x;
  if cardinality(v_round_ids)<>(select count(distinct x) from unnest(v_round_ids) x) then raise exception '회의 회차가 중복되었습니다.'; end if;
  if v_old.id is not null and exists(select 1 from public.meeting_rounds r where r.series_id=v_id and r.deleted_at is null and not r.id=any(v_round_ids))
    and v_old.host_id<>v_actor then raise exception '주최자만 예약을 취소할 수 있습니다.' using errcode='42501'; end if;
  insert into public.meeting_series(id,company_id,host_id,title,status,duration_minutes)
  values(v_id,v_company,coalesce(v_old.host_id,v_actor),btrim(p_series->>'title'),p_series->>'status',(p_series->>'durationMinutes')::integer)
  on conflict(id) do update set title=excluded.title,status=excluded.status,duration_minutes=excluded.duration_minutes,
    revision=meeting_series.revision+1,updated_at=now()
  returning revision into v_revision;
  delete from public.meeting_members where series_id=v_id;
  insert into public.meeting_members(company_id,series_id,profile_id) select v_company,v_id,x from unnest(v_members) x;
  update public.meeting_files f set deleted_at=now() where f.round_id in (
    select id from public.meeting_rounds where series_id=v_id and not id=any(v_round_ids)) and f.deleted_at is null;
  update public.meeting_rounds set deleted_at=now() where series_id=v_id and not id=any(v_round_ids) and deleted_at is null;
  for v_round in select value from jsonb_array_elements(p_series->'rounds') loop
    v_round_id:=(v_round->>'id')::uuid;
    v_room:=nullif(v_round->>'roomId','');
    v_start:=nullif(v_round->>'startsAt','')::timestamp at time zone 'Asia/Seoul';
    v_duration:=coalesce((v_round->>'durationMinutes')::integer,(p_series->>'durationMinutes')::integer);
    select * into v_old_round from public.meeting_rounds where id=v_round_id;
    if found and (v_old_round.series_id<>v_id or v_old_round.deleted_at is not null) then raise exception '다른 회의의 회차를 변경할 수 없습니다.' using errcode='42501'; end if;
    if v_start is not null then
      if v_old_round.id is null or v_old_round.starts_at is distinct from v_start or v_old_round.room_id is distinct from v_room then
        if v_start<now() or extract(isodow from v_start at time zone 'Asia/Seoul')>5
          or (v_start at time zone 'Asia/Seoul')::time<'09:00'::time
          or ((v_start at time zone 'Asia/Seoul')::time + make_interval(mins=>v_duration))>'19:00'::time
          or extract(minute from v_start at time zone 'Asia/Seoul')::integer % 30 <>0 then
          raise exception '평일 09:00~19:00 사이의 예약 가능한 시간을 선택해 주세요.';
        end if;
      end if;
      if exists(select 1 from public.meeting_rounds r join public.meeting_series s on s.id=r.series_id
        where r.company_id=v_company and r.id<>v_round_id and r.deleted_at is null and s.deleted_at is null
          and r.room_id=v_room and r.starts_at < v_start+make_interval(mins=>v_duration)
          and r.starts_at+make_interval(mins=>r.duration_minutes)>v_start) then
        raise exception '다른 회의가 먼저 예약한 시간입니다. 일정을 새로고침해 주세요.' using errcode='23P01';
      end if;
    end if;
    insert into public.meeting_rounds(id,company_id,series_id,round_no,room_id,starts_at,duration_minutes,content,result)
    values(v_round_id,v_company,v_id,(v_round->>'round')::integer,v_room,v_start,v_duration,coalesce(v_round->>'content',''),coalesce(v_round->>'result',''))
    on conflict(id) do update set room_id=excluded.room_id,starts_at=excluded.starts_at,duration_minutes=excluded.duration_minutes,content=excluded.content,result=excluded.result;
  end loop;
  return v_revision;
end $$;

create function app.meeting_delete(p_id uuid,p_revision bigint) returns text[]
language plpgsql security definer set search_path='' as $$
declare v_row public.meeting_series; v_paths text[];
begin
  select * into v_row from public.meeting_series where id=p_id for update;
  if not found or v_row.company_id is distinct from app.meeting_company_id() or v_row.deleted_at is not null
    or (v_row.host_id<>auth.uid() and not app.is_admin()) then raise exception '회의 삭제 권한이 없습니다.' using errcode='42501'; end if;
  if v_row.revision is distinct from p_revision then raise exception '다른 사람이 회의를 수정했습니다. 새로고침해 주세요.' using errcode='40001'; end if;
  select coalesce(array_agg(f.storage_path),'{}'::text[]) into v_paths from public.meeting_files f
    join public.meeting_rounds r on r.id=f.round_id where r.series_id=p_id;
  update public.meeting_series set deleted_at=now(),deleted_by=auth.uid(),revision=revision+1,updated_at=now() where id=p_id;
  update public.meeting_files set deleted_at=now() where round_id in (select id from public.meeting_rounds where series_id=p_id) and deleted_at is null;
  return v_paths;
end $$;

create function app.meeting_begin_file(p_round uuid,p_name text,p_type text,p_size bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_round public.meeting_rounds; v_id uuid:=gen_random_uuid(); v_path text;
begin
  select * into v_round from public.meeting_rounds where id=p_round and deleted_at is null;
  if not found or not app.meeting_can_read(v_round.series_id) then raise exception '회의 자료를 올릴 권한이 없습니다.' using errcode='42501'; end if;
  if p_size is null or p_size not between 1 and 52428800 or length(btrim(p_name)) not between 1 and 255
    or lower(p_name) ~ '\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$' then raise exception '50MB 이하의 실행 파일이 아닌 자료만 올려 주세요.'; end if;
  v_path:='companies/'||v_round.company_id||'/meetings/'||v_round.series_id||'/'||p_round||'/'||v_id||'/original';
  insert into public.meeting_files(id,company_id,round_id,uploaded_by,file_name,content_type,size_bytes,storage_path)
  values(v_id,v_round.company_id,p_round,auth.uid(),p_name,coalesce(nullif(p_type,''),'application/octet-stream'),p_size,v_path);
  return jsonb_build_object('id',v_id,'path',v_path);
end $$;
create function app.meeting_finish_file(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_file public.meeting_files;
begin
  select * into v_file from public.meeting_files where id=p_id for update;
  if not found or v_file.uploaded_by<>auth.uid() or v_file.deleted_at is not null
    or not exists(select 1 from public.meeting_rounds r where r.id=v_file.round_id and r.deleted_at is null and app.meeting_can_read(r.series_id)) then
    raise exception '자료 등록 권한이 없습니다.' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='company-meetings' and o.name=v_file.storage_path
    and (o.metadata->>'size')::bigint=v_file.size_bytes) then raise exception '파일 업로드가 완료되지 않았습니다.'; end if;
  update public.meeting_files set ready=true where id=p_id;
end $$;
create function app.meeting_remove_file(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_file public.meeting_files;
begin
  select * into v_file from public.meeting_files where id=p_id for update;
  if not found or v_file.company_id is distinct from app.meeting_company_id() or v_file.uploaded_by<>auth.uid() then
    raise exception '올린 사람만 자료를 삭제할 수 있습니다.' using errcode='42501'; end if;
  update public.meeting_files set deleted_at=coalesce(deleted_at,now()) where id=p_id;
  return v_file.storage_path;
end $$;
create function app.meeting_file_access(p_path text,p_action text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.meeting_files f join public.meeting_rounds r on r.id=f.round_id
    join public.meeting_series s on s.id=r.series_id
    where f.storage_path=p_path and f.company_id=app.meeting_company_id() and case p_action
      when 'read' then f.ready and f.deleted_at is null and r.deleted_at is null and app.meeting_can_read(s.id)
      when 'insert' then not f.ready and f.deleted_at is null and f.uploaded_by=auth.uid() and r.deleted_at is null and app.meeting_can_read(s.id)
      when 'delete' then f.deleted_at is not null and (f.uploaded_by=auth.uid() or s.host_id=auth.uid() or app.is_admin())
      else false end);
$$;

alter table public.meeting_rooms enable row level security;
alter table public.meeting_series enable row level security;
alter table public.meeting_members enable row level security;
alter table public.meeting_rounds enable row level security;
alter table public.meeting_files enable row level security;
create policy meeting_rooms_read on public.meeting_rooms for select to authenticated using(company_id=(select app.meeting_company_id()));
create policy meeting_series_read on public.meeting_series for select to authenticated using(app.meeting_can_read(id));
create policy meeting_members_read on public.meeting_members for select to authenticated using(app.meeting_can_read(series_id));
create policy meeting_rounds_read on public.meeting_rounds for select to authenticated using(deleted_at is null and app.meeting_can_read(series_id));
create policy meeting_files_read on public.meeting_files for select to authenticated using(ready and deleted_at is null and exists(select 1 from public.meeting_rounds r where r.id=round_id));
revoke all on public.meeting_rooms,public.meeting_series,public.meeting_members,public.meeting_rounds,public.meeting_files from anon,authenticated;
grant select on public.meeting_rooms,public.meeting_series,public.meeting_members,public.meeting_rounds,public.meeting_files to authenticated;

insert into storage.buckets(id,name,public,file_size_limit) values('company-meetings','company-meetings',false,52428800);
create policy meeting_storage_read on storage.objects for select to authenticated using(bucket_id='company-meetings' and app.meeting_file_access(name,'read'));
create policy meeting_storage_insert on storage.objects for insert to authenticated with check(bucket_id='company-meetings' and app.meeting_file_access(name,'insert'));
create policy meeting_storage_delete on storage.objects for delete to authenticated using(bucket_id='company-meetings' and app.meeting_file_access(name,'delete'));

-- 공개 API는 invoker, 검사가 필요한 내부 구현은 비공개 app 스키마.
create function public.list_company_meetings() returns jsonb language sql stable security invoker set search_path='' as $$ select app.meeting_list(); $$;
create function public.list_meeting_directory() returns jsonb language sql stable security invoker set search_path='' as $$ select app.meeting_directory(); $$;
create function public.list_meeting_calendar(p_from date,p_to date) returns jsonb language sql stable security invoker set search_path='' as $$ select app.meeting_calendar(p_from,p_to); $$;
create function public.save_company_meeting(p_series jsonb,p_revision bigint) returns bigint language sql security invoker set search_path='' as $$ select app.meeting_save(p_series,p_revision); $$;
create function public.delete_company_meeting(p_id uuid,p_revision bigint) returns text[] language sql security invoker set search_path='' as $$ select app.meeting_delete(p_id,p_revision); $$;
create function public.begin_meeting_file(p_round uuid,p_name text,p_type text,p_size bigint) returns jsonb language sql security invoker set search_path='' as $$ select app.meeting_begin_file(p_round,p_name,p_type,p_size); $$;
create function public.finish_meeting_file(p_id uuid) returns void language sql security invoker set search_path='' as $$ select app.meeting_finish_file(p_id); $$;
create function public.remove_meeting_file(p_id uuid) returns text language sql security invoker set search_path='' as $$ select app.meeting_remove_file(p_id); $$;
do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app' and p.proname like 'meeting_%') or (n.nspname='public' and p.proname in
    ('list_company_meetings','list_meeting_directory','list_meeting_calendar','save_company_meeting','delete_company_meeting','begin_meeting_file','finish_meeting_file','remove_meeting_file')) loop
    execute format('revoke all on function %s from public,anon',r.signature);
    execute format('grant execute on function %s to authenticated',r.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
