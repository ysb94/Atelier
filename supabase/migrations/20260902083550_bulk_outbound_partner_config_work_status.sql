-- 대량출고에 등록한 업체의 바코드 준비 상태.
-- idle=대기, working=작업중, done=완료.

alter table public.bulk_outbound_partner_configs
  add column if not exists work_status text not null default 'idle';

alter table public.bulk_outbound_partner_configs
  drop constraint if exists bulk_outbound_partner_configs_work_status_check;

alter table public.bulk_outbound_partner_configs
  add constraint bulk_outbound_partner_configs_work_status_check
  check (work_status = any (array['idle'::text, 'working'::text, 'done'::text]));

comment on column public.bulk_outbound_partner_configs.work_status is
  '업체 바코드 준비 상태. idle=대기, working=작업중, done=완료.';
