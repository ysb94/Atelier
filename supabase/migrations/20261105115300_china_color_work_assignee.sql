-- 컬러샘플 회차에도 중국팀 담당자를 남긴다. 기획안 저장이 그 필드를 빠뜨려도 기존 담당자는 유지한다.

create or replace function app.keep_color_sample_assignee() returns trigger language plpgsql set search_path='' as $$
declare rounds jsonb; previous jsonb; index int; current jsonb; saved jsonb;
begin
 if tg_op<>'UPDATE' or jsonb_typeof(new.specs->'colorSampleRounds')<>'array' then return new; end if;
 rounds:=new.specs->'colorSampleRounds';
 previous:=coalesce(old.specs->'colorSampleRounds','[]'::jsonb);
 for index in 0..jsonb_array_length(rounds)-1 loop
  current:=rounds->index;
  if current ? 'assigneeId' then continue; end if;
  select value into saved from jsonb_array_elements(previous) where value->>'id'=current->>'id' and value->>'url'=current->>'url' limit 1;
  if saved is not null and saved ? 'assigneeId' then
   current:=current||jsonb_build_object('assigneeId',saved->'assigneeId','assigneeName',coalesce(saved->'assigneeName','""'::jsonb));
   rounds:=jsonb_set(rounds,array[index::text],current);
  end if;
 end loop;
 new.specs:=jsonb_set(new.specs,'{colorSampleRounds}',rounds);
 return new;
end $$;

drop trigger if exists keep_color_sample_assignee on public.product_drafts;
create trigger keep_color_sample_assignee before update on public.product_drafts
for each row execute function app.keep_color_sample_assignee();
revoke all on function app.keep_color_sample_assignee() from public,anon;
grant execute on function app.keep_color_sample_assignee() to authenticated;

create or replace function app.china_work_order(p_draft uuid,p_order text,p_kind text,p_action text,p_assignee uuid,p_revision timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare d public.product_drafts%rowtype; items jsonb; item jsonb; idx int; target jsonb; assignee_name text;
begin
 if not app.basic_work_allowed('china') then raise exception '중국팀 작업 권한이 없습니다.' using errcode='42501'; end if;
 select * into d from public.product_drafts where id=p_draft and company_id='e0000000-0000-4000-8000-000000000001' for update;
 if not found then raise exception '기획안을 찾을 수 없습니다.'; end if;
 if d.updated_at is distinct from p_revision then raise exception '다른 직원이 수정했습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 if p_kind not in ('sample','color') or p_action not in ('assign','check','ship') then raise exception '지원하지 않는 지시서 작업입니다.'; end if;
 if p_action='assign' and p_assignee is not null then
  select display_name into assignee_name from public.profiles where id=p_assignee and status='active' and company_id=d.company_id and department_id=app.work_department('china');
  if not found then raise exception '중국팀 재직 직원을 선택하세요.'; end if;
 end if;
 if p_kind='color' and p_action='assign' then
  select ordinality::int-1 into idx from jsonb_array_elements(coalesce(d.specs->'colorSampleRounds','[]'::jsonb)) with ordinality where value->>'id'=p_order limit 1;
  if idx is null then raise exception '컬러 지시서를 찾지 못했습니다.'; end if;
  item:=coalesce(d.specs->'colorSampleRounds'->idx,'{}'::jsonb)||jsonb_build_object('assigneeId',p_assignee,'assigneeName',coalesce(assignee_name,''));
  perform set_config('app.china_workorder','on',true);
  update public.product_drafts set specs=jsonb_set(specs,array['colorSampleRounds',idx::text],item),updated_at=clock_timestamp() where id=p_draft;
 elsif p_kind='color' then
  if p_action<>'ship' then raise exception '컬러 지시서는 발송 처리만 가능합니다.'; end if;
  select value into target from (select jsonb_build_object('id',c.id) value from public.draft_colors c where c.id::text=p_order and c.draft_id=p_draft and c.sample_work_order_url is not null) v;
  if target is null then raise exception '컬러 지시서를 찾지 못했습니다.'; end if;
  perform set_config('app.china_workorder','on',true);
  update public.draft_colors set sample_work_order_shipped=true,sample_work_order_shipped_at=coalesce(sample_work_order_shipped_at,now()) where id::text=p_order and draft_id=p_draft;
  update public.product_drafts set specs=case when jsonb_array_length(coalesce(specs->'colorSampleRounds','[]'))>0 then jsonb_set(specs,array['colorSampleRounds',(jsonb_array_length(specs->'colorSampleRounds')-1)::text,'returnedAt'],to_jsonb(coalesce(nullif(specs->'colorSampleRounds'->-1->>'returnedAt',''),now()::text))) else specs end,updated_at=clock_timestamp() where id=p_draft;
 else
  items:=d.sample_work_orders;
  select value,ordinality::int-1 into item,idx from jsonb_array_elements(items) with ordinality where value->>'id'=p_order;
  if item is null or nullif(item->>'url','') is null then raise exception '지시서를 찾지 못했습니다.'; end if;
  if p_action='assign' then
   item:=item||jsonb_build_object('assigneeId',p_assignee,'assigneeName',coalesce(assignee_name,''));
  elsif p_action='check' then item:=item||jsonb_build_object('fileCheckedAt',coalesce(item->>'fileCheckedAt',now()::text));
  else item:=item||jsonb_build_object('returnedAt',coalesce(item->>'returnedAt',now()::text)); end if;
  items:=jsonb_set(items,array[idx::text],item);
  perform set_config('app.china_workorder','on',true);
  update public.product_drafts set sample_work_orders=items,updated_at=clock_timestamp() where id=p_draft;
 end if;
 perform set_config('app.china_workorder','off',true);
end $$;
