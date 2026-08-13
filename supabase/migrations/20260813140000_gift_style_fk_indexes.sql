-- advisor: style 복합 FK covering index
create index if not exists invoice_gift_quotas_style_idx
  on public.invoice_gift_quotas (brand_id, style_id);

create index if not exists invoice_gift_allocations_style_idx
  on public.invoice_gift_allocations (brand_id, style_id);
