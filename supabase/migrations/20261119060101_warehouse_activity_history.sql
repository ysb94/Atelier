-- Preserve a business event when the warehouse save commits, independently of sheet delivery.
create table app.warehouse_activity (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  record_type text not null check (record_type in ('sheet','condition','stock_movement','box_movement')),
  record_id uuid not null,
  transaction_id xid8 not null default pg_current_xact_id(),
  source text not null check (source in ('atelier','finder','warehouse')),
  action text not null,
  actor_id uuid,
  actor_name text,
  place text,
  reason text,
  before_rows jsonb not null default '[]',
  after_rows jsonb not null default '[]',
  row_keys text[] not null default '{}',
  qr_codes text[] not null default '{}',
  created_at timestamptz not null,
  unique (brand_id,record_type,record_id)
);
create index warehouse_activity_recent on app.warehouse_activity(brand_id,created_at desc,id desc);
create index warehouse_activity_transaction on app.warehouse_activity(brand_id,transaction_id);
create index warehouse_activity_qr on app.warehouse_activity using gin(qr_codes);
alter table app.warehouse_activity enable row level security;
revoke all on app.warehouse_activity from public,anon,authenticated,service_role;

create function app.warehouse_activity_actor(p_brand uuid,p_actor uuid)
returns text language sql stable set search_path='' as $$
  select nullif(btrim(p.display_name),'') from public.profiles p
  join public.brands b on b.id=p_brand and b.company_id=p.company_id
  where p.id=p_actor
$$;

create function app.warehouse_activity_sheet_rows(p_rows jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',r->>'id','qr',nullif(upper(btrim(r->>'qr')),''),
    'sku',r->'values'->>0,'name',r->'values'->>1,'location',r->'values'->>2,
    'receivedOn',r->'values'->>3,'unitsPerBox',r->'values'->>4,'boxes',r->'values'->>5,
    'note',coalesce(r->>'rawNote',r->'values'->>6),'opened',r->>'opened'
  )) order by ord),'[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_rows)='array' then p_rows else '[]'::jsonb end)
    with ordinality x(r,ord)
$$;

create function app.warehouse_activity_condition_row(p_id text,p_row jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select case when p_row is null or p_row='null'::jsonb then '[]'::jsonb
    else jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id',p_id,'qr',nullif(upper(btrim(p_row->>'boxQr')),''),
      'sku',p_row->>'number','name',p_row->>'productName','location',p_row->>'place',
      'receivedOn',p_row->>'receivedOn','unitsPerBox',p_row->>'units','boxes',p_row->>'boxes',
      'opened',p_row->>'openedUnits','note',p_row->>'note'))) end
$$;

create function app.record_warehouse_activity(
  p_brand uuid,p_type text,p_record uuid,p_source text,p_action text,p_actor uuid,
  p_place text,p_reason text,p_before jsonb,p_after jsonb,p_time timestamptz
) returns void language sql set search_path='' as $$
  insert into app.warehouse_activity(brand_id,record_type,record_id,source,action,actor_id,actor_name,
    place,reason,before_rows,after_rows,row_keys,qr_codes,created_at)
  select p_brand,p_type,p_record,p_source,p_action,p_actor,app.warehouse_activity_actor(p_brand,p_actor),
    nullif(p_place,''),nullif(p_reason,''),p_before,p_after,
    array(select distinct r->>'id' from jsonb_array_elements(p_before||p_after) r where nullif(r->>'id','') is not null),
    array(select distinct r->>'qr' from jsonb_array_elements(p_before||p_after) r where nullif(r->>'qr','') is not null),
    p_time
  on conflict (brand_id,record_type,record_id) do nothing
$$;

create function app.capture_warehouse_activity()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_source text;
  v_action text;
  v_actor uuid;
  v_mode text;
  v_placement app.finder_warehouse_placement_operations;
  v_before jsonb;
  v_after jsonb;
  v_item jsonb;
