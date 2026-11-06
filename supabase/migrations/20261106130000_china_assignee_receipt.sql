-- The assigned employee confirms a work order by pressing 받기. That mark is separate from the desk's fileCheckedAt.
create or replace function app.keep_color_sample_assignee() returns trigger language plpgsql set search_path='' as $$
declare rounds jsonb; previous jsonb; index int; current jsonb; saved jsonb;
begin
 if tg_op='UPDATE' and jsonb_typeof(old.specs->'chinaWorkAssignment')='object' and jsonb_typeof(new.specs->'chinaWorkAssignment') is distinct from 'object' then
  new.specs:=jsonb_set(coalesce(new.specs,'{}'::jsonb),'{chinaWorkAssignment}',old.specs->'chinaWorkAssignment');
 end if;
 if tg_op<>'UPDATE' or jsonb_typeof(new.specs->'colorSampleRounds')<>'array' then return new; end if;
 rounds:=new.specs->'colorSampleRounds';
 previous:=coalesce(old.specs->'colorSampleRounds','[]'::jsonb);
 for index in 0..jsonb_array_length(rounds)-1 loop
  current:=rounds->index;
  select value into saved from jsonb_array_elements(previous) where value->>'id'=current->>'id' and value->>'url'=current->>'url' limit 1;
  if saved is null then continue; end if;
  if not (current ? 'assigneeId') and saved ? 'assigneeId' then
   current:=current||jsonb_build_object('assigneeId',saved->'assigneeId','assigneeName',coalesce(saved->'assigneeName','""'::jsonb));
  end if;
  if not (current ? 'fileCheckedAt') and saved ? 'fileCheckedAt' then
   current:=current||jsonb_build_object('fileCheckedAt',saved->'fileCheckedAt');
  end if;
  if not (current ? 'assigneeCheckedAt') and saved ? 'assigneeCheckedAt' then
   current:=current||jsonb_build_object('assigneeCheckedAt',saved->'assigneeCheckedAt');
  end if;
  rounds:=jsonb_set(rounds,array[index::text],current);
 end loop;
 new.specs:=jsonb_set(new.specs,'{colorSampleRounds}',rounds);
 return new;
end $$;

create or replace function app.get_my_china_work_orders() returns jsonb
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
     'returnedAt',r.item->>'returnedAt','receivedAt',r.item->>'receivedAt',
     'assigneeCheckedAt',nullif(r.item->>'assigneeCheckedAt','')
   ) order by d.updated_at desc,d.id,r.kind desc,r.item->'round',r.item->>'id')
   from public.product_drafts d cross join lateral app.china_assigned_rounds(d) r
   where d.company_id=app.permission_company_id()
     and d.specs->'chinaWorkAssignment'->>'assigneeId'=auth.uid()::text
 ),'[]'::jsonb));
end $$;

do $migration$
declare body text;
  worker_check text := $check$
 if app.china_work_screen_role()='worker' and p_action='check' then
  if p_kind='color' then
   select ordinality::int-1 into idx from jsonb_array_elements(coalesce(d.specs->'colorSampleRounds','[]'::jsonb)) with ordinality where value->>'id'=p_order limit 1;
   if idx is null then raise exception '컬러 지시서를 찾지 못했습니다.'; end if;
   item:=coalesce(d.specs->'colorSampleRounds'->idx,'{}'::jsonb)||jsonb_build_object('assigneeCheckedAt',coalesce(nullif(d.specs->'colorSampleRounds'->idx->>'assigneeCheckedAt',''),now()::text));
   perform set_config('app.china_workorder','on',true);
   update public.product_drafts set specs=jsonb_set(specs,array['colorSampleRounds',idx::text],item),updated_at=clock_timestamp() where id=p_draft;
  else
   items:=d.sample_work_orders;
   select value,ordinality::int-1 into item,idx from jsonb_array_elements(items) with ordinality where value->>'id'=p_order;
   if item is null then raise exception '지시서를 찾지 못했습니다.'; end if;
   item:=item||jsonb_build_object('assigneeCheckedAt',coalesce(nullif(item->>'assigneeCheckedAt',''),now()::text));
   items:=jsonb_set(items,array[idx::text],item);
   perform set_config('app.china_workorder','on',true);
   update public.product_drafts set sample_work_orders=items,updated_at=clock_timestamp() where id=p_draft;
  end if;
  perform set_config('app.china_workorder','off',true);
  return;
 end if;
 $check$;
begin
 select pg_get_functiondef('app.china_work_order(uuid,text,text,text,uuid,timestamptz)'::regprocedure) into body;
 if strpos(body,'p_action is distinct from ''ship''')=0 or strpos(body,'if p_action in (''assign'',''handoff'') and p_assignee is not null then')=0 then
  raise exception 'China work order definition changed; review before applying';
 end if;
 body:=replace(body,'p_action is distinct from ''ship''','p_action not in (''ship'',''check'')');
 body:=replace(body,'if p_action in (''assign'',''handoff'') and p_assignee is not null then',worker_check||'if p_action in (''assign'',''handoff'') and p_assignee is not null then');
 execute body;
end $migration$;

do $migration$
declare body text;
begin
 select pg_get_functiondef(p.oid) into body from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='save_product_draft';
 if body is null or strpos(body,'assigneeCheckedAt')>0 then return; end if;
 if strpos(body,'''fileCheckedAt'',o.value->''fileCheckedAt'',''returnedAt'',o.value->''returnedAt''')=0 then
  raise exception 'Draft save no longer preserves the work-order receipt; review before applying';
 end if;
 execute replace(body,'''fileCheckedAt'',o.value->''fileCheckedAt'',''returnedAt'',o.value->''returnedAt''',
  '''fileCheckedAt'',o.value->''fileCheckedAt'',''assigneeCheckedAt'',o.value->''assigneeCheckedAt'',''returnedAt'',o.value->''returnedAt''');
end $migration$;
