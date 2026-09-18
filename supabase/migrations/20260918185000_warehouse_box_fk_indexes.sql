-- 개별 박스 이력·원본 묶음 FK 조회용 인덱스. 1차 테스트 행이 적어도 advisor 경고를 만들지 않는다.

create index if not exists warehouse_boxes_source_position_idx
  on public.warehouse_boxes (source_position_id)
  where source_position_id is not null;

create index if not exists warehouse_box_movements_from_location_idx
  on public.warehouse_box_movements (from_location_id)
  where from_location_id is not null;

create index if not exists warehouse_box_movements_to_location_idx
  on public.warehouse_box_movements (to_location_id)
  where to_location_id is not null;
