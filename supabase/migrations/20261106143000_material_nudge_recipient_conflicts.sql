-- Serialize both clients already deployed and clients that submit a settings snapshot.
do $migration$
declare
  definition text := pg_get_functiondef('app.save_material_nudge_recipients(uuid[])'::regprocedure);
  anchor text := '  delete from public.material_nudge_recipients';
begin
  if strpos(definition,anchor)=0 or strpos(definition,'material-nudge-recipients:')>0 then
    raise exception 'Material nudge settings definition changed; review before applying';
  end if;
  execute replace(definition,anchor,
    '  perform pg_advisory_xact_lock(hashtextextended(''material-nudge-recipients:'' || v_company::text,0));'
    || chr(10) || anchor);
end $migration$;
alter function app.save_material_nudge_recipients(uuid[]) set lock_timeout = '3s';

create function app.save_material_nudge_recipients_checked(p_ids uuid[],p_expected_ids uuid[])
returns void language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare
  v_company uuid := app.permission_company_id();
  v_current uuid[];
begin
  if auth.uid() is null or v_company is null or not coalesce(app.basic_work_allowed('planning'),false) then
    raise exception '자재요청 조르기 대상을 바꿀 권한이 없습니다.' using errcode='42501';
  end if;
  if p_expected_ids is null or array_position(p_expected_ids,null) is not null then
    raise exception '현재 수신자 설정을 다시 확인해 주세요.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('material-nudge-recipients:' || v_company::text,0));
  select coalesce(array_agg(r.profile_id order by r.profile_id),'{}') into v_current
    from public.material_nudge_recipients r where r.company_id=v_company;
  if v_current is distinct from array(select distinct id from unnest(p_expected_ids) as expected(id) order by id)
    and v_current is distinct from array(select distinct id from unnest(p_ids) as desired(id) order by id) then
    raise exception '다른 직원이 조르기 수신자 설정을 변경했습니다.' using errcode='40001';
  end if;
  perform app.save_material_nudge_recipients(p_ids);
end $$;

create function public.save_material_nudge_recipients_checked(p_ids uuid[],p_expected_ids uuid[])
returns void language sql security invoker set search_path='' as $$
  select app.save_material_nudge_recipients_checked(p_ids,p_expected_ids)
$$;
revoke all on function app.save_material_nudge_recipients_checked(uuid[],uuid[]),
  public.save_material_nudge_recipients_checked(uuid[],uuid[]) from public,anon,authenticated;
grant execute on function app.save_material_nudge_recipients_checked(uuid[],uuid[]),
  public.save_material_nudge_recipients_checked(uuid[],uuid[]) to authenticated;