begin
  if tg_table_name='warehouse_qr_audit_sheet_exports' then
    v_before:=app.warehouse_activity_sheet_rows(new.before_rows);
    v_after:=app.warehouse_activity_sheet_rows(new.after_rows);
    v_actor:=new.stock_actor_id;
    v_action:=new.stock_request->>'action';
    if v_action='finder' then
      select o.* into v_placement
        from app.finder_warehouse_placement_operations o where o.id=new.id and o.brand_id=new.brand_id;
      v_mode:=v_placement.request->>'mode';
      v_actor:=coalesce(v_actor,v_placement.actor_id);
      v_source:='finder';
      v_action:=case when v_mode='outbound' then 'box_outbound'
        when v_mode='clear' or jsonb_array_length(v_after)=0 then 'presumed_deplete'
        when nullif(v_placement.plan->'write'->'source','null'::jsonb) is null then 'receive'
        when v_placement.plan->'write'->'source'->>'place' is distinct from v_placement.plan->'write'->>'place' then 'move'
        else 'adjust' end;
    elsif v_action in ('finder-inbound','finder-cargo') or (v_action='receive' and exists (
      select 1 from app.finder_unplaced_box_qr_links l where l.brand_id=new.brand_id and l.id=new.id
    )) then
      v_source:='finder'; v_action:='receive';
    elsif v_action is null and exists(select 1 from app.warehouse_qr_audits a where a.brand_id=new.brand_id and a.id=new.id) then
      v_source:='finder'; v_action:='audit';
      select a.actor_id into v_actor from app.warehouse_qr_audits a where a.brand_id=new.brand_id and a.id=new.id;
    else
      v_source:='atelier'; v_action:=coalesce(v_action,'review');
    end if;
    perform app.record_warehouse_activity(new.brand_id,'sheet',new.id,v_source,v_action,coalesce(v_actor,auth.uid()),
      coalesce(new.whole_place,new.stock_request->>'place',v_placement.plan->>'place'),
      coalesce(nullif(new.stock_request->>'reason',''),v_placement.plan->'write'->>'reason'),v_before,v_after,new.queued_at);
  elsif tg_table_name='warehouse_stock_condition_exports' then
    v_before:=app.warehouse_activity_condition_row(new.external_row_id,new.before_values);
    v_after:=app.warehouse_activity_condition_row(new.external_row_id,new.sheet_values);
    v_action:=case when v_before='[]'::jsonb then 'receive' else 'adjust' end;
    perform app.record_warehouse_activity(new.brand_id,'condition',new.request_id,'atelier',v_action,auth.uid(),null,
      null,v_before,v_after,new.saved_at);
  elsif tg_table_name='warehouse_box_movements' then
    select jsonb_strip_nulls(jsonb_build_object('qr',nullif(upper(btrim(b.display_code)),''),
      'sku',s.style_no,'name',s.name)) into v_item
      from public.warehouse_boxes b left join public.styles s on s.brand_id=b.brand_id and s.id=b.style_id
      where b.brand_id=new.brand_id and b.id=new.box_id;
    v_item:=coalesce(v_item,'{}'::jsonb);
    perform app.record_warehouse_activity(new.brand_id,'box_movement',new.id,'warehouse',new.action,new.actor_id,null,new.reason,
      case when new.from_location_code is null and new.from_qty is null then '[]'::jsonb
        else jsonb_build_array(v_item||jsonb_strip_nulls(jsonb_build_object('location',new.from_location_code,'quantity',new.from_qty))) end,
      jsonb_build_array(v_item||jsonb_strip_nulls(jsonb_build_object('location',new.to_location_code,'quantity',new.to_qty))),new.created_at);
  else
    if new.action in ('import','restore') then return new; end if;
    select jsonb_strip_nulls(jsonb_build_object('id',p.external_row_id,'qr',nullif(upper(btrim(coalesce(p.box_qr,b.display_code))),''),
      'sku',coalesce(nullif(p.source_style_no,''),s.style_no),'name',coalesce(nullif(p.source_product_name,''),s.name)))
      into v_item from (select 1) seed
      left join public.warehouse_stock_positions p on p.brand_id=new.brand_id and p.id=new.position_id
      left join public.warehouse_boxes b on b.brand_id=new.brand_id and b.id=new.box_id
      left join public.styles s on s.brand_id=new.brand_id and s.id=new.style_id;
    perform app.record_warehouse_activity(new.brand_id,'stock_movement',new.id,'warehouse',new.action,new.actor_id,
      coalesce(new.to_location_code,new.from_location_code),new.reason,
      case when new.from_location_code is null then '[]'::jsonb
        else jsonb_build_array(v_item||jsonb_build_object('location',new.from_location_code)) end,
      jsonb_build_array(v_item||jsonb_strip_nulls(jsonb_build_object('location',new.to_location_code,
        'workedBoxes',new.box_count,'workedUnits',new.unit_count))),new.created_at);
  end if;
  return new;
end;
$$;

create trigger warehouse_activity_from_sheet after insert on app.warehouse_qr_audit_sheet_exports
for each row execute function app.capture_warehouse_activity();
create trigger warehouse_activity_from_condition after insert on app.warehouse_stock_condition_exports
for each row execute function app.capture_warehouse_activity();
create trigger warehouse_activity_from_stock after insert on public.warehouse_stock_movements
for each row execute function app.capture_warehouse_activity();
create trigger warehouse_activity_from_box after insert on public.warehouse_box_movements
for each row execute function app.capture_warehouse_activity();

