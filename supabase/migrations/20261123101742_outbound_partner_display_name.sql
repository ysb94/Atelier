alter table public.code_usage_targets
  add column display_name text
  constraint code_usage_targets_display_name_check
  check (display_name is null or char_length(btrim(display_name)) between 1 and 120);

comment on column public.code_usage_targets.display_name is
  '출고 단위의 화면 표시명. NULL이면 기존 이름을 사용하며 자동 매칭에는 쓰지 않는다.';

create function public.save_outbound_partner_unit_with_display_name(
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
  p_group_name text,
  p_site_name text,
  p_normalized_site_name text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text,
  p_address text,
  p_aliases jsonb,
  p_display_name text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_display_name text := nullif(btrim(regexp_replace(coalesce(p_display_name, ''), '[[:space:]]+', ' ', 'g')), '');
begin
  if char_length(v_display_name) > 120 then
    raise exception '표시명은 120자 이내로 입력하세요.';
  end if;

  v_id := public.save_outbound_partner_unit_atomic(
    p_brand_id, p_id, p_name, p_normalized_name, p_channel_type,
    p_shipping_method, p_is_one_time, p_active, p_note, p_folder_id,
    p_group_id, p_group_name, p_site_name, p_normalized_site_name,
    p_contact_name, p_contact_phone, p_contact_email, p_address, p_aliases
  );

  update public.code_usage_targets
     set display_name = v_display_name
   where id = v_id and brand_id = p_brand_id;
  if not found then
    raise exception '출고업체 표시명을 저장하지 못했습니다.';
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_outbound_partner_unit_with_display_name(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid, uuid,
  text, text, text, text, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.save_outbound_partner_unit_with_display_name(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid, uuid,
  text, text, text, text, text, text, text, jsonb, text
) to authenticated;
