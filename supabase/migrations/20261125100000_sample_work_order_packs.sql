begin;

create table app.sample_work_order_packs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  slot text not null check (length(slot) between 1 and 160),
  revision uuid not null default gen_random_uuid(),
  files jsonb not null default '[]',
  notes text not null default '',
  order_id text,
  kind text check (kind in ('sample','color')),
  published_at timestamptz
);
create unique index sample_work_order_packs_open on app.sample_work_order_packs(draft_id,slot) where published_at is null;
create index sample_work_order_packs_draft on app.sample_work_order_packs(draft_id);
create index sample_work_order_packs_files on app.sample_work_order_packs using gin(files jsonb_path_ops);
alter table app.sample_work_order_packs enable row level security;
revoke all on app.sample_work_order_packs from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values ('sample-work-orders','sample-work-orders',false,31457280);

create function app.sample_pack_id(p_ref text) returns uuid
language sql immutable set search_path='' as $$
  select case when p_ref ~ '^atelier-sample-pack:[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}(:[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})?$'
    then split_part(p_ref,':',2)::uuid end
$$;

create function app.sample_pack_china_destination(p_order text,p_draft text) returns boolean
language sql immutable set search_path='' as $$
  select target ~* '중국|china' and target !~* '외부|external|promotion'
  from (select coalesce(nullif(btrim(p_order),''),nullif(btrim(p_draft),''),'중국') as target) x
$$;

create function app.sample_pack_can_read(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from app.sample_work_order_packs p join public.product_drafts d on d.id=p.draft_id
    where p.id=p_id and d.company_id=app.permission_company_id() and (
      app.draft_write_allowed(d.id)
      or (p.published_at is not null and (
        app.basic_work_allowed('planning',d.brand_id)
        or (app.china_work_screen_role()='manager' and exists(
          select 1 from jsonb_array_elements(case when p.kind='color' then coalesce(d.specs->'colorSampleRounds','[]')
            else coalesce(d.sample_work_orders,'[]') end) j
          where j->>'id'=p.order_id and app.sample_pack_id(j->>'url')=p.id
            and app.sample_pack_china_destination(j->>'originCountry',d.origin_country)
        ))
        or (app.china_work_screen_role()='worker' and exists(
          select 1 from app.china_assigned_rounds(d) r where r.kind=p.kind and r.item->>'id'=p.order_id and app.sample_pack_id(r.item->>'url')=p.id
            and app.sample_pack_china_destination(r.item->>'originCountry',d.origin_country)
        ))
      ))
    )
  )
$$;

