-- 판매상품 구성 태그를 비교에 남기고, 행사·증정·상품 상태 태그는 비교에서 뺀다.

alter table public.invoice_product_name_tag_roles
  drop constraint if exists invoice_product_name_tag_roles_role_check;

alter table public.invoice_product_name_tag_roles
  add constraint invoice_product_name_tag_roles_role_check
  check (role in (
    'product_composition',
    'event_marketing',
    'composition_gift',
    'identity_condition',
    'unknown'
  ));

comment on column public.invoice_product_name_tag_roles.role is
  'product_composition은 비교에 유지. event_marketing·composition_gift·identity_condition은 비교에서 제외. unknown은 저장 전까지 원문 유지.';

update public.invoice_product_name_tag_roles
set role = 'product_composition'
where role <> 'product_composition'
  and (
    normalized_tag in (
      '[set]',
      '[pouch set]',
      '[에어팟파우치세트]',
      '[체인스트랩세트]',
      '[컬러스트랩세트]',
      '[파우치세트]',
      '[숄더스트랩 포함]',
      '[태슬1개 포함]',
      '[태슬 1개 포함]'
    )
    or normalized_tag ~ '세트]$'
    or normalized_tag ~ '포함]$'
  );

update public.invoice_product_name_tag_roles
set role = 'composition_gift'
where role not in ('product_composition', 'composition_gift')
  and normalized_tag ~ '증정';
