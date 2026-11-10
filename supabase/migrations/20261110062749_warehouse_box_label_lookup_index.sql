-- Cover the composite foreign key and brand-filtered batch reloads.
create index warehouse_box_labels_batch_brand_idx on public.warehouse_box_labels (batch_id, brand_id);
