-- 출고업체의 분류 폴더와 별개로 업체 그룹·지점·온라인/오프라인 정체성을 둔다.
-- 기존 code_usage_targets.id와 이름·별칭·바코드·출고 이력은 그대로 유지한다.

create table if not exists public.outbound_partner_groups (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  normalized_name text not null check (length(normalized_name) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_partner_groups_brand_id_id_key unique (brand_id, id)
);

comment on table public.outbound_partner_groups is
  '여러 지점·채널을 묶는 출고업체 그룹. 실제 출고 단위는 code_usage_targets다.';

create unique index if not exists outbound_partner_groups_brand_name_key
  on public.outbound_partner_groups (brand_id, normalized_name);

drop trigger if exists outbound_partner_groups_set_updated_at
  on public.outbound_partner_groups;
create trigger outbound_partner_groups_set_updated_at
before update on public.outbound_partner_groups
for each row execute function public.set_updated_at();

alter table public.outbound_partner_groups enable row level security;

drop policy if exists outbound_partner_groups_all_member
  on public.outbound_partner_groups;
create policy outbound_partner_groups_all_member
on public.outbound_partner_groups
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.outbound_partner_groups
to authenticated;

alter table public.code_usage_targets
  add column if not exists group_id uuid,
  add column if not exists site_name text not null default '',
  add column if not exists normalized_site_name text not null default '';

alter table public.code_usage_targets
  drop constraint if exists code_usage_targets_group_fkey;
alter table public.code_usage_targets
  add constraint code_usage_targets_group_fkey
  foreign key (brand_id, group_id)
  references public.outbound_partner_groups (brand_id, id)
  on delete restrict;

comment on column public.code_usage_targets.group_id is
  '같은 업체의 지점·온라인/오프라인 출고 단위를 묶는 그룹.';
comment on column public.code_usage_targets.site_name is
  '업체 그룹 안의 지점 또는 업무 단위. 없으면 빈 문자열.';
comment on column public.code_usage_targets.normalized_site_name is
  '지점명 비교용 압축 키. 앱 compactOutboundPartnerKey가 넣는다.';

create unique index if not exists code_usage_targets_brand_identity_key
  on public.code_usage_targets (
    brand_id,
    group_id,
    normalized_site_name,
    channel_type
  )
  where group_id is not null;

create index if not exists code_usage_targets_group_idx
  on public.code_usage_targets (brand_id, group_id);

-- 기존 저장 RPC는 배포 중인 이전 앱을 위해 유지한다. 새 앱은 이 확장 RPC를 쓴다.
create or replace function public.save_outbound_partner_identity_with_aliases(
  p_brand_id uuid,
  p_id uuid,
  p_name text,
  p_normalized_name text,
  p_channel_type text,
  p_shipping_method text,
  p_is_one_time boolean,
  p_active boolean,
  p_note text,
  p_folder_id uuid,
  p_group_id uuid,
  p_site_name text,
  p_normalized_site_name text,
  p_aliases jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_site_name text := btrim(coalesce(p_site_name, ''));
  v_normalized_site_name text := coalesce(p_normalized_site_name, '');
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  if p_group_id is not null and not exists (
    select 1
      from public.outbound_partner_groups
     where id = p_group_id
       and brand_id = p_brand_id
  ) then
    raise exception '업체 그룹을 찾을 수 없습니다.';
  end if;

  if length(v_site_name) > 0 and length(v_normalized_site_name) = 0 then
    raise exception '지점 이름에 글자나 숫자가 있어야 합니다.';
  end if;

  v_id := public.save_outbound_partner_with_aliases(
    p_brand_id,
    p_id,
    p_name,
    p_normalized_name,
    p_channel_type,
    p_shipping_method,
    p_is_one_time,
    p_active,
    p_note,
    p_folder_id,
    p_aliases
  );

  update public.code_usage_targets
     set group_id = p_group_id,
         site_name = v_site_name,
         normalized_site_name = v_normalized_site_name
   where id = v_id
     and brand_id = p_brand_id;

  return v_id;
end;
$$;

comment on function public.save_outbound_partner_identity_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid,
  uuid, text, text, jsonb
) is
  '출고업체·별칭·분류 폴더·업체 그룹·지점·채널을 기존 id를 유지하며 원자 저장한다.';

revoke all on function public.save_outbound_partner_identity_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid,
  uuid, text, text, jsonb
) from public;

grant execute on function public.save_outbound_partner_identity_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid,
  uuid, text, text, jsonb
) to authenticated;
