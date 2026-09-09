-- 전체 교체 RPC는 service_role만 실행한다. 테이블 DML을 service_role에
-- 열지 않고, 함수 정의자(postgres) 권한으로 원자 교체한다.

alter function public.replace_warehouse_inventory_snapshot(uuid, text, jsonb)
  security definer;

revoke all on function public.replace_warehouse_inventory_snapshot(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_warehouse_inventory_snapshot(uuid, text, jsonb)
  to service_role;
