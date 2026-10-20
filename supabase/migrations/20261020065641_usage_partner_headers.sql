-- Additive, opt-in partner settings. Does not update shared products, assignments,
-- components, or legacy usage_code_columns. Apply only after rollout approval.
create or replace function app.usage_partner_can_read(p_brand_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select app.can_read_brand(p_brand_id) and exists (
    select 1 from public.brands b join public.profiles p on p.company_id = b.company_id
    where b.id = p_brand_id and p.id = auth.uid() and p.status = 'active'
  );
$$;

create or replace function app.usage_partner_can_manage(p_brand_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select app.usage_partner_can_read(p_brand_id)
    and (app.is_admin() or app.is_brand_lead(p_brand_id));
$$;

create table public.usage_partner_editors (
  brand_id uuid not null,
  usage_target_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (brand_id, usage_target_id, profile_id),
  foreign key (brand_id, usage_target_id) references public.code_usage_targets(brand_id,id) on delete cascade
);
alter table public.usage_partner_editors enable row level security;
create policy usage_partner_editors_read on public.usage_partner_editors for select to authenticated
  using (app.usage_partner_can_read(brand_id));
create policy usage_partner_editors_insert on public.usage_partner_editors for insert to authenticated
  with check (app.usage_partner_can_manage(brand_id));
create policy usage_partner_editors_update on public.usage_partner_editors for update to authenticated
  using (app.usage_partner_can_manage(brand_id)) with check (app.usage_partner_can_manage(brand_id));
create policy usage_partner_editors_delete on public.usage_partner_editors for delete to authenticated
  using (app.usage_partner_can_manage(brand_id));

create or replace function app.usage_partner_can_edit(p_brand_id uuid, p_target_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select app.usage_partner_can_read(p_brand_id) and app.can_edit_brand(p_brand_id) and (
    app.usage_partner_can_manage(p_brand_id) or exists (
      select 1 from public.usage_partner_editors e
      where e.brand_id=p_brand_id and e.usage_target_id=p_target_id and e.profile_id=auth.uid()
        and exists (select 1 from public.brand_members bm where bm.brand_id=e.brand_id and bm.profile_id=e.profile_id)
    )
  );
$$;

create or replace function app.validate_usage_partner_editor()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.brand_id,new.usage_target_id,new.profile_id)
      is distinct from (old.brand_id,old.usage_target_id,old.profile_id) then
    raise exception '담당자 연결의 식별자는 변경할 수 없습니다.';
  end if;
  if not exists (
    select 1 from public.profiles p join public.brand_members bm on bm.profile_id=p.id
    join public.brands b on b.id=bm.brand_id and b.company_id=p.company_id
    where p.id=new.profile_id and bm.brand_id=new.brand_id and p.status='active'
  ) then raise exception '같은 회사·브랜드의 활성 담당자를 선택하세요.'; end if;
  return new;
end;
$$;
create trigger validate_usage_partner_editor before insert or update on public.usage_partner_editors
for each row execute function app.validate_usage_partner_editor();

create table public.usage_partner_columns (
  brand_id uuid not null,
  usage_target_id uuid not null,
  id uuid not null,
  kind text not null check (kind in ('common','private','operation','legacy')),
  source_key text,
  label text not null check (label=btrim(label) and length(label) between 1 and 40),
  normalized_label text generated always as (lower(regexp_replace(label,'[[:space:]_/().-]','','g'))) stored check (normalized_label<>''),
  description text not null default '' check (length(description)<=500),
  value_type text not null check (value_type in ('text','number','date')),
  visible boolean not null default true,
  sort_order integer not null check (sort_order>=0),
  updated_at timestamptz not null default now(),
  primary key (brand_id,usage_target_id,id),
  constraint usage_partner_column_labels unique (brand_id,usage_target_id,label) deferrable initially deferred,
  constraint usage_partner_column_import_labels unique (brand_id,usage_target_id,normalized_label) deferrable initially deferred,
  foreign key (brand_id,usage_target_id) references public.code_usage_targets(brand_id,id) on delete cascade,
  check (
    (kind='common' and source_key is not null and source_key in ('code','name','productName','styleNo') and value_type='text')
    or (kind='operation' and source_key is not null and source_key='status' and value_type='text')
    or (kind in ('private','legacy') and source_key is null)
  ),
  check (source_key is null or source_key not in ('code','status') or visible),
  check (kind<>'private' or btrim(description)<>'')
);
create unique index usage_partner_column_sources on public.usage_partner_columns(brand_id,usage_target_id,source_key)
where source_key is not null;
alter table public.usage_partner_columns enable row level security;
create policy usage_partner_columns_read on public.usage_partner_columns for select to authenticated
  using (app.usage_partner_can_read(brand_id));
create policy usage_partner_columns_insert on public.usage_partner_columns for insert to authenticated
  with check (app.usage_partner_can_edit(brand_id,usage_target_id));
create policy usage_partner_columns_update on public.usage_partner_columns for update to authenticated
  using (app.usage_partner_can_edit(brand_id,usage_target_id)) with check (app.usage_partner_can_edit(brand_id,usage_target_id));

create or replace function app.validate_usage_partner_column()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.brand_id,new.usage_target_id,new.id,new.kind,new.source_key,new.value_type)
      is distinct from (old.brand_id,old.usage_target_id,old.id,old.kind,old.source_key,old.value_type) then
    raise exception '기존 항목의 연결·의미·입력 형식은 변경할 수 없습니다. 새 항목을 추가하세요.';
  end if;
  new.updated_at=now();
  return new;
end;
$$;
create trigger validate_usage_partner_column before update on public.usage_partner_columns
for each row execute function app.validate_usage_partner_column();

create or replace function app.check_usage_partner_required_columns()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.usage_partner_columns where brand_id=new.brand_id and usage_target_id=new.usage_target_id)>100
    then raise exception '한 업체에는 항목을 100개까지 설정할 수 있습니다.'; end if;
  if not exists(select 1 from public.usage_partner_columns where brand_id=new.brand_id and usage_target_id=new.usage_target_id and source_key='code' and visible)
    or not exists(select 1 from public.usage_partner_columns where brand_id=new.brand_id and usage_target_id=new.usage_target_id and source_key='status' and visible)
  then raise exception '88코드와 상태 항목은 반드시 표시해야 합니다.'; end if;
  return null;
