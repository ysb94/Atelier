-- 첨부 이중 행 방지. Firestore 메타와 Storage 객체는 같은 경로면 한 행이다.

create unique index if not exists masma_finder_work_attachments_legacy_path_uidx
  on public.masma_finder_work_attachments (brand_id, legacy_object_path)
  where legacy_object_path is not null and legacy_object_path <> '';
