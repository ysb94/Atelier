-- Count one product/request per assignee. Completed work keeps its original round records.
create function app.china_assignee_workloads(p_company uuid,p_profile uuid)
returns table(profile_id uuid,sample_open int,sample_resting int,material_open int,material_resting int)
language sql stable set search_path='' as $$
  with roster as (
    select a.profile_id from public.china_work_assignees a
    where a.company_id=p_company and (p_profile is null or a.profile_id=p_profile)
  ), sample_work as (
    select a.profile_id,d.id,
      bool_or(r.item->>'shipped' is distinct from 'true' and r.item->>'passed' is distinct from 'true'
        and nullif(r.item->>'returnedAt','') is null and nullif(r.item->>'receivedAt','') is null) as is_open
    from public.product_drafts d
    cross join lateral (
      select value as item,false as color from jsonb_array_elements(
        case when jsonb_typeof(d.sample_work_orders)='array' then d.sample_work_orders else '[]'::jsonb end)
      union all
      select value,true from jsonb_array_elements(
        case when jsonb_typeof(d.specs->'colorSampleRounds')='array' then d.specs->'colorSampleRounds' else '[]'::jsonb end)
    ) r
    cross join lateral (values (
      d.specs->'chinaWorkAssignment'->>'assignedAt',
      coalesce(nullif(r.item->>'shippedAt',''),case when r.color then nullif(d.specs->>'colorSampleRequestedAt','') end)
    )) as times(assigned_at,requested_at)
    join roster a on a.profile_id::text=coalesce(nullif(r.item->>'assigneeId',''),
      case when pg_input_is_valid(times.assigned_at,'timestamp with time zone') then
        case when not coalesce(pg_input_is_valid(times.requested_at,'timestamp with time zone'),false)
          or times.requested_at::timestamptz<=times.assigned_at::timestamptz
          then d.specs->'chinaWorkAssignment'->>'assigneeId' end end)
    where d.company_id=p_company and d.status<>'confirmed'
      and nullif(btrim(r.item->>'url'),'') is not null
      and coalesce(nullif(btrim(r.item->>'originCountry'),''),nullif(btrim(d.origin_country),''),'중국') ~* '중국|china'
    group by a.profile_id,d.id
  ), material_work as (
    select a.profile_id,q.id,bool_or(r.shipped_at is null) as is_open
    from roster a join app.material_request_rounds r on r.assignee_id=a.profile_id
    join app.material_requests q on q.id=r.request_id
    where q.company_id=p_company and q.deleted_at is null and q.status<>'completed'
    group by a.profile_id,q.id
  ), sample_counts as (
    select w.profile_id,count(*) filter (where w.is_open)::int as open_count,
      count(*) filter (where not w.is_open)::int as resting_count from sample_work w group by w.profile_id
  ), material_counts as (
    select w.profile_id,count(*) filter (where w.is_open)::int as open_count,
      count(*) filter (where not w.is_open)::int as resting_count from material_work w group by w.profile_id
  )
  select a.profile_id,coalesce(s.open_count,0),coalesce(s.resting_count,0),
    coalesce(m.open_count,0),coalesce(m.resting_count,0)
  from roster a left join sample_counts s on s.profile_id=a.profile_id
  left join material_counts m on m.profile_id=a.profile_id
$$;

-- Assignment holds the roster row until commit. DELETE locks that same row before its guard.
create function app.lock_china_assignee_for_assignment(p_company uuid,p_profile uuid)
returns void language plpgsql set search_path='' set lock_timeout='3s' as $$
begin
  perform 1 from public.china_work_assignees a
    where a.company_id=p_company and a.profile_id=p_profile for key share;
  if not found then
    raise exception '담당자 목록이 변경되었습니다. 새로 조회해 주세요.' using errcode='40001';
  end if;
end $$;

create function app.guard_china_assignee_removal() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_open int;
  v_resting int;
begin
  -- The foreign-key cascade after profile deletion is separate from removing a roster tab.
  if not exists(select 1 from public.profiles p where p.id=old.profile_id) then return old; end if;
  if auth.uid() is not null and (app.permission_company_id() is distinct from old.company_id
    or app.china_work_screen_role() is distinct from 'manager') then
    raise exception '중국 업무 관리자만 담당자를 삭제할 수 있습니다.' using errcode='42501';
  end if;
  select sample_open+material_open,sample_resting+material_resting into v_open,v_resting
    from app.china_assignee_workloads(old.company_id,old.profile_id);
  if coalesce(v_open,0)>0 or coalesce(v_resting,0)>0 then
    raise exception using errcode='23503',message=format('진행 중 %s건 · 완료 대기 %s건이 남아 있습니다.',v_open,v_resting);
  end if;
  return old;
end $$;
create trigger china_work_assignees_guard_delete before delete on public.china_work_assignees
  for each row execute function app.guard_china_assignee_removal();

revoke all on function app.china_assignee_workloads(uuid,uuid),
  app.lock_china_assignee_for_assignment(uuid,uuid),app.guard_china_assignee_removal() from public,anon,authenticated;

do $migration$
declare
  material_read text := pg_get_functiondef('app.read_material_requests(text,uuid,integer)'::regprocedure);
  material_write text := pg_get_functiondef('app.write_material_request(text,uuid,integer,integer,text,uuid,jsonb,text,uuid,integer)'::regprocedure);
  sample_read text := pg_get_functiondef('app.get_my_china_work_orders()'::regprocedure);
  sample_write text := pg_get_functiondef('app.china_work_order(uuid,text,text,text,uuid,timestamptz)'::regprocedure);
  status_anchor text := $anchor$case when v_role<>'planning' or q.status='requested' then '요청중'
        when q.status='completed' then '완료' else '요청예정' end$anchor$;
  material_anchor text := '    if r.assignee_id=p_assignee then return q.revision; end if;';
  sample_anchor text := 'if p_action in (''assign'',''handoff'') and p_assignee is not null then';
  response_anchor text := $anchor$'role','manager','orders','[]'::jsonb,'revision',$anchor$;
  workload_field text := $field$'role','manager','orders','[]'::jsonb,'workloads',(
       select coalesce(jsonb_agg(jsonb_build_object('profileId',w.profile_id,
         'sampleOpen',w.sample_open,'sampleResting',w.sample_resting,
         'materialOpen',w.material_open,'materialResting',w.material_resting) order by w.profile_id),'[]'::jsonb)
       from app.china_assignee_workloads(app.permission_company_id(),null) w
     ),'revision',$field$;
begin
  if strpos(material_read,status_anchor)=0 or strpos(material_write,material_anchor)=0
    or strpos(sample_write,sample_anchor)=0 or strpos(sample_read,response_anchor)=0
    or strpos(sample_read,'''workloads''')>0
    or strpos(material_write,'app.lock_china_assignee_for_assignment')>0
    or strpos(sample_write,'app.lock_china_assignee_for_assignment')>0 then
    raise exception 'China work definitions changed; review before applying';
  end if;
  execute replace(material_read,status_anchor,$status$case when q.status='completed' then '완료'
        when v_role<>'planning' or q.status='requested' then '요청중' else '요청예정' end$status$);
  execute replace(material_write,material_anchor,
    '    perform app.lock_china_assignee_for_assignment(v_company,p_assignee);'||chr(10)||material_anchor);
  execute replace(sample_write,sample_anchor,
    sample_anchor||chr(10)||'  perform app.lock_china_assignee_for_assignment(d.company_id,p_assignee);');
  execute replace(sample_read,response_anchor,workload_field);
end $migration$;