end;
$$;
create constraint trigger usage_partner_required_columns after insert or update on public.usage_partner_columns
deferrable initially deferred for each row execute function app.check_usage_partner_required_columns();

create table public.usage_partner_values (
  brand_id uuid not null,
  usage_target_id uuid not null,
  product_code_id uuid not null,
  field_id uuid not null,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (brand_id,usage_target_id,product_code_id,field_id),
  foreign key (brand_id,usage_target_id,field_id) references public.usage_partner_columns(brand_id,usage_target_id,id),
  foreign key (brand_id,product_code_id,usage_target_id) references public.code_usage_assignments(brand_id,product_code_id,usage_target_id) on delete cascade
);
alter table public.usage_partner_values enable row level security;
create policy usage_partner_values_read on public.usage_partner_values for select to authenticated
  using (app.usage_partner_can_read(brand_id));
create policy usage_partner_values_insert on public.usage_partner_values for insert to authenticated
  with check (app.usage_partner_can_edit(brand_id,usage_target_id));
create policy usage_partner_values_update on public.usage_partner_values for update to authenticated
  using (app.usage_partner_can_edit(brand_id,usage_target_id)) with check (app.usage_partner_can_edit(brand_id,usage_target_id));

create or replace function app.validate_usage_partner_value()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare f public.usage_partner_columns; text_value text;
begin
  if tg_op='UPDATE' and (new.brand_id,new.usage_target_id,new.product_code_id,new.field_id)
      is distinct from (old.brand_id,old.usage_target_id,old.product_code_id,old.field_id) then
    raise exception '업체 전용 값의 연결은 변경할 수 없습니다.';
  end if;
  select * into f from public.usage_partner_columns where brand_id=new.brand_id and usage_target_id=new.usage_target_id and id=new.field_id;
  if not found or f.kind<>'private' then raise exception '공통 값과 미확인 항목은 수정할 수 없습니다.'; end if;
  if length(new.value::text)>16010 then raise exception '입력 값이 너무 깁니다.'; end if;
  text_value=new.value#>>'{}';
  if jsonb_typeof(new.value)='string' and btrim(text_value)='' then new.value='null'::jsonb; end if;
  if new.value<>'null'::jsonb then
    if f.value_type='number' and jsonb_typeof(new.value)<>'number' then raise exception '숫자 값을 입력하세요.';
    elsif f.value_type in ('text','date') and jsonb_typeof(new.value)<>'string' then raise exception '문자 형식의 값을 입력하세요.'; end if;
    if length(text_value)>4000 then raise exception '입력 값은 4000자 이하여야 합니다.'; end if;
    if f.value_type='date' then
      if text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '날짜는 YYYY-MM-DD 형식이어야 합니다.'; end if;
      perform text_value::date;
    end if;
    if f.value_type='number' then perform text_value::double precision; end if;
  end if;
  new.updated_at=now();
  return new;
