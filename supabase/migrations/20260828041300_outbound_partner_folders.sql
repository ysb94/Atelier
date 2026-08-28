-- 출고업체 분류를 고정 칸이 아니라 브랜드가 만드는 폴더 경로로 둔다.
-- 카드(업체)는 폴더 안에 들어가고, 폴더를 옮기면 분류가 바뀐다.
-- 기존 channel_type / shipping_method 열은 지우지 않는다. 화면만 폴더를 쓴다.

create table if not exists public.code_usage_target_folders (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  parent_id uuid,
  name text not null
    check (length(btrim(name)) > 0),
  normalized_name text not null
    check (length(normalized_name) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint code_usage_target_folders_brand_id_id_key unique (brand_id, id),
  constraint code_usage_target_folders_parent_fkey
    foreign key (brand_id, parent_id)
    references public.code_usage_target_folders (brand_id, id)
    on delete restrict
);

comment on table public.code_usage_target_folders is
  '출고업체 분류 폴더. 일 종류가 위, 업체 카드가 아래다. 회사 이름으로 묶지 않는다.';

create unique index if not exists code_usage_target_folders_root_name_key
  on public.code_usage_target_folders (brand_id, normalized_name)
  where parent_id is null;

create unique index if not exists code_usage_target_folders_sibling_name_key
  on public.code_usage_target_folders (brand_id, parent_id, normalized_name)
  where parent_id is not null;

create index if not exists code_usage_target_folders_parent_idx
  on public.code_usage_target_folders (brand_id, parent_id);

drop trigger if exists code_usage_target_folders_set_updated_at
  on public.code_usage_target_folders;
create trigger code_usage_target_folders_set_updated_at
before update on public.code_usage_target_folders
for each row execute function public.set_updated_at();

alter table public.code_usage_target_folders enable row level security;

drop policy if exists code_usage_target_folders_all_member
  on public.code_usage_target_folders;
create policy code_usage_target_folders_all_member
on public.code_usage_target_folders
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.code_usage_target_folders
to authenticated;

alter table public.code_usage_targets
  add column if not exists folder_id uuid;

alter table public.code_usage_targets
  drop constraint if exists code_usage_targets_folder_fkey;
alter table public.code_usage_targets
  add constraint code_usage_targets_folder_fkey
  foreign key (brand_id, folder_id)
  references public.code_usage_target_folders (brand_id, id)
  on delete set null;

comment on column public.code_usage_targets.folder_id is
  '분류 폴더. 비면 미분류다. 폴더를 지우면 카드만 미분류로 돌아온다.';

-- 저장 RPC에 폴더를 넣는다. 인자가 늘므로 이전 시그니처는 제거한다.
drop function if exists public.save_outbound_partner_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, jsonb
);

create or replace function public.save_outbound_partner_with_aliases(
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
  p_aliases jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_next_order integer;
  v_alias jsonb;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception '업체 이름을 입력하세요.';
  end if;

  if length(coalesce(p_normalized_name, '')) = 0 then
    raise exception '업체 이름에 글자나 숫자가 있어야 합니다.';
  end if;

  if p_folder_id is not null then
    if not exists (
      select 1
        from public.code_usage_target_folders
       where id = p_folder_id
         and brand_id = p_brand_id
    ) then
      raise exception '분류 폴더를 찾을 수 없습니다.';
    end if;
  end if;

  if p_id is null then
    select coalesce(max(sort_order) + 1, 0)
      into v_next_order
      from public.code_usage_targets
     where brand_id = p_brand_id;

    insert into public.code_usage_targets (
      brand_id,
      name,
      normalized_name,
      channel_type,
      shipping_method,
      is_one_time,
      active,
      note,
      folder_id,
      sort_order
    )
    values (
      p_brand_id,
      p_name,
      p_normalized_name,
      coalesce(p_channel_type, 'unset'),
      coalesce(p_shipping_method, 'unset'),
      coalesce(p_is_one_time, false),
      coalesce(p_active, true),
      coalesce(p_note, ''),
      p_folder_id,
      v_next_order
    )
    returning id into v_id;
  else
    update public.code_usage_targets
       set name = p_name,
           normalized_name = p_normalized_name,
           channel_type = coalesce(p_channel_type, channel_type),
           shipping_method = coalesce(p_shipping_method, shipping_method),
           is_one_time = coalesce(p_is_one_time, is_one_time),
           active = coalesce(p_active, active),
           note = coalesce(p_note, note),
           folder_id = p_folder_id
     where id = p_id
       and brand_id = p_brand_id
    returning id into v_id;

    if v_id is null then
      raise exception '업체를 찾을 수 없습니다.';
    end if;
  end if;

  delete from public.code_usage_target_aliases
   where brand_id = p_brand_id
     and target_id = v_id;

  if p_aliases is not null and jsonb_typeof(p_aliases) = 'array' then
    for v_alias in select * from jsonb_array_elements(p_aliases)
    loop
      if length(btrim(coalesce(v_alias ->> 'alias', ''))) = 0 then
        continue;
      end if;
      if length(coalesce(v_alias ->> 'normalized_alias', '')) = 0 then
        continue;
      end if;

      insert into public.code_usage_target_aliases (
        brand_id,
        target_id,
        alias,
        normalized_alias,
        note
      )
      values (
        p_brand_id,
        v_id,
        v_alias ->> 'alias',
        v_alias ->> 'normalized_alias',
        coalesce(v_alias ->> 'note', '')
      );
    end loop;
  end if;

  return v_id;
end;
$$;

comment on function public.save_outbound_partner_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid, jsonb
) is
  '출고업체·별칭·분류 폴더를 원자 저장한다. 별칭은 전달한 배열로 통째 교체한다.';

revoke all on function public.save_outbound_partner_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid, jsonb
) from public;

grant execute on function public.save_outbound_partner_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid, jsonb
) to authenticated;
