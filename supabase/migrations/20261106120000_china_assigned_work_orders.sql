-- Resolve China work roles from the active account and the Operations Support contact list.
create function app.china_work_screen_role() returns text
language sql stable security definer set search_path='' as $$
 select case
   when app.work_operator() then 'manager'
   when p.department_id <> app.work_department('china') or p.department_id is null then 'denied'
   when exists (
     select 1 from public.department_workforce_policies w
     where w.company_id=p.company_id and w.department_id=p.department_id
       and w.mode='external' and p.id=any(w.contact_ids)
   ) then 'manager'
   else 'worker'
 end
 from public.profiles p
 where p.id=auth.uid() and p.status='active' and app.basic_work_allowed('china')
$$;

-- Shared by the scoped read and the existing mutation, so direct RPC calls have the same boundary.
create function app.china_assigned_rounds(d public.product_drafts)
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
   and coalesce(nullif(btrim(r.item->>'originCountry'),''),nullif(btrim(d.origin_country),''),'중국') ~* '중국|china'
   and nullif(d.specs->'chinaWorkAssignment'->>'assignedAt','') is not null
   and (
     coalesce(nullif(r.item->>'shippedAt',''),case when r.kind='color' then nullif(d.specs->>'colorSampleRequestedAt','') end) is null
     or coalesce(nullif(r.item->>'shippedAt',''),case when r.kind='color' then nullif(d.specs->>'colorSampleRequestedAt','') end)::timestamptz
       <= (d.specs->'chinaWorkAssignment'->>'assignedAt')::timestamptz
   )
$$;

create function app.get_my_china_work_orders() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare screen_role text := coalesce(app.china_work_screen_role(),'denied');
begin
 if screen_role='manager' then
   return jsonb_build_object('role','manager','orders','[]'::jsonb,'revision',(
     select max(d.updated_at) from public.product_drafts d where d.company_id=app.permission_company_id()
   ));
 end if;
 if screen_role<>'worker' then
   return jsonb_build_object('role',screen_role,'orders','[]'::jsonb);
 end if;
 return jsonb_build_object('role','worker','orders',coalesce((
   select jsonb_agg(jsonb_build_object(
     'draftId',d.id,'revision',d.updated_at,'draftNo',d.draft_no,
     'brandId',d.brand_id,'nameKo',d.name_ko,'nameEn',d.name_en,'imageUrl',d.image_url,'owner',d.owner,
     'orderId',r.item->>'id','kind',r.kind,'round',r.item->'round','sampleStage',r.item->>'sampleStage',
     'fileName',r.item->>'name','closed',r.closed,
     'returnedAt',r.item->>'returnedAt','receivedAt',r.item->>'receivedAt'
   ) order by d.updated_at desc,d.id,r.kind desc,r.item->'round',r.item->>'id')
   from public.product_drafts d cross join lateral app.china_assigned_rounds(d) r
   where d.company_id=app.permission_company_id()
     and d.specs->'chinaWorkAssignment'->>'assigneeId'=auth.uid()::text
 ),'[]'::jsonb));
end $$;

create function public.get_my_china_work_orders() returns jsonb
language sql stable security invoker set search_path='' as $$ select app.get_my_china_work_orders() $$;

create function app.get_my_china_work_order_file(p_draft uuid,p_order text,p_kind text) returns text
language sql stable security definer set search_path='' as $$
 select r.item->>'url' from public.product_drafts d
 cross join lateral app.china_assigned_rounds(d) r
 where app.china_work_screen_role()='worker' and d.id=p_draft
   and d.company_id=app.permission_company_id() and r.kind=p_kind and r.item->>'id'=p_order
$$;

create function public.get_my_china_work_order_file(p_draft uuid,p_order text,p_kind text) returns text
language sql stable security invoker set search_path='' as $$
 select app.get_my_china_work_order_file(p_draft,p_order,p_kind)
$$;

revoke all on function app.china_work_screen_role(),app.china_assigned_rounds(public.product_drafts),
  app.get_my_china_work_orders(),public.get_my_china_work_orders(),
  app.get_my_china_work_order_file(uuid,text,text),public.get_my_china_work_order_file(uuid,text,text) from public,anon,authenticated;
grant execute on function app.get_my_china_work_orders(),public.get_my_china_work_orders(),
  app.get_my_china_work_order_file(uuid,text,text),public.get_my_china_work_order_file(uuid,text,text) to authenticated;

-- Keep the installed write function and its existing revision check and mutation logic.
do $migration$
declare
 body text;
 anchor text := 'if p_action in (''assign'',''handoff'') and p_assignee is not null then';
 guard text := $guard$
 if app.china_work_screen_role() is distinct from 'manager' then
  if app.china_work_screen_role() is distinct from 'worker'
    or p_action is distinct from 'ship'
    or not exists(select 1 from app.china_assigned_rounds(d) r where r.kind=p_kind and r.item->>'id'=p_order and not r.closed)
  then raise exception '본인에게 배정된 진행 중 지시서만 발송할 수 있습니다.' using errcode='42501';
  end if;
 end if;
 $guard$;
begin
 select pg_get_functiondef('app.china_work_order(uuid,text,text,text,uuid,timestamptz)'::regprocedure) into body;
 if strpos(body,anchor)=0 or strpos(body,'p_action=''handoff''')=0 then
   raise exception 'China work order definition changed; review before applying';
 end if;
 execute replace(body,anchor,guard||anchor);
end $migration$;