create function app.sample_pack_can_upload(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select p_name ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    and exists(select 1 from app.sample_work_order_packs p
      where p.id=app.sample_pack_id('atelier-sample-pack:'||split_part(p_name,'/',1))
      and p.published_at is null and app.draft_write_allowed(p.draft_id))
$$;

create function app.sample_pack_storage_read(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select app.sample_pack_can_upload(p_name) or exists(select 1 from app.sample_work_order_packs p
    where p.files @> jsonb_build_array(jsonb_build_object('path',p_name)) and app.sample_pack_can_read(p.id))
$$;

create policy sample_pack_upload on storage.objects for insert to authenticated
  with check (bucket_id='sample-work-orders' and app.sample_pack_can_upload(name));
create policy sample_pack_download on storage.objects for select to authenticated
  using (bucket_id='sample-work-orders' and app.sample_pack_storage_read(name));

create function app.sample_pack_json(p app.sample_work_order_packs) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('id',p.id,'revision',p.revision,'files',p.files,'notes',p.notes,'published',p.published_at is not null)
$$;

create function app.get_sample_work_order_pack(p_id uuid,p_draft uuid,p_slot text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if p_id is not null then
    if not app.sample_pack_can_read(p_id) then raise exception '작업지시서 묶음을 볼 수 없습니다.' using errcode='42501'; end if;
    return (select app.sample_pack_json(p) from app.sample_work_order_packs p where p.id=p_id);
  end if;
  if p_draft is null then return null; end if;
  if not app.draft_write_allowed(p_draft) then raise exception '작성 권한을 확인해 주세요.' using errcode='42501'; end if;
  return (select app.sample_pack_json(p) from app.sample_work_order_packs p where p.draft_id=p_draft and p.slot=p_slot and p.published_at is null);
end
$$;

create function app.open_sample_work_order_pack(p_draft uuid,p_slot text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p app.sample_work_order_packs;
begin
  if not app.draft_write_allowed(p_draft) then raise exception '작성 권한을 확인해 주세요.' using errcode='42501'; end if;
  if p_slot !~ '^(first|next|final|color|edit:[a-zA-Z0-9_-]{1,100})$' then raise exception '작업지시서 회차를 확인해 주세요.'; end if;
  insert into app.sample_work_order_packs(draft_id,slot) values(p_draft,p_slot)
    on conflict(draft_id,slot) where published_at is null do nothing;
  select * into p from app.sample_work_order_packs where draft_id=p_draft and slot=p_slot and published_at is null;
  return app.sample_pack_json(p);
end
$$;

create function app.sample_pack_validate(p app.sample_work_order_packs,p_files jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare f jsonb; size_total bigint := 0; f_size bigint;
begin
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files)>10 then return false; end if;
  if (select count(distinct x->>'path') from jsonb_array_elements(p_files) x)<>jsonb_array_length(p_files) then return false; end if;
  for f in select value from jsonb_array_elements(p_files) loop
    if coalesce(f->>'name','') !~* '^.{1,200}\.(pdf|png|jpe?g|webp|xlsx?|docx?)$' then return false; end if;
    if coalesce(f->>'size','') !~ '^[1-9][0-9]{0,7}$' or coalesce(f->>'sha256','') !~ '^[a-f0-9]{64}$' then return false; end if;
    f_size:=(f->>'size')::bigint;
    size_total:=size_total+f_size;
    if f_size>31457280 or size_total>104857600 then return false; end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='sample-work-orders'
        and o.name=f->>'path' and o.metadata->>'size'=f_size::text) then return false; end if;
    if split_part(f->>'path','/',1) is distinct from p.id::text and not exists(
        select 1 from app.sample_work_order_packs source where source.draft_id=p.draft_id
          and source.published_at is not null and source.files @> jsonb_build_array(f)
      ) then return false; end if;
  end loop;
  return true;
end
$$;

create function app.save_sample_work_order_pack(p_id uuid,p_revision uuid,p_files jsonb,p_notes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p app.sample_work_order_packs;
begin
  select * into p from app.sample_work_order_packs where id=p_id for update;
  if not found or not app.draft_write_allowed(p.draft_id) then raise exception '작성 권한을 확인해 주세요.' using errcode='42501'; end if;
  if p.published_at is not null or p_revision is distinct from p.revision then
    raise exception '작업지시서가 다른 곳에서 변경되었습니다. 다시 조회해 주세요.' using errcode='40001';
  end if;
  if length(coalesce(p_notes,''))>1000 or not app.sample_pack_validate(p,p_files) then
    raise exception '첨부 파일, 용량 또는 주의사항을 확인해 주세요.' using errcode='22023';
  end if;
  update app.sample_work_order_packs set files=p_files,notes=coalesce(p_notes,''),revision=gen_random_uuid()
  where id=p_id returning * into p;
  return app.sample_pack_json(p);
end
$$;

-- Publish the revision in the same transaction that saves the existing sample/color round.
create function app.publish_sample_work_order_packs() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; items jsonb; previous jsonb; item jsonb; prior jsonb; result jsonb;
  pack_id uuid; p app.sample_work_order_packs;
begin
  foreach k in array array['sample','color'] loop
    items:=case when k='sample' then new.sample_work_orders else new.specs->'colorSampleRounds' end;
    previous:=case when k='sample' then old.sample_work_orders else old.specs->'colorSampleRounds' end;
    if items is not distinct from previous or jsonb_typeof(items) is distinct from 'array' then continue; end if;
    result:='[]';
    for item in select value from jsonb_array_elements(items) loop
      select value into prior from jsonb_array_elements(coalesce(previous,'[]')) where value->>'id'=item->>'id' limit 1;
      pack_id:=app.sample_pack_id(item->>'url');
      if item->>'url' is distinct from prior->>'url' and (pack_id is not null or app.sample_pack_id(prior->>'url') is not null) then
        if not app.draft_write_allowed(new.id) or pack_id is null or nullif(item->>'id','') is null
          or coalesce(prior->>'shipped'='true',false) or coalesce(prior->>'passed'='true',false)
          or nullif(prior->>'returnedAt','') is not null or nullif(prior->>'receivedAt','') is not null then
          raise exception '발송 전 작업지시서만 수정본으로 등록할 수 있습니다.' using errcode='42501';
        end if;
        select * into p from app.sample_work_order_packs where id=pack_id and draft_id=new.id for update;
        if not found or p.published_at is not null or p.revision::text is distinct from split_part(item->>'url',':',3)
          or jsonb_array_length(p.files)=0 or not app.sample_pack_validate(p,p.files) then
          raise exception '전체 첨부가 저장된 작업지시서 묶음을 확인해 주세요.' using errcode='22023';
        end if;
        update app.sample_work_order_packs set published_at=clock_timestamp(),kind=k,order_id=item->>'id' where id=pack_id;
        item:=item||jsonb_build_object('fileCheckedAt',null,'assigneeCheckedAt',null);
      elsif pack_id is not null and current_setting('app.china_workorder',true) is distinct from 'on' then
        item:=item||jsonb_build_object('fileCheckedAt',prior->'fileCheckedAt','assigneeCheckedAt',prior->'assigneeCheckedAt');
      end if;
      result:=result||jsonb_build_array(item);
    end loop;
    if k='sample' then new.sample_work_orders:=result;
    else new.specs:=jsonb_set(new.specs,'{colorSampleRounds}',result); end if;
  end loop;
  return new;
end
$$;
create trigger zz_publish_sample_work_order_packs before update of sample_work_orders,specs on public.product_drafts
for each row execute function app.publish_sample_work_order_packs();

-- Preserve the existing role/assignment checks. Route bundled receipts through the exact revision RPC.
do $patch$
declare body text:=pg_get_functiondef('app.china_work_order(uuid,text,text,text,uuid,timestamptz)'::regprocedure);
  anchor constant text:='if d.updated_at is distinct from p_revision then';
begin
  if strpos(body,anchor)=0 then raise exception 'China work order revision guard changed'; end if;
  execute replace(body,anchor,$guard$
  if p_action='check' and exists(
    select 1 from app.sample_work_order_packs p
    where p.draft_id=p_draft and p.kind=p_kind and p.order_id=p_order and p.published_at is not null
      and app.sample_pack_id((select j->>'url' from jsonb_array_elements(case when p_kind='color'
        then coalesce(d.specs->'colorSampleRounds','[]') else coalesce(d.sample_work_orders,'[]') end) j where j->>'id'=p_order limit 1))=p.id
      and current_setting('app.sample_pack_receipt',true) is distinct from p.id::text
  ) then raise exception '최신 작업지시서 묶음에서 전체 받기를 먼저 해 주세요.' using errcode='55000'; end if;
  if p_action='ship' and exists(
    select 1 from jsonb_array_elements(case when p_kind='color'
      then coalesce(d.specs->'colorSampleRounds','[]') else coalesce(d.sample_work_orders,'[]') end) j
    where j->>'id'=p_order and app.sample_pack_id(j->>'url') is not null and nullif(j->>'fileCheckedAt','') is null
  ) then raise exception '총괄이 최신 작업지시서 묶음을 받은 뒤 발송할 수 있습니다.' using errcode='55000'; end if;
  if p_action='handoff' and exists(
    select 1 from (select value j from jsonb_array_elements(coalesce(d.sample_work_orders,'[]'))
      union all select value from jsonb_array_elements(coalesce(d.specs->'colorSampleRounds','[]'))) x
    where app.sample_pack_id(j->>'url') is not null and nullif(j->>'fileCheckedAt','') is null
      and j->>'shipped' is distinct from 'true' and j->>'passed' is distinct from 'true'
      and nullif(j->>'returnedAt','') is null and nullif(j->>'receivedAt','') is null
      and app.sample_pack_china_destination(j->>'originCountry',d.origin_country)
  ) then raise exception '진행 중인 작업지시서 묶음에서 전체 받기를 먼저 해 주세요.' using errcode='55000'; end if;
  $guard$||anchor);
end
$patch$;

do $read$
declare body text:=pg_get_functiondef('app.get_my_china_work_orders()'::regprocedure);
  anchor constant text:=$field$'fileName',r.item->>'name',$field$;
begin
  if strpos(body,anchor)=0 then raise exception 'China work order list definition changed'; end if;
  execute replace(body,anchor,anchor||$field$'packId',app.sample_pack_id(r.item->>'url'),'managerChecked',nullif(r.item->>'fileCheckedAt','') is not null,$field$);
end
$read$;

create function app.receive_sample_work_order_pack(p_id uuid,p_revision timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare p app.sample_work_order_packs; d public.product_drafts; item jsonb;
begin
  select * into p from app.sample_work_order_packs where id=p_id and published_at is not null;
  if not found then raise exception '등록된 작업지시서가 없습니다.' using errcode='42501'; end if;
  select * into d from public.product_drafts where id=p.draft_id and company_id=app.permission_company_id() for update;
  select j into item from jsonb_array_elements(case when p.kind='color' then coalesce(d.specs->'colorSampleRounds','[]')
    else coalesce(d.sample_work_orders,'[]') end) j where j->>'id'=p.order_id;
  if not app.sample_pack_can_read(p_id) or app.sample_pack_id(item->>'url') is distinct from p_id
    or coalesce(app.china_work_screen_role(),'denied') not in ('manager','worker')
    or not app.sample_pack_china_destination(item->>'originCountry',d.origin_country)
    or coalesce(item->>'shipped'='true',false) or coalesce(item->>'passed'='true',false)
    or nullif(item->>'returnedAt','') is not null or nullif(item->>'receivedAt','') is not null
    or not app.sample_pack_validate(p,p.files) then
    raise exception '최신 작업지시서와 배정을 다시 확인해 주세요.' using errcode='42501';
  end if;
  perform set_config('app.sample_pack_receipt',p_id::text,true);
  perform app.china_work_order(p.draft_id,p.order_id,p.kind,'check',null,p_revision);
  perform set_config('app.sample_pack_receipt','',true);
end
$$;

create function public.get_sample_work_order_pack(p_id uuid,p_draft uuid,p_slot text) returns jsonb
language sql stable set search_path='' as $$ select app.get_sample_work_order_pack(p_id,p_draft,p_slot) $$;
create function public.open_sample_work_order_pack(p_draft uuid,p_slot text) returns jsonb
language sql set search_path='' as $$ select app.open_sample_work_order_pack(p_draft,p_slot) $$;
create function public.save_sample_work_order_pack(p_id uuid,p_revision uuid,p_files jsonb,p_notes text) returns jsonb
language sql set search_path='' as $$ select app.save_sample_work_order_pack(p_id,p_revision,p_files,p_notes) $$;
create function public.receive_sample_work_order_pack(p_id uuid,p_revision timestamptz) returns void
language sql set search_path='' as $$ select app.receive_sample_work_order_pack(p_id,p_revision) $$;

revoke all on function app.sample_pack_id(text),app.sample_pack_china_destination(text,text),app.sample_pack_can_read(uuid),app.sample_pack_can_upload(text),
  app.sample_pack_storage_read(text),app.sample_pack_json(app.sample_work_order_packs),
  app.sample_pack_validate(app.sample_work_order_packs,jsonb),app.publish_sample_work_order_packs()
from public,anon,authenticated;
grant execute on function app.sample_pack_can_upload(text),app.sample_pack_storage_read(text) to authenticated;

revoke all on function app.get_sample_work_order_pack(uuid,uuid,text),app.open_sample_work_order_pack(uuid,text),
  app.save_sample_work_order_pack(uuid,uuid,jsonb,text),app.receive_sample_work_order_pack(uuid,timestamptz),
  public.get_sample_work_order_pack(uuid,uuid,text),public.open_sample_work_order_pack(uuid,text),
  public.save_sample_work_order_pack(uuid,uuid,jsonb,text),public.receive_sample_work_order_pack(uuid,timestamptz)
from public,anon,authenticated;
grant execute on function app.get_sample_work_order_pack(uuid,uuid,text),app.open_sample_work_order_pack(uuid,text),
  app.save_sample_work_order_pack(uuid,uuid,jsonb,text),app.receive_sample_work_order_pack(uuid,timestamptz),
  public.get_sample_work_order_pack(uuid,uuid,text),public.open_sample_work_order_pack(uuid,text),
  public.save_sample_work_order_pack(uuid,uuid,jsonb,text),public.receive_sample_work_order_pack(uuid,timestamptz) to authenticated;

notify pgrst,'reload schema';
commit;