create function app.list_warehouse_activity(
  p_brand uuid,p_qr text,p_search text,p_before_at timestamptz,p_before_id uuid
)
returns table(id uuid,source text,action text,actor_name text,place text,reason text,
  before_rows jsonb,after_rows jsonb,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare qr text:=nullif(upper(btrim(p_qr)),''); keyword text:=nullif(btrim(p_search),'');
begin
  if auth.uid() is null or not coalesce(app.can_read_brand(p_brand),false) or not exists (
    select 1 from public.brands b where b.id=p_brand and app.can_read_company(b.company_id)
  ) then
    raise exception '창고 이력을 볼 권한이 없습니다.' using errcode='42501';
  end if;
  if (p_before_at is null) <> (p_before_id is null) or length(qr)>150 or length(keyword)>100 then
    raise exception '이력 조회 조건을 확인해 주세요.' using errcode='22023';
  end if;
  return query
    with events as (
      select e.id,e.source,
        case when cleared.matches then 'presumed_deplete' else e.action end as action,
        e.actor_name,e.place,case when not cleared.matches then e.reason end as reason,
        e.before_rows,e.after_rows,e.created_at
      from app.warehouse_activity e
      cross join lateral (
        select qr is not null and e.source='finder' and e.action in ('receive','move','adjust')
          and not exists(select 1 from jsonb_array_elements(e.after_rows) r where r->>'qr'=qr) as matches
      ) cleared
      where e.brand_id=p_brand and (qr is null or e.qr_codes @> array[qr])
        and (p_before_at is null or (e.created_at,e.id)<(p_before_at,p_before_id))
        and (e.record_type in ('sheet','condition') or not exists (
          select 1 from app.warehouse_activity primary_event
          where primary_event.brand_id=e.brand_id and primary_event.transaction_id=e.transaction_id
            and primary_event.record_type in ('sheet','condition')
            and primary_event.actor_id is not distinct from e.actor_id
            and (primary_event.qr_codes && e.qr_codes or primary_event.row_keys && e.row_keys
              or (e.record_type='stock_movement' and cardinality(e.row_keys)=0 and cardinality(e.qr_codes)=0
                and primary_event.source='finder' and (
                  (primary_event.action='audit' and primary_event.place=e.place)
                  or exists (
                    select 1 from jsonb_array_elements(primary_event.before_rows||primary_event.after_rows) r
                    where upper(regexp_replace(r->>'location','//[[:space:]]*$',''))=upper(e.place)
                      and (nullif(e.after_rows->0->>'sku','') is null
                        or upper(r->>'sku')=upper(e.after_rows->0->>'sku'))
                  )
                ))
              )
        ))
      union all
      select m.id,'warehouse',m.action,app.warehouse_activity_actor(p_brand,m.actor_id),null,m.reason,
        case when m.from_location_code is null and m.from_qty is null then '[]'::jsonb
          else jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('qr',qr,'location',m.from_location_code,'quantity',m.from_qty))) end,
        jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('qr',qr,'location',m.to_location_code,'quantity',m.to_qty))),m.created_at
      from public.warehouse_boxes b join public.warehouse_box_movements m on m.brand_id=b.brand_id and m.box_id=b.id
      where qr is not null and b.brand_id=p_brand and b.display_code=qr
        and (p_before_at is null or (m.created_at,m.id)<(p_before_at,p_before_id))
        and not exists(select 1 from app.warehouse_activity e
          where e.brand_id=p_brand and e.record_type='box_movement' and e.record_id=m.id)
    )
    select e.id,e.source,e.action,e.actor_name,e.place,e.reason,e.before_rows,e.after_rows,e.created_at
    from events e
    where keyword is null or strpos(lower(concat_ws(' ',e.actor_name,e.place,e.reason,e.before_rows::text,e.after_rows::text)),lower(keyword))>0
    order by e.created_at desc,e.id desc limit 51;
end;
$$;

create function public.list_warehouse_activity(
  p_brand uuid,p_qr text default null,p_search text default null,p_before_at timestamptz default null,p_before_id uuid default null
)
returns table(id uuid,source text,action text,actor_name text,place text,reason text,
  before_rows jsonb,after_rows jsonb,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select * from app.list_warehouse_activity(p_brand,p_qr,p_search,p_before_at,p_before_id)
$$;

revoke all on function app.warehouse_activity_actor(uuid,uuid),app.warehouse_activity_sheet_rows(jsonb),
  app.warehouse_activity_condition_row(text,jsonb),app.record_warehouse_activity(uuid,text,uuid,text,text,uuid,text,text,jsonb,jsonb,timestamptz),
  app.capture_warehouse_activity(),app.list_warehouse_activity(uuid,text,text,timestamptz,uuid),
  public.list_warehouse_activity(uuid,text,text,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function app.list_warehouse_activity(uuid,text,text,timestamptz,uuid),
  public.list_warehouse_activity(uuid,text,text,timestamptz,uuid)
  to authenticated;
