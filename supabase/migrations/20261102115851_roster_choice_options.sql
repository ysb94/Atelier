-- Add only choice metadata; existing labels, visibility, personnel values and policies stay intact.
-- Applied to Atelier on 2026-11-02. Filename matches the remote migration history.
alter table public.employee_roster_header_settings
 add column choice_options text[],
 add column choice_revision bigint not null default 0 check(choice_revision>=0);

create function app.valid_roster_choice_options(p_key text,p_options text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
 select p_options is null or (
  p_key in ('bankName','workplace','employmentType','gender','workDays','workHours','breakTime','payBasis')
  and cardinality(p_options)<=100 and coalesce(array_ndims(p_options),1)=1
  and not exists(select 1 from unnest(p_options) value where value is null or btrim(value)='' or value<>btrim(value)
   or char_length(value)>case p_key when 'gender' then 10 when 'bankName' then 40 when 'employmentType' then 40 when 'payBasis' then 40 else 80 end)
  and cardinality(p_options)=(select count(distinct value) from unnest(p_options) value)
 );
$$;
revoke all on function app.valid_roster_choice_options(text,text[]) from public,anon;
grant execute on function app.valid_roster_choice_options(text,text[]) to authenticated;
alter table public.employee_roster_header_settings add constraint roster_choice_options_valid
 check(app.valid_roster_choice_options(header_key,choice_options));

create function public.save_roster_choice_options(p_key text,p_options text[],p_revision bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare company uuid; label text; actual bigint;
begin
 select company_id into company from public.profiles where id=(select auth.uid()) and status='active';
 if company is null or not (app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then
  raise exception '직원 배치 설정 권한이 없습니다.' using errcode='42501';
 end if;
 label:=case p_key when 'bankName' then '은행명' when 'workplace' then '근무지' when 'employmentType' then '근로형태' when 'gender' then '성별'
  when 'workDays' then '근로일' when 'workHours' then '근로시간' when 'breakTime' then '휴게시간' when 'payBasis' then '연봉기준' end;
 if label is null or p_options is null or not app.valid_roster_choice_options(p_key,p_options) then raise exception '선택 목록의 항목·길이·중복을 확인해 주세요.' using errcode='23514'; end if;
 if p_revision is null or p_revision<0 then raise exception '목록을 다시 불러와 주세요.' using errcode='40001'; end if;
 if p_revision=0 then
  insert into public.employee_roster_header_settings(company_id,header_key,label,choice_options,choice_revision)
   values(company,p_key,label,p_options,1) on conflict(company_id,header_key) do nothing;
  if found then return; end if;
 end if;
 update public.employee_roster_header_settings set choice_options=p_options,choice_revision=choice_revision+1
  where company_id=company and header_key=p_key and choice_revision=p_revision;
 if not found then raise exception '다른 곳에서 목록을 변경했습니다. 다시 불러와 주세요.' using errcode='40001'; end if;
end $$;
revoke all on function public.save_roster_choice_options(text,text[],bigint) from public,anon;
grant execute on function public.save_roster_choice_options(text,text[],bigint) to authenticated;
notify pgrst,'reload schema';
