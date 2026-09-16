-- 이전 스크립트(service_role)만 테이블을 읽고 쓴다. 앱 anon/authenticated 범위는 그대로다.

grant select, insert, update, delete on
  public.masma_finder_users,
  public.masma_finder_access_audit,
  public.masma_finder_work_days,
  public.masma_finder_work_templates,
  public.masma_finder_work_tasks,
  public.masma_finder_work_attachments,
  public.masma_finder_incoming_groups,
  public.masma_finder_incoming_items,
  public.masma_finder_move_drafts,
  public.masma_finder_move_exports,
  public.masma_finder_move_export_rows,
  public.masma_finder_label_scans,
  public.masma_finder_ocr_usage
to service_role;
