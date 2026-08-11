alter table public.invoice_name_rules
  add column action text not null default 'rename';

alter table public.invoice_name_rules
  drop constraint invoice_name_rules_target_name_check;

alter table public.invoice_name_rules
  alter column target_name drop not null;

alter table public.invoice_name_rules
  add constraint invoice_name_rules_action_check
  check (action in ('rename', 'exception'));

alter table public.invoice_name_rules
  add constraint invoice_name_rules_action_target_check
  check (
    (
      action = 'rename'
      and target_name is not null
      and length(btrim(target_name)) > 0
    )
    or (
      action = 'exception'
      and target_name is null
    )
  );

comment on column public.invoice_name_rules.action is
  'rename은 공식 상품명으로 변경하고 exception은 이 매칭 단계를 건너뛴다.';
comment on column public.invoice_name_rules.target_name is
  'action=rename이면 필수인 상품업체 상품명(업체 공식). exception이면 null.';

update public.invoice_name_rules
set is_active = false
where is_test;
