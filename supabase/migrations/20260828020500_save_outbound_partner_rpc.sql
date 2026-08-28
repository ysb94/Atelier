-- 출고업체 1건과 별칭 목록을 한 트랜잭션으로 저장한다.
-- 업체는 남았는데 별칭만 실패하는 중간 상태를 만들지 않는다.
-- 정규화 키는 앱이 계산해 넘긴다(DB generated column을 쓰지 않는 기존 관례).

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
           note = coalesce(p_note, note)
     where id = p_id
       and brand_id = p_brand_id
    returning id into v_id;

    if v_id is null then
      raise exception '업체를 찾을 수 없습니다.';
    end if;
  end if;

  -- 별칭은 통째로 교체한다. 목록이 곧 최종 상태다.
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

comment on function public.save_outbound_partner_with_aliases is
  '출고업체와 별칭 목록을 원자 저장한다. 별칭은 전달한 배열로 통째 교체한다.';

revoke all on function public.save_outbound_partner_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, jsonb
) from public;

grant execute on function public.save_outbound_partner_with_aliases(
  uuid, uuid, text, text, text, text, boolean, boolean, text, jsonb
) to authenticated;
