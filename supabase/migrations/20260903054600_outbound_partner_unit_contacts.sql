-- 실제 출고 단위(code_usage_targets)에 거래처 업무 연락처를 둔다.
-- 고객 수령인 정보가 아니며, 기존 id·별칭·바코드·출고 이력은 그대로 유지한다.

alter table public.code_usage_targets
  add column if not exists contact_name text not null default '',
  add column if not exists contact_phone text not null default '',
  add column if not exists contact_email text not null default '',
  add column if not exists address text not null default '';

comment on column public.code_usage_targets.contact_name is
  '거래처 업무 담당자. 송장 고객 수령인 이름이 아니다.';
comment on column public.code_usage_targets.contact_phone is
  '거래처 업무 전화. 송장 고객 전화번호가 아니다.';
comment on column public.code_usage_targets.contact_email is
  '거래처 업무 이메일.';
comment on column public.code_usage_targets.address is
  '거래처 출고·납품 주소. 송장 고객 주소가 아니다.';

-- 기존 identity RPC는 배포 중인 이전 앱을 위해 유지한다. 새 앱은 이 확장 RPC를 쓴다.
create or replace function public.save_outbound_partner_unit_with_aliases(
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
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text,
  p_address text,
  p_aliases jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_contact_name text := btrim(coalesce(p_contact_name, ''));
  v_contact_phone text := btrim(coalesce(p_contact_phone, ''));
  v_contact_email text := btrim(coalesce(p_contact_email, ''));
  v_address text := btrim(coalesce(p_address, ''));
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  v_id := public.save_outbound_partner_identity_with_aliases(
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
    p_group_id,
    p_site_name,
    p_normalized_site_name,
    p_aliases
  );

  update public.code_usage_targets
     set contact_name = v_contact_name,
         contact_phone = v_contact_phone,
         contact_email = v_contact_email,
         address = v_address
   where id = v_id
     and brand_id = p_brand_id;

  return v_id;
end;
$$;

comment on function public.save_outbound_partner_unit_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid,
  uuid, text, text, text, text, text, text, jsonb
) is
  '출고 단위·별칭·폴더·업체 그룹·지점·채널·거래처 연락처를 기존 id를 유지하며 원자 저장한다.';

revoke all on function public.save_outbound_partner_unit_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid,
  uuid, text, text, text, text, text, text, jsonb
) from public;

grant execute on function public.save_outbound_partner_unit_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, uuid,
  uuid, text, text, text, text, text, text, jsonb
) to authenticated;
