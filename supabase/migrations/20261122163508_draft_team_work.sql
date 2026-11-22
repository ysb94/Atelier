create table public.draft_team_work (
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  section text not null check (section in ('amd', 'md-quantity', 'md-price', 'md-options')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 131072),
  confirmed boolean not null,
  revision uuid not null default gen_random_uuid(),
  primary key (draft_id, section)
);

alter table public.draft_team_work enable row level security;
revoke all on public.draft_team_work from public, anon, authenticated;
grant select on public.draft_team_work to authenticated;
create policy draft_team_work_read on public.draft_team_work for select to authenticated
  using (exists (select 1 from public.product_drafts d where d.id = draft_team_work.draft_id));

create function app.save_draft_team_work(
  p_draft_id uuid, p_section text, p_payload jsonb, p_confirmed boolean, p_revision uuid
) returns setof public.draft_team_work
language plpgsql security definer set search_path = '' as $$
declare
  fields text[];
  color_data jsonb;
  option_type jsonb;
  current_revision uuid;
begin
  if auth.uid() is null or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;
  fields := case p_section
    when 'amd' then array['collection','colors']
    when 'md-quantity' then array['quantities','arrival']
    when 'md-price' then array['retail','discount','extraDiscount','auto']
    when 'md-options' then array['type','entries']
  end;
  if fields is null or jsonb_typeof(p_payload) is distinct from 'object' or p_confirmed is null then
    raise exception '저장할 팀 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  if not (p_payload ?& fields) or (p_payload - fields) <> '{}'::jsonb or octet_length(p_payload::text) > 131072 then
    raise exception '저장할 항목의 형식이나 용량을 확인해 주세요.' using errcode = '22023';
  end if;

  if p_section = 'amd' then
    color_data := p_payload->'colors';
    if jsonb_typeof(p_payload->'collection') <> 'string' or length(p_payload->>'collection') > 80
      or jsonb_typeof(color_data) <> 'object' then
      raise exception 'AMD 번호를 확인해 주세요.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(color_data) c where case when jsonb_typeof(c.value) = 'object' then
      not (c.value ?& array['sabangnet','barcode']) or (c.value - array['sabangnet','barcode']) <> '{}'::jsonb
      or jsonb_typeof(c.value->'sabangnet') <> 'string' or length(c.value->>'sabangnet') > 80
      or jsonb_typeof(c.value->'barcode') <> 'string' or length(c.value->>'barcode') > 80 else true end) then
      raise exception '컬러별 AMD 번호를 확인해 주세요.' using errcode = '22023';
    end if;
  elsif p_section = 'md-quantity' then
    color_data := p_payload->'quantities';
    if jsonb_typeof(color_data) <> 'object' or jsonb_typeof(p_payload->'arrival') <> 'string'
      or (p_payload->>'arrival') !~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' then
      raise exception '수량과 입고 예정일을 확인해 주세요.' using errcode = '22023';
    end if;
    perform nullif(p_payload->>'arrival', '')::date;
    if exists (select 1 from jsonb_each(color_data) c where jsonb_typeof(c.value) <> 'string'
      or (c.value #>> '{}') !~ '^[0-9]{0,15}$') then
      raise exception '컬러별 수량을 확인해 주세요.' using errcode = '22023';
    end if;
  elsif p_section = 'md-price' then
    if jsonb_typeof(p_payload->'auto') <> 'boolean' or exists (
      select 1 from jsonb_each(p_payload - 'auto') price
      where jsonb_typeof(price.value) <> 'string' or length(price.value #>> '{}') > 24
      or (price.value #>> '{}') !~ '^(-?([0-9]+([.][0-9]*)?|[.][0-9]+))?$'
    ) then
      raise exception 'MD 가격을 확인해 주세요.' using errcode = '22023';
    end if;
  else
    option_type := p_payload->'type';
    if jsonb_typeof(p_payload->'entries') <> 'array' or jsonb_typeof(option_type) not in ('object','null') then
      raise exception 'MD 옵션 유형을 확인해 주세요.' using errcode = '22023';
    end if;
    if jsonb_typeof(option_type) = 'object' then
      if not (option_type ?& array['id','label']) or (option_type - array['id','label']) <> '{}'::jsonb
        or jsonb_typeof(option_type->'id') <> 'string' or length(option_type->>'id') not between 1 and 80
        or jsonb_typeof(option_type->'label') <> 'string' or length(option_type->>'label') not between 1 and 120 then
        raise exception 'MD 옵션 유형을 확인해 주세요.' using errcode = '22023';
      end if;
    end if;
    if jsonb_array_length(p_payload->'entries') > 200 or exists (
      select 1 from jsonb_array_elements(p_payload->'entries') item where case when jsonb_typeof(item) = 'object' then
        not (item ?& array['id','name','price']) or (item - array['id','name','price']) <> '{}'::jsonb
        or jsonb_typeof(item->'id') <> 'string' or length(item->>'id') not between 1 and 80
        or jsonb_typeof(item->'name') <> 'string' or length(item->>'name') > 240
        or jsonb_typeof(item->'price') <> 'string' or (item->>'price') !~ '^[0-9]{0,15}$'
      else true end
    ) or exists (select 1 from jsonb_array_elements(p_payload->'entries') item
      group by item->>'id' having count(*) > 1) then
      raise exception 'MD 옵션명과 추가금을 확인해 주세요.' using errcode = '22023';
    end if;
  end if;

  -- Share the parent lock with draft/color saves. Check the exact color set under that lock.
  perform 1 from public.product_drafts where id = p_draft_id for no key update;
  if not found or not app.draft_write_allowed(p_draft_id) then
    raise exception '기획안을 편집할 권한이 없습니다.' using errcode = '42501';
  end if;
  if color_data is not null and (
    exists (select 1 from public.draft_colors c where c.draft_id = p_draft_id and not (color_data ? c.id::text))
    or exists (select 1 from jsonb_object_keys(color_data) key
      where not exists (select 1 from public.draft_colors c where c.draft_id = p_draft_id and c.id::text = key))
  ) then
    raise exception '컬러 구성이 변경됐습니다.' using errcode = '22023';
  end if;

  select revision into current_revision from public.draft_team_work where draft_id = p_draft_id and section = p_section;
  if current_revision is distinct from p_revision then
    raise exception '다른 화면에서 먼저 저장했습니다.' using errcode = '40001';
  end if;
  return query insert into public.draft_team_work(draft_id, section, payload, confirmed)
    values (p_draft_id, p_section, p_payload, p_confirmed)
    on conflict (draft_id, section) do update
      set payload = excluded.payload, confirmed = excluded.confirmed, revision = gen_random_uuid()
    returning draft_team_work.*;
end
$$;

create function public.save_draft_team_work(
  p_draft_id uuid, p_section text, p_payload jsonb, p_confirmed boolean, p_revision uuid
) returns setof public.draft_team_work
language sql security invoker set search_path = '' as $$
  select * from app.save_draft_team_work(p_draft_id, p_section, p_payload, p_confirmed, p_revision)
$$;

revoke all on function app.save_draft_team_work(uuid,text,jsonb,boolean,uuid),
  public.save_draft_team_work(uuid,text,jsonb,boolean,uuid) from public, anon, authenticated;
grant execute on function app.save_draft_team_work(uuid,text,jsonb,boolean,uuid),
  public.save_draft_team_work(uuid,text,jsonb,boolean,uuid) to authenticated;