end;
$$;
create trigger validate_usage_partner_value before insert or update on public.usage_partner_values
for each row execute function app.validate_usage_partner_value();

revoke all on public.usage_partner_editors,public.usage_partner_columns,public.usage_partner_values from public,anon,authenticated;
grant select,insert,update,delete on public.usage_partner_editors to authenticated;
grant select,insert,update on public.usage_partner_columns,public.usage_partner_values to authenticated;

create or replace function public.get_usage_partner_access(p_brand_id uuid,p_target_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if not app.usage_partner_can_read(p_brand_id) or not exists(select 1 from public.code_usage_targets where brand_id=p_brand_id and id=p_target_id) then
    raise exception '업체 정보를 조회할 권한이 없습니다.';
  end if;
  return jsonb_build_object('canRead',true,'canEdit',app.usage_partner_can_edit(p_brand_id,p_target_id),
    'canManage',app.usage_partner_can_manage(p_brand_id),'editorIds',
    coalesce((select jsonb_agg(profile_id order by profile_id) from public.usage_partner_editors where brand_id=p_brand_id and usage_target_id=p_target_id),'[]'::jsonb));
end;
$$;

create or replace function public.get_usage_partner_manager_candidates(p_brand_id uuid)
returns table(id uuid,display_name text) language plpgsql stable security invoker set search_path = '' as $$
begin
  if not app.usage_partner_can_manage(p_brand_id) then raise exception '담당자를 지정할 권한이 없습니다.'; end if;
  return query select p.id,p.display_name from public.profiles p
    join public.brand_members bm on bm.profile_id=p.id and bm.brand_id=p_brand_id
    join public.brands b on b.id=bm.brand_id and b.company_id=p.company_id
    where p.status='active' order by p.display_name,p.id;
end;
$$;

create or replace function public.save_usage_partner_editors(p_brand_id uuid,p_target_id uuid,p_profile_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_brand_id::text||':'||p_target_id::text,0));
  if not app.usage_partner_can_manage(p_brand_id) then raise exception '담당자를 지정할 권한이 없습니다.'; end if;
  if p_profile_ids is null then raise exception '담당자 목록을 확인하세요.'; end if;
  if not exists(select 1 from public.code_usage_targets where brand_id=p_brand_id and id=p_target_id)
    then raise exception '이 브랜드에 등록된 업체를 선택하세요.'; end if;
  if cardinality(p_profile_ids)<>(select count(distinct v) from unnest(p_profile_ids) v) then raise exception '중복된 담당자입니다.'; end if;
  delete from public.usage_partner_editors where brand_id=p_brand_id and usage_target_id=p_target_id and not(profile_id=any(p_profile_ids));
  insert into public.usage_partner_editors(brand_id,usage_target_id,profile_id)
    select p_brand_id,p_target_id,v from unnest(p_profile_ids) v on conflict do nothing;
end;
$$;

