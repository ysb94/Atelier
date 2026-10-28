begin;
-- 본인·회사 검증은 유지하고 즉시 등록 가능한 항목에 외근만 추가한다.
alter policy leave_create on public.company_leave_requests with check (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.status = 'active'::text)))) AND (employee_id = ( SELECT auth.uid() AS uid)) AND ((status = 'pending'::text) OR ((status = 'approved'::text) AND (kind = ANY (ARRAY['annual'::text, 'half'::text, 'quarter'::text, 'offsite'::text]))))));
commit;
