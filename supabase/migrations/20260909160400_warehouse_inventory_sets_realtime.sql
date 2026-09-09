-- 창고 화면은 재고 행 전체가 아니라 활성 세트 교체 신호만 받는다.
-- warehouse_stock_positions 를 publication에 넣지 않는다.

alter publication supabase_realtime
  add table public.warehouse_inventory_sets;
