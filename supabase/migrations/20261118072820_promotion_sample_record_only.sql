-- Promotion retains its own label and sample history, with no China-team dispatch.
create function app.is_promotion_sample_destination(p_country text)
returns boolean
language sql immutable set search_path = '' as $$
  select btrim(coalesce(p_country, '')) ~* '^promotion[[:space:]]*\[(중국|china)\]$'
$$;

revoke all on function app.is_promotion_sample_destination(text) from public, anon, authenticated;

do $migration$
declare
  assigned_read text := pg_get_functiondef('app.china_assigned_rounds(public.product_drafts)'::regprocedure);
  workload_read text := pg_get_functiondef('app.china_assignee_workloads(uuid,uuid)'::regprocedure);
  order_write text := pg_get_functiondef('app.china_work_order(uuid,text,text,text,uuid,timestamptz)'::regprocedure);
  assigned_anchor text := $anchor$and nullif(r.item->>'url','') is not null$anchor$;
  workload_anchor text := $anchor$and nullif(btrim(r.item->>'url'),'') is not null$anchor$;
  promotion_filter text := $filter$ and not app.is_promotion_sample_destination(
    coalesce(nullif(btrim(r.item->>'originCountry'),''),d.origin_country))$filter$;
  write_anchor text := $anchor$if p_action in ('assign','handoff') and p_assignee is not null then$anchor$;
  assign_round text := $anchor$value||jsonb_build_object('assigneeId',p_assignee,'assigneeName',coalesce(assignee_name,'')) order by ordinality$anchor$;
  assign_eligible_round text := $replace$case
    when app.is_promotion_sample_destination(coalesce(nullif(btrim(value->>'originCountry'),''),d.origin_country)) then value
    else value||jsonb_build_object('assigneeId',p_assignee,'assigneeName',coalesce(assignee_name,''))
  end order by ordinality$replace$;
  write_guard text := $guard$
 if p_action='handoff' and (
   select coalesce(bool_and(app.is_promotion_sample_destination(
     coalesce(nullif(btrim(r.value->>'originCountry'),''),d.origin_country))),false)
   from (
     select value from jsonb_array_elements(coalesce(d.sample_work_orders,'[]'::jsonb))
     union all
     select value from jsonb_array_elements(coalesce(d.specs->'colorSampleRounds','[]'::jsonb))
   ) r where nullif(r.value->>'url','') is not null
 ) then
   raise exception '프로모션 샘플은 기획안에만 기록됩니다.' using errcode='42501';
 end if;
 if p_action<>'handoff' and app.is_promotion_sample_destination(coalesce(
   (select nullif(btrim(value->>'originCountry'),'')
      from jsonb_array_elements(case when p_kind='color'
        then coalesce(d.specs->'colorSampleRounds','[]'::jsonb)
        else coalesce(d.sample_work_orders,'[]'::jsonb) end)
      where value->>'id'=p_order limit 1),
   d.origin_country
 )) then
   raise exception '프로모션 샘플은 기획안에만 기록됩니다.' using errcode='42501';
 end if;
  $guard$;
begin
  if strpos(assigned_read,assigned_anchor)=0 or strpos(workload_read,workload_anchor)=0
    or strpos(order_write,write_anchor)=0
    or length(order_write)-length(replace(order_write,assign_round,''))<>2*length(assign_round) then
    raise exception 'China sample work definitions changed; review before applying';
  end if;
  execute replace(assigned_read,assigned_anchor,assigned_anchor||promotion_filter);
  execute replace(workload_read,workload_anchor,workload_anchor||promotion_filter);
  execute replace(replace(order_write,write_anchor,write_guard||write_anchor),assign_round,assign_eligible_round);
end $migration$;
