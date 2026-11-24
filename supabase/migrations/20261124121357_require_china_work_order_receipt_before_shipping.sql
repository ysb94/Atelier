-- The file receipt from the assigned employee belongs to one round.
-- Keep the installed role, destination and row-lock checks in the existing write function.
do $migration$
declare
  body text := replace(pg_get_functiondef('app.china_work_order(uuid,text,text,text,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10));
  action_guard text := $anchor$if p_action not in ('assign','check','ship','handoff') or (p_action<>'handoff' and p_kind not in ('sample','color')) then$anchor$;
  handoff_write text := $anchor$update public.product_drafts set sample_work_orders=items,
   specs=jsonb_set($anchor$;
  round_write text := $anchor$if p_kind='color' and p_action='assign' then$anchor$;
  handoff_receipts text := $handoff$
  if d.specs->'chinaWorkAssignment'->>'assigneeId' is distinct from p_assignee::text and d.status <> 'confirmed' then
   select coalesce(jsonb_agg(round_item order by position) filter (where kind='sample'),'[]'::jsonb),
          coalesce(jsonb_agg(round_item order by position) filter (where kind='color'),'[]'::jsonb)
   into items, target
   from (
    select kind, position, case
      when value->>'assigneeId'=p_assignee::text
       and value->>'shipped' is distinct from 'true' and value->>'passed' is distinct from 'true'
       and nullif(value->>'returnedAt','') is null and nullif(value->>'receivedAt','') is null
      then value || '{"assigneeCheckedAt":null}'::jsonb
      else value end as round_item
    from (
     select 'sample' as kind, value, ordinality as position from jsonb_array_elements(items) with ordinality
     union all
     select 'color', value, ordinality from jsonb_array_elements(target) with ordinality
    ) rounds
   ) refreshed;
  end if;
  $handoff$;
  receipt_guard text := $guard$
 if p_action='ship' and not exists (
  select 1
  from jsonb_array_elements(case when p_kind='color'
    then coalesce(d.specs->'colorSampleRounds','[]'::jsonb)
    else coalesce(d.sample_work_orders,'[]'::jsonb) end) r(item)
  where r.item->>'id'=p_order
    and r.item->>'assigneeId'=d.specs->'chinaWorkAssignment'->>'assigneeId'
    and nullif(d.specs->'chinaWorkAssignment'->>'assignedAt','') is not null
    and nullif(btrim(r.item->>'assigneeCheckedAt'),'') is not null
 ) then
  raise exception '배정받은 담당자가 이 회차의 작업 지시서에서 받기를 눌러야 발송할 수 있습니다.' using errcode='55000';
 end if;
 $guard$;
begin
  if strpos(body,action_guard)=0 or strpos(body,round_write)=0 or strpos(body,handoff_write)=0
    or strpos(body,receipt_guard)>0 then
    raise exception 'China work order definition changed; review before applying';
  end if;
  body := replace(body,action_guard,$guard$if p_action is null or p_action not in ('assign','check','ship','handoff')
   or (p_action<>'handoff' and (p_kind is null or p_kind not in ('sample','color'))) then$guard$);
  body := replace(body,handoff_write,handoff_receipts||handoff_write);
  execute replace(body,round_write,receipt_guard||round_write);
end
$migration$;
