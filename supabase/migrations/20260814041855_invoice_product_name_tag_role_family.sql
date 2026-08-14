-- normalized_tag는 exact 키 또는 예약배송 날짜 계열 키다.
-- 예: [8/21예약배송] → family:reservation_shipping_date

comment on column public.invoice_product_name_tag_roles.normalized_tag is
  '앱 normalizeInvoiceText exact 키, 또는 날짜만 다른 예약배송 계열 키 family:reservation_shipping_date.';
comment on column public.invoice_product_name_tag_roles.tag_text is
  '표시용 원문 태그. 예약배송 계열은 [날짜 예약배송]으로 저장하고 실제 날짜 원문은 품목명에 남긴다.';
