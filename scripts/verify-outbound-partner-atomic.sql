-- 개발자 계정 권한으로 실행한다. 모든 검증용 행과 변경은 마지막 ROLLBACK으로 취소한다.
begin;
select set_config('request.jwt.claim.sub',
  (select id::text from public.profiles where email = 'dev@atelier.local' and status = 'active' and is_admin),
  true);
set local role authenticated;

do $$
declare
  v_brand uuid;
  v_group_a uuid;
  v_group_b uuid;
  v_a uuid;
  v_a2 uuid;
  v_b uuid;
  v_tag text := txid_current()::text;
  v_original_name text := '검증업체A' || v_tag;
  v_success_name text := '검증저장완료' || v_tag;
  v_collision_name text := '검증충돌별칭' || v_tag;
  v_failed boolean;
  v_before_aliases jsonb;
begin
  select id into v_brand from public.brands where app.can_edit_brand(id) order by id limit 1;
  if v_brand is null then raise exception '검증 가능한 브랜드가 없습니다.'; end if;

  insert into public.outbound_partner_groups(brand_id, name, normalized_name)
    values(v_brand, v_original_name, app.outbound_partner_name_key(v_original_name))
    returning id into v_group_a;
  insert into public.outbound_partner_groups(brand_id, name, normalized_name)
    values(v_brand, '검증업체B' || v_tag, 'unused')
    returning id into v_group_b;
  insert into public.code_usage_targets(brand_id, name, normalized_name, group_id, channel_type)
    values(v_brand, v_original_name || '원본', 'unused', v_group_a, 'online')
    returning id into v_a;
  insert into public.code_usage_targets(brand_id, name, normalized_name, group_id, site_name, channel_type)
    values(v_brand, v_original_name || '홍대점원본', 'unused', v_group_a, '홍대점', 'offline')
    returning id into v_a2;
  insert into public.code_usage_targets(brand_id, name, normalized_name, group_id)
    values(v_brand, '검증업체B원본' || v_tag, 'unused', v_group_b)
    returning id into v_b;
  insert into public.code_usage_target_aliases(brand_id, target_id, alias, normalized_alias)
    values(v_brand, v_b, v_collision_name, 'unused');
  insert into public.code_usage_target_aliases(brand_id, target_id, alias, normalized_alias)
    values(v_brand, v_a, '검증보존별칭' || v_tag, 'unused');
  set constraints all immediate;
  set constraints all deferred;
  select jsonb_agg(to_jsonb(a) order by a.id) into v_before_aliases
    from public.code_usage_target_aliases a where target_id = v_a;

  -- 지점·채널이 달라도 같은 전체 이름은 DB에서 거절한다.
  v_failed := false;
  begin
    update public.code_usage_targets set site_name = '홍대점' where id = v_a;
    set constraints all immediate;
  exception when unique_violation then v_failed := true;
  end;
  assert v_failed, '지점 중복을 DB에서 허용했습니다.';
  assert (select site_name = '' from public.code_usage_targets where id = v_a), '실패한 지점 수정이 남았습니다.';
  set constraints all deferred;

  -- 업체명 변경 후 잘못된 폴더로 저장이 실패해도 그룹 이름은 되돌린다.
  v_failed := false;
  begin
    perform public.save_outbound_partner_unit_atomic(
      v_brand, v_a, v_original_name || '원본', 'unused',
      'online', 'unset', false, true, '실패검증', gen_random_uuid(),
      v_group_a, '검증실패이름' || v_tag, '', '',
      '남으면안됨', '', '', '', '[]'::jsonb
    );
  exception when raise_exception then v_failed := true;
  end;
  assert v_failed, '존재하지 않는 폴더를 허용했습니다.';
  assert (select name = v_original_name from public.outbound_partner_groups where id = v_group_a), '업체명만 저장되었습니다.';
  assert (select contact_name = '' from public.code_usage_targets where id = v_a), '연락처만 저장되었습니다.';
  assert (select jsonb_agg(to_jsonb(a) order by a.id) from public.code_usage_target_aliases a where target_id = v_a) = v_before_aliases,
    '실패하면서 기존 별칭이 바뀌었습니다.';

  -- 최종 별칭 충돌로 실패하는 경우에도 그룹·연락처·별칭 전체를 취소한다.
  v_failed := false;
  begin
    perform public.save_outbound_partner_unit_atomic(
      v_brand, v_a, v_original_name || '원본', 'unused',
      'online', 'unset', false, true, '', null,
      v_group_a, v_collision_name, '', '',
      '남으면안됨', '', '', '', '[]'::jsonb
    );
    set constraints all immediate;
  exception when unique_violation then v_failed := true;
  end;
  assert v_failed, '업체명과 다른 업체 별칭 충돌을 허용했습니다.';
  assert (select name = v_original_name from public.outbound_partner_groups where id = v_group_a), '충돌한 업체명이 남았습니다.';
  assert (select jsonb_agg(to_jsonb(a) order by a.id) from public.code_usage_target_aliases a where target_id = v_a) = v_before_aliases,
    '충돌 저장으로 기존 별칭을 잃었습니다.';
  set constraints all deferred;

  perform public.save_outbound_partner_unit_atomic(
    v_brand, v_a, v_original_name || '원본', 'unused',
    'online', 'unset', false, true, '정상저장', null,
    v_group_a, v_success_name, '강남점', '강남점',
    '새담당자', '', '', '', jsonb_build_array(jsonb_build_object(
      'alias', '검증새별칭' || v_tag, 'normalized_alias', app.outbound_partner_name_key('검증새별칭' || v_tag)
    ))
  );
  set constraints all immediate;
  assert (select name = v_success_name from public.outbound_partner_groups where id = v_group_a), '정상 업체명이 저장되지 않았습니다.';
  assert (select site_name = '강남점' and contact_name = '새담당자' from public.code_usage_targets where id = v_a),
    '지점·연락처가 함께 저장되지 않았습니다.';
  assert (select count(*) = 1 and bool_and(alias = '검증새별칭' || v_tag)
    from public.code_usage_target_aliases where target_id = v_a), '별칭 최종 목록을 저장하지 못했습니다.';
  set constraints all deferred;

  v_failed := false;
  begin
    insert into public.code_usage_target_aliases(brand_id, target_id, alias, normalized_alias)
      values(v_brand, v_b, v_success_name || ' 강남점', 'unused');
    set constraints all immediate;
  exception when unique_violation then v_failed := true;
  end;
  assert v_failed, '다른 업체의 공식 지점명을 별칭으로 가져왔습니다.';
  set constraints all deferred;

  -- 기존 중복 이름의 연락처 저장은 허용한다(있을 때만 검사).
  update public.code_usage_targets set contact_name = contact_name
    where brand_id = v_brand;
  set constraints all immediate;
end;
$$;
rollback;
select 'outbound partner atomic save, collision guards, rollback: PASS' as result;
