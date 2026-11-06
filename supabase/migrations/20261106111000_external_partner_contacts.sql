-- External partner departments can name up to three active members as the people headquarters talks to.
alter table public.department_workforce_policies add column if not exists contact_ids uuid[] not null default '{}';
alter table public.department_workforce_policies drop constraint if exists department_workforce_contacts_limit;
alter table public.department_workforce_policies add constraint department_workforce_contacts_limit check (cardinality(contact_ids) <= 3);
alter table public.department_workforce_policies drop constraint if exists department_workforce_contacts_mode;
alter table public.department_workforce_policies add constraint department_workforce_contacts_mode check (mode = 'external' or cardinality(contact_ids) = 0);

create or replace function app.list_department_workforce_management() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.permission_company_id();
begin
 if company is null then raise exception '활성 직원 계정이 필요합니다.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
  'departmentId',d.id,
  'mode',app.department_workforce_mode(company,d.id),
  'trackingStart',w.tracking_start,
  'contactIds',coalesce(to_jsonb(w.contact_ids),'[]'::jsonb),
  'version',coalesce(w.version,0)
 ) order by d.sort_order,d.id),'[]'::jsonb)
 from public.departments d left join public.department_workforce_policies w on w.department_id=d.id and w.company_id=company where d.company_id=company and d.is_active);
end$$;

create or replace function app.save_department_workforce_management(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare company uuid:=app.permission_company_id(); dept uuid:=(p_input->>'departmentId')::uuid;
 selected text:=p_input->>'mode'; starts date:=(p_input->>'trackingStart')::date; expected integer:=(p_input->>'version')::integer;
 previous public.department_workforce_policies%rowtype; old_mode text; result jsonb; today date:=(now() at time zone 'Asia/Seoul')::date;
 contacts uuid[]:='{}'; raw jsonb:=p_input->'contactIds';
begin
 if company is null or app.can_edit_org_assignment() is not true then raise exception '조직 관리 권한이 필요합니다.' using errcode='42501';end if;
 if dept is null or selected is null or selected not in('head-office','local','external') or expected is null or expected<0 then raise exception '부서와 관리 방식을 확인해 주세요.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('department-workforce:'||dept::text,0));
 perform 1 from public.departments where id=dept and company_id=company and is_active for share;
 if not found then raise exception '같은 회사의 활성 부서만 설정할 수 있습니다.' using errcode='42501';end if;
 select * into previous from public.department_workforce_policies where department_id=dept;
 if coalesce(previous.version,0)<>expected then raise exception '부서 설정이 변경됐습니다. 새로 조회해 주세요.' using errcode='40001';end if;
 old_mode:=app.department_workforce_mode(company,dept);
 if selected='head-office' then
   if starts is null or starts<'2026-11-02' or (old_mode<>'head-office' and starts<today) then raise exception '본사 관리 전환은 오늘 이후 시작일을 지정해 주세요.' using errcode='22023';end if;
 else starts:=null;end if;
 if selected='external' and p_input ? 'contactIds' then
  if jsonb_typeof(raw)<>'array' or jsonb_array_length(raw)>3 then raise exception '소통 담당은 3명까지 지정할 수 있습니다.' using errcode='22023';end if;
  if (select count(*) from jsonb_array_elements_text(raw))<>(select count(distinct value) from jsonb_array_elements_text(raw)) then raise exception '소통 담당이 중복되었습니다.' using errcode='22023';end if;
  select coalesce(array_agg(value::uuid order by value::uuid),'{}') into contacts from jsonb_array_elements_text(raw);
  if exists(select 1 from unnest(contacts) as chosen(id) where not exists(select 1 from public.profiles p where p.id=chosen.id and p.company_id=company and p.department_id=dept and p.status='active')) then
   raise exception '소통 담당은 해당 부서의 재직 직원만 지정할 수 있습니다.' using errcode='22023';
  end if;
 elsif selected='external' then contacts:=coalesce(previous.contact_ids,'{}');
 else contacts:='{}';end if;
 if previous.mode=selected and previous.tracking_start is not distinct from starts and coalesce(previous.contact_ids,'{}')=contacts then
  return jsonb_build_object('departmentId',dept,'mode',selected,'trackingStart',starts,'contactIds',to_jsonb(contacts),'version',expected);
 end if;
 insert into public.department_workforce_policies(department_id,company_id,mode,tracking_start,contact_ids,version,updated_by)
 values(dept,company,selected,starts,contacts,expected+1,auth.uid())
 on conflict(department_id) do update set mode=excluded.mode,tracking_start=excluded.tracking_start,contact_ids=excluded.contact_ids,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 result:=jsonb_build_object('departmentId',dept,'mode',selected,'trackingStart',starts,'contactIds',to_jsonb(contacts),'version',expected+1);
 insert into app.department_workforce_events(company_id,department_id,actor_id,before_value,after_value)
 values(company,dept,auth.uid(),jsonb_build_object('mode',old_mode,'trackingStart',previous.tracking_start,'contactIds',coalesce(to_jsonb(previous.contact_ids),'[]'::jsonb),'version',expected),result);
 return result;
end$$;
