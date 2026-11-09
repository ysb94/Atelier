create or replace function app.china_assigned_rounds(d public.product_drafts)
returns table(kind text, item jsonb, closed boolean)
language sql stable set search_path='' as $$
 select r.kind,r.item,
   coalesce(r.item->>'shipped'='true',false) or coalesce(r.item->>'passed'='true',false)
   or nullif(r.item->>'returnedAt','') is not null or nullif(r.item->>'receivedAt','') is not null
   or d.status='confirmed'
 from (
   select 'sample'::text as kind,value as item from jsonb_array_elements(coalesce(d.sample_work_orders,'[]'))
   union all
   select 'color',value from jsonb_array_elements(coalesce(d.specs->'colorSampleRounds','[]'))
 ) r
 where d.specs->'chinaWorkAssignment'->>'assigneeId'=auth.uid()::text
   and r.item->>'assigneeId'=auth.uid()::text
   and nullif(r.item->>'url','') is not null
   and (
     coalesce(nullif(btrim(r.item->>'originCountry'),''),nullif(btrim(d.origin_country),''),'중국') ~* '중국|china'
     -- Assigned, completed rounds from other origins are visible as history only.
     or nullif(r.item->>'receivedAt','') is not null
     or r.item->>'passed'='true'
     or (r.kind='sample' and r.item->>'shipped'='true')
     or (r.kind='color' and nullif(r.item->>'returnedAt','') is not null)
   )
   and nullif(d.specs->'chinaWorkAssignment'->>'assignedAt','') is not null
   and (
     coalesce(nullif(r.item->>'shippedAt',''),case when r.kind='color' then nullif(d.specs->>'colorSampleRequestedAt','') end) is null
     or coalesce(nullif(r.item->>'shippedAt',''),case when r.kind='color' then nullif(d.specs->>'colorSampleRequestedAt','') end)::timestamptz
       <= (d.specs->'chinaWorkAssignment'->>'assignedAt')::timestamptz
   )
$$;