create or replace function public.save_usage_partner_columns(p_brand_id uuid,p_target_id uuid,p_columns jsonb)
returns setof public.usage_partner_columns language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_brand_id::text||':'||p_target_id::text,0));
  if not app.usage_partner_can_edit(p_brand_id,p_target_id) then raise exception '이 업체의 담당자만 설정을 수정할 수 있습니다.'; end if;
  if jsonb_typeof(p_columns) is distinct from 'array' or jsonb_array_length(p_columns)>100 then raise exception '헤더 목록을 확인하세요.'; end if;
  if exists(select 1 from jsonb_array_elements(p_columns) c where nullif(c->>'id','') is null) then raise exception '항목 식별자가 필요합니다.'; end if;
  if (select count(*) from jsonb_array_elements(p_columns))<>(select count(distinct c->>'id') from jsonb_array_elements(p_columns) c)
    then raise exception '항목 식별자가 중복되었습니다.'; end if;
  if exists(select 1 from public.usage_partner_columns old where old.brand_id=p_brand_id and old.usage_target_id=p_target_id
    and not exists(select 1 from jsonb_array_elements(p_columns) c where (c->>'id')::uuid=old.id))
    then raise exception '기존 항목은 삭제 대신 숨기기를 사용하세요.'; end if;
  if not exists(select 1 from jsonb_array_elements(p_columns) c where c->>'sourceKey'='code' and coalesce((c->>'visible')::boolean,true))
    or not exists(select 1 from jsonb_array_elements(p_columns) c where c->>'sourceKey'='status' and coalesce((c->>'visible')::boolean,true))
    then raise exception '88코드와 상태 항목은 반드시 표시해야 합니다.'; end if;
  insert into public.usage_partner_columns(brand_id,usage_target_id,id,kind,source_key,label,description,value_type,visible,sort_order)
    select p_brand_id,p_target_id,(c->>'id')::uuid,c->>'kind',nullif(c->>'sourceKey',''),btrim(c->>'label'),
      coalesce(c->>'description',''),c->>'valueType',coalesce((c->>'visible')::boolean,true),(c->>'sortOrder')::integer
    from jsonb_array_elements(p_columns) c
    on conflict (brand_id,usage_target_id,id) do update set kind=excluded.kind,source_key=excluded.source_key,
      label=excluded.label,description=excluded.description,value_type=excluded.value_type,visible=excluded.visible,sort_order=excluded.sort_order;
  return query select * from public.usage_partner_columns where brand_id=p_brand_id and usage_target_id=p_target_id order by sort_order,id;
end;
$$;

create or replace function public.save_usage_partner_values(p_brand_id uuid,p_target_id uuid,p_code_id uuid,p_values jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_brand_id::text||':'||p_target_id::text,0));
  if not app.usage_partner_can_edit(p_brand_id,p_target_id) then raise exception '이 업체의 담당자만 값을 수정할 수 있습니다.'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' or length(p_values::text)>500000 then raise exception '입력 값을 확인하세요.'; end if;
  if not exists(select 1 from public.code_usage_assignments where brand_id=p_brand_id and usage_target_id=p_target_id and product_code_id=p_code_id)
    then raise exception '이 업체에 등록된 코드를 선택하세요.'; end if;
  insert into public.usage_partner_values(brand_id,usage_target_id,product_code_id,field_id,value)
    select p_brand_id,p_target_id,p_code_id,k::uuid,v from jsonb_each(p_values) e(k,v)
    on conflict(brand_id,usage_target_id,product_code_id,field_id) do update set value=excluded.value;
end;
$$;

revoke all on function app.usage_partner_can_read(uuid),app.usage_partner_can_manage(uuid),app.usage_partner_can_edit(uuid,uuid),
  app.validate_usage_partner_editor(),app.validate_usage_partner_column(),app.check_usage_partner_required_columns(),app.validate_usage_partner_value()
  from public,anon;
grant execute on function app.usage_partner_can_read(uuid),app.usage_partner_can_manage(uuid),app.usage_partner_can_edit(uuid,uuid) to authenticated;
revoke all on function public.get_usage_partner_access(uuid,uuid),public.get_usage_partner_manager_candidates(uuid),
  public.save_usage_partner_editors(uuid,uuid,uuid[]),public.save_usage_partner_columns(uuid,uuid,jsonb),public.save_usage_partner_values(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.get_usage_partner_access(uuid,uuid),public.get_usage_partner_manager_candidates(uuid),
  public.save_usage_partner_editors(uuid,uuid,uuid[]),public.save_usage_partner_columns(uuid,uuid,jsonb),public.save_usage_partner_values(uuid,uuid,uuid,jsonb) to authenticated;
