-- warehouse-sheet-sync Edge Function은 service_role로 조회한 뒤
-- replace_warehouse_inventory_snapshot 만 호출한다.
-- 이 프로젝트는 공개 테이블 DML을 authenticated에만 두고 service_role
-- SELECT가 빠져 있어, 함수가 brands/styles/창고 룩업에서 거절된다.

grant select on table public.brands to service_role;
grant select on table public.styles to service_role;
grant select on table public.warehouse_inventory_sets to service_role;
grant select on table public.warehouse_registered_slots to service_role;
