-- 기존 회의·응답·자료·채팅은 유지한다. 구 버전의 kind 없는 요청은 기존 성격을 보존한다.
begin;
alter table public.meeting_series add column kind text not null default 'project'
  check (kind in ('meeting','one_off','project','routine','interview'));
comment on column public.meeting_series.kind is '회의 성격. 기존 회의는 project, 생성 후 변경 불가.';

-- 현재 함수의 필요한 부분만 바꾸고, 예상한 코드가 없으면 전체 적용을 중단한다.
create function pg_temp.patch_meeting_function(signature regprocedure, old_code text, new_code text, old_code2 text default null, new_code2 text default null)
returns void language plpgsql as $$
declare definition text := replace(pg_get_functiondef(signature), E'\r\n', E'\n');
begin
  if strpos(definition,old_code)=0 then raise exception '회의 함수 % 버전이 다릅니다. 적용을 중단합니다.',signature; end if;
  definition:=replace(definition,old_code,new_code);
  if old_code2 is not null then
    if strpos(definition,old_code2)=0 then raise exception '회의 함수 %의 두 번째 구간이 다릅니다.',signature; end if;
    definition:=replace(definition,old_code2,new_code2);
  end if;
  execute definition;
end $$;

select pg_temp.patch_meeting_function('app.meeting_write(jsonb,bigint,uuid)',
  ' v_member_changed boolean;', ' v_kind text; v_member_changed boolean;');
select pg_temp.patch_meeting_function('app.meeting_write(jsonb,bigint,uuid)',
  $old$ select coalesce(array_agg((x->>'id')::uuid order by x->>'id')$old$,
  $new$ v_kind:=coalesce(p_series->>'kind',v_old.kind,'project');
 if v_kind not in ('meeting','one_off','project','routine','interview')
   or (p_series ? 'kind' and jsonb_typeof(p_series->'kind')<>'string') then
   raise exception '올바른 회의 성격을 선택하세요.' using errcode='23514'; end if;
 if v_old.id is not null and v_old.kind<>v_kind then
   raise exception '생성한 회의의 성격은 변경할 수 없습니다.' using errcode='23514'; end if;
 if v_kind in ('meeting','one_off','interview') and jsonb_array_length(p_series->'rounds')<>1 then
   raise exception '미팅·1회성 회의·면접은 한 회차만 사용합니다.' using errcode='23514'; end if;
 if v_kind='meeting' and exists(select 1 from jsonb_array_elements(p_series->'rounds') x
   where coalesce(btrim(x->>'content'),'')<>'' or coalesce(btrim(x->>'result'),'')<>''
     or jsonb_array_length(coalesce(x->'prepMaterials','[]'::jsonb))>0) then
   raise exception '미팅은 일정과 진행 기록만 저장합니다.' using errcode='23514'; end if;
 if v_kind='meeting' and p_series->>'status'='done' and not exists(
   select 1 from public.meeting_rounds where series_id=v_id and confirmed_at is not null and deleted_at is null) then
   raise exception '미팅 일정을 먼저 확정하세요.' using errcode='23514'; end if;
 select coalesce(array_agg((x->>'id')::uuid order by x->>'id')$new$);
select pg_temp.patch_meeting_function('app.meeting_write(jsonb,bigint,uuid)',
  '(v_old.id is null and cardinality(v_members)=0)',
  '(v_old.id is null and cardinality(v_members)=0 and v_kind in (''project'',''routine''))');
select pg_temp.patch_meeting_function('app.meeting_save_before_invitations(jsonb,bigint)',
  'if v_old.id is null and cardinality(v_members)=0 then',
  'if v_old.id is null and cardinality(v_members)=0 and coalesce(p_series->>''kind'',''project'') in (''project'',''routine'') then');
select pg_temp.patch_meeting_function('app.meeting_write(jsonb,bigint,uuid)',
  'update public.meeting_series set host_id=v_host,phase=',
  'update public.meeting_series set kind=v_kind,host_id=v_host,phase=');
select pg_temp.patch_meeting_function('app.meeting_write(jsonb,bigint,uuid)',
  'from unnest(v_members) x' || E'\n' || '       on conflict',
  'from unnest(v_members) x where v_kind<>''meeting''' || E'\n' || '       on conflict');

select pg_temp.patch_meeting_function('app.meeting_list()',
  '''title'', s.title,', '''title'', s.title, ''kind'', s.kind,');
select pg_temp.patch_meeting_function('app.meeting_list()',
  '''responses'', coalesce(', '''responses'', case when s.kind=''meeting'' then ''[]''::jsonb else coalesce(',
  E'\n        where m.series_id = s.id), ''[]''::jsonb)', E'\n        where m.series_id = s.id), ''[]''::jsonb) end');
select pg_temp.patch_meeting_function('app.meeting_calendar(date,date)',
  'jsonb_agg(item)', 'jsonb_agg(item || jsonb_build_object(''kind'',s.kind))',
  'where r.confirmed_at is not null',
  'join public.meeting_series s on s.id=r.series_id where r.confirmed_at is not null');
select pg_temp.patch_meeting_function('app.meeting_respond(uuid,integer,text)',
  ' select status into old_status',
  $new$ if s.kind='meeting' then raise exception '미팅은 참석 응답을 받지 않습니다.' using errcode='42501'; end if;
 select status into old_status$new$);
select pg_temp.patch_meeting_function('app.meeting_begin_file(uuid,text,text,bigint)',
  ' return app.meeting_begin_file_before_invitations',
  $new$ if exists(select 1 from public.meeting_rounds r join public.meeting_series s on s.id=r.series_id where r.id=p_round and s.kind='meeting') then
   raise exception '미팅에는 회의 자료를 올리지 않습니다.' using errcode='23514'; end if;
 return app.meeting_begin_file_before_invitations$new$);
drop function pg_temp.patch_meeting_function(regprocedure,text,text,text,text);
commit;
