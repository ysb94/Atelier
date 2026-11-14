alter table public.warehouse_stock_condition_links
  drop constraint warehouse_stock_condition_links_condition_check,
  add constraint warehouse_stock_condition_links_condition_check check (condition in (
    'defective',
    'needs_repair',
    'under_repair',
    'needs_inspection',
    'awaiting_inspection',
    'sale_hold',
    'production_error'
  ));
