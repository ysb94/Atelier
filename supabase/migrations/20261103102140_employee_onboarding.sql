-- Additive onboarding only. No existing profile/roster rows are updated by this migration.
create table app.employee_onboardings (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 profile_id uuid not null references public.profiles(id), is_test boolean not null default false,
 personal jsonb not null default '{}', personal_draft boolean not null default false, company_info jsonb not null default '{}',
 submitted_at timestamptz, completed_at timestamptz, completed_by uuid references public.profiles(id),
 version bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,profile_id,is_test)
);
create table app.employee_onboarding_files (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references app.employee_onboardings(id),
 kind text not null check(kind in ('identity','bank','education','residentRegister','businessCertificate','contract','privacyConsent','biometricConsent')),
 path text not null unique, name text not null, mime text not null, size bigint not null check(size between 1 and 10485760), replaces_id uuid,
 ready boolean not null default false, removed_at timestamptz, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create unique index onboarding_current_file on app.employee_onboarding_files(case_id,kind) where ready and removed_at is null;
create table app.employee_onboarding_events (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references app.employee_onboardings(id),
 actor_id uuid not null references public.profiles(id), action text not null, created_at timestamptz not null default now()
);
alter table app.employee_onboardings enable row level security;
alter table app.employee_onboarding_files enable row level security;
alter table app.employee_onboarding_events enable row level security;
revoke all on app.employee_onboardings,app.employee_onboarding_files,app.employee_onboarding_events from public,anon,authenticated;

create function app.onboarding_manager() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
 and p.company_id='e0000000-0000-4000-8000-000000000001' and (
 p.id in ('d0000000-0000-4000-8000-000000000001','a5afdd00-4a61-44dc-a1a3-082fa8a1345d','56074867-fdc2-4ce5-8e97-cea431decc36')
 or exists(select 1 from public.departments d where d.id=p.department_id and d.id='2e49ef43-75b9-4c89-b42d-9fd50ad9087b' and d.is_active)));
$$;
create function app.onboarding_access(p_case uuid,p_manage boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app.employee_onboardings c join public.profiles p on p.id=auth.uid() join public.profiles t on t.id=c.profile_id
 where c.id=p_case and p.status='active' and p.company_id=c.company_id and t.company_id=c.company_id
 and (app.onboarding_manager() or (not p_manage and c.profile_id=p.id and t.status='active'))
 and (not c.is_test or p.id='d0000000-0000-4000-8000-000000000001'));
$$;
create function app.onboarding_personal_roster(p_employee uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('phone',coalesce(r.phone,''),'bank',coalesce(r.bank_name,''),'accountNumber',coalesce(r.bank_account,''),
 'residentFront',split_part(coalesce(r.resident_id,''),'-',1),'residentBack',split_part(coalesce(r.resident_id,''),'-',2),
 'address',coalesce(r.home_address,''),'addressDetail','','gmail',split_part(coalesce(r.gmail,''),'@',1),'naverEmail',split_part(coalesce(r.naver_email,''),'@',1))
 from (select 1) a left join public.employee_roster r on r.profile_id=p_employee;
$$;
create function app.onboarding_stamp(p_employee uuid) returns text language sql stable security definer set search_path='' as $$
 select md5((app.onboarding_personal_roster(p_employee)||jsonb_build_object(
 'assignment',jsonb_build_array(p.department_id,p.position,p.job_grade,p.hire_date),
 'work',jsonb_build_array(r.workplace,r.employment_type,r.job_description,r.work_days,r.work_hours,r.break_time,r.pay_basis,r.annual_salary,r.monthly_wage,r.meal_allowance,r.car_allowance,r.childcare_allowance,r.duty_allowance,r.fixed_overtime_plan)))::text)
 from public.profiles p left join public.employee_roster r on r.profile_id=p.id where p.id=p_employee;
$$;
create function app.onboarding_company_roster(p_employee uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('departmentId',p.department_id,'position',p.position,'jobGrade',p.job_grade,'hireDate',p.hire_date,
 'workplace',r.workplace,'employmentType',r.employment_type,'jobDescription',r.job_description,'workDays',r.work_days,'workHours',r.work_hours,'breakTime',r.break_time,
 'payBasis',r.pay_basis,'annualSalary',r.annual_salary,'monthlyWage',r.monthly_wage,'mealAllowance',r.meal_allowance,'carAllowance',r.car_allowance,
 'childcareAllowance',r.childcare_allowance,'dutyAllowance',r.duty_allowance,'fixedOvertimePlan',r.fixed_overtime_plan))
 from public.profiles p left join public.employee_roster r on r.profile_id=p.id where p.id=p_employee;
$$;

-- Future access requests are enrolled without changing their login or approval state.
create function app.enroll_employee_onboarding() returns trigger language plpgsql security definer set search_path='' as $$
declare c app.employee_onboardings;
begin
 if new.company_id='e0000000-0000-4000-8000-000000000001' and new.requested_at is not null
 and (new.status='pending' or (tg_op='UPDATE' and old.status='pending' and new.status='active')) then
 insert into app.employee_onboardings(company_id,profile_id) values(new.company_id,new.id) on conflict do nothing;
 if tg_op='UPDATE' and old.status='pending' and new.status='active' then
 select * into c from app.employee_onboardings where profile_id=new.id and not is_test;
 if c.company_info<>'{}'::jsonb and app.onboarding_manager() then
 perform app.save_employee_onboarding(c.id,'company',c.company_info,c.version,app.onboarding_stamp(new.id));
 end if;
 end if;
 end if;
 return new;
end; $$;

create function app.save_employee_onboarding(p_case uuid,p_section text,p_data jsonb,p_version bigint,p_roster_stamp text) returns jsonb
 language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c app.employee_onboardings; k text; v jsonb; prior_flag text; target_status text; birth date; full_id text;
begin
 if p_section is null or p_section not in ('draft','submit','company') or not app.onboarding_access(p_case,p_section='company') then raise exception '저장 권한이 없습니다.'; end if;
 select * into c from app.employee_onboardings where id=p_case for update;
 if c.completed_at is not null then raise exception '완료된 기록입니다. 진행 중으로 되돌린 뒤 수정해 주세요.'; end if;
 if c.version is distinct from p_version or (not c.is_test and p_roster_stamp is distinct from app.onboarding_stamp(c.profile_id)) then raise exception '다른 곳에서 정보가 변경됐습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 select status into target_status from public.profiles where id=c.profile_id;
 if p_section in ('draft','submit') and (auth.uid()<>c.profile_id or target_status<>'active') then raise exception '승인된 본인 계정만 제출할 수 있습니다.'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or pg_column_size(p_data)>40000 then raise exception '입력 내용을 확인해 주세요.'; end if;
 for k in select jsonb_object_keys(p_data) loop
 if jsonb_typeof(p_data->k)<>'string' or length(p_data->>k)>1000 then raise exception '입력 형식이나 길이를 확인해 주세요.'; end if;
 if p_section<>'company' and k<>all(array['englishName','residentFront','residentBack','phone','address','addressDetail','gmail','naverEmail','bank','accountHolder','accountNumber']) then raise exception '허용되지 않은 입력입니다.'; end if;
 if p_section='company' and k<>all(array['employerName','representative','employerAddress','employeeNumber','departmentId','position','jobGrade','hireDate','workplace','employmentType','jobDescription','contractTerm','contractMonths','contractStart','contractEnd','wageTerm','wageMonths','wageStart','wageEnd','probationApply','probationMonths','probationStart','probationEnd','probationPayRate','documentDate','periodMode','workDays','workHours','breakTime','workStart','workEnd','breakStart','breakEnd','weeklyHoliday','payDay','payBasis','wageMode','fixedOvertimePlan','annualSalary','monthlyWage','basePay','baseHours','mealAllowance','carAllowance','researchAllowance','childcareAllowance','dutyAllowance','overtimeHours','overtimeAllowance','nightHours','nightAllowance','holidayHours','holidayAllowance','annualLeaveHours','annualLeaveAllowance']) then raise exception '허용되지 않은 회사 입력입니다.'; end if;
 end loop;
 v:=p_data;
 if p_section='submit' then
 foreach k in array array['englishName','residentFront','residentBack','phone','address','gmail','naverEmail','bank','accountHolder','accountNumber'] loop
 if btrim(coalesce(v->>k,''))='' then raise exception '필수정보를 모두 입력해 주세요.'; end if; end loop;
 if coalesce(v->>'residentFront','')!~'^[0-9]{6}$' or coalesce(v->>'residentBack','')!~'^[0-9]{7}$' then raise exception '주민등록번호 형식을 확인해 주세요.'; end if;
 full_id:=v->>'residentFront';
 birth:=make_date((case when left(v->>'residentBack',1) in ('1','2','5','6') then 1900 when left(v->>'residentBack',1) in ('3','4','7','8') then 2000 else 1800 end)+left(full_id,2)::int,substring(full_id,3,2)::int,right(full_id,2)::int);
 if v->>'gmail'!~'^[A-Za-z0-9._%+\-]{1,64}$' or v->>'naverEmail'!~'^[A-Za-z0-9._%+\-]{1,64}$' or regexp_replace(v->>'phone','[^0-9]','','g')!~'^[0-9]{9,11}$' or v->>'accountNumber'!~'^[0-9 -]{1,40}$' then raise exception '연락처·메일·계좌번호 형식을 확인해 주세요.'; end if;
 if (select count(distinct kind) from app.employee_onboarding_files where case_id=c.id and ready and removed_at is null and kind in ('identity','bank','education','residentRegister','businessCertificate'))<>5 then raise exception '필수 첨부서류 5종을 모두 업로드해 주세요.'; end if;
 end if;
 if p_section='company' then
 if coalesce(v->>'wageMode','') not in ('excel','manual') or coalesce(v->>'periodMode','') not in ('auto','manual') then raise exception '계산 방식을 선택해 주세요.'; end if;
 foreach k in array array['annualSalary','monthlyWage','basePay','mealAllowance','carAllowance','researchAllowance','childcareAllowance','dutyAllowance','overtimeAllowance','nightAllowance','holidayAllowance','annualLeaveAllowance'] loop
 if coalesce(v->>k,'')<>'' and (v->>k!~'^[0-9]+$' or (v->>k)::numeric>9007199254740991) then raise exception '금액은 0 이상의 정수로 입력해 주세요.'; end if; end loop;
 v:=app.onboarding_company_calculate(v);
 if coalesce(v->>'departmentId','')<>'' and not exists(select 1 from public.departments where id=(v->>'departmentId')::uuid and company_id=c.company_id and is_active) then raise exception '같은 회사의 부서를 선택해 주세요.'; end if;
 end if;
 -- Only this checked, bounded write uses the existing roster import gate, restored before returning.
 if not c.is_test and (p_section='submit' or (p_section='company' and target_status='active')) then
 prior_flag:=current_setting('app.roster_import',true); perform set_config('app.roster_import','on',true);
 if p_section='submit' then
 insert into public.employee_roster(profile_id,company_id,phone,bank_name,bank_account,resident_id,home_address,gmail,naver_email)
 values(c.profile_id,c.company_id,v->>'phone',v->>'bank',v->>'accountNumber',(v->>'residentFront')||'-'||(v->>'residentBack'),btrim((v->>'address')||' '||coalesce(v->>'addressDetail','')),(v->>'gmail')||'@gmail.com',(v->>'naverEmail')||'@naver.com')
 on conflict(profile_id) do update set phone=excluded.phone,bank_name=excluded.bank_name,bank_account=excluded.bank_account,resident_id=excluded.resident_id,home_address=excluded.home_address,gmail=excluded.gmail,naver_email=excluded.naver_email;
 else
 insert into public.employee_roster(profile_id,company_id,workplace,employment_type,job_description,work_days,work_hours,break_time,pay_basis,annual_salary,monthly_wage,meal_allowance,car_allowance,childcare_allowance,duty_allowance,fixed_overtime_plan)
 values(c.profile_id,c.company_id,coalesce(v->>'workplace',''),coalesce(v->>'employmentType',''),coalesce(v->>'jobDescription',''),coalesce(v->>'workDays',''),coalesce(nullif(v->>'workHours',''),(v->>'workStart')||' ~ '||(v->>'workEnd'),''),coalesce(nullif(v->>'breakTime',''),(v->>'breakStart')||' ~ '||(v->>'breakEnd'),''),coalesce(v->>'payBasis',''),coalesce(v->>'annualSalary',''),coalesce(v->>'monthlyWage',''),coalesce(v->>'mealAllowance',''),coalesce(v->>'carAllowance',''),coalesce(v->>'childcareAllowance',''),coalesce(v->>'dutyAllowance',''),coalesce(v->>'fixedOvertimePlan',''))
 on conflict(profile_id) do update set workplace=excluded.workplace,employment_type=excluded.employment_type,job_description=excluded.job_description,work_days=excluded.work_days,work_hours=excluded.work_hours,break_time=excluded.break_time,pay_basis=excluded.pay_basis,annual_salary=excluded.annual_salary,monthly_wage=excluded.monthly_wage,meal_allowance=excluded.meal_allowance,car_allowance=excluded.car_allowance,childcare_allowance=excluded.childcare_allowance,duty_allowance=excluded.duty_allowance,fixed_overtime_plan=excluded.fixed_overtime_plan;
 -- Preserve the existing assignment authorization and profile guards; no status/approval/capability writes.
 update public.profiles set department_id=nullif(v->>'departmentId','')::uuid,position=nullif(v->>'position',''),job_grade=nullif(v->>'jobGrade',''),hire_date=nullif(v->>'hireDate','')::date
 where id=c.profile_id and (app.can_edit_org_assignment() or app.basic_work_allowed('operations'));
 end if;
 perform set_config('app.roster_import',coalesce(prior_flag,''),true);
 end if;
 update app.employee_onboardings set personal=case when p_section in ('draft','submit') then v else personal end,
 personal_draft=case when p_section in ('draft','submit') then p_section='draft' else personal_draft end,
 company_info=case when p_section='company' then v else company_info end,submitted_at=case when p_section='submit' then now() else submitted_at end,
 version=version+1,updated_at=now() where id=c.id;
 insert into app.employee_onboarding_events(case_id,actor_id,action) values(c.id,auth.uid(),p_section);
 return app.get_employee_onboarding(c.id);
end; $$;

create function app.set_employee_onboarding_complete(p_case uuid,p_complete boolean,p_version bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c app.employee_onboardings;
begin
 if not app.onboarding_access(p_case,true) then raise exception '완료 처리 권한이 없습니다.'; end if;
 select * into c from app.employee_onboardings where id=p_case for update;
 if p_complete is null or c.version is distinct from p_version then raise exception '정보가 변경됐습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 update app.employee_onboardings set completed_at=case when p_complete then now() end,completed_by=case when p_complete then auth.uid() end,version=version+1,updated_at=now() where id=c.id;
 insert into app.employee_onboarding_events(case_id,actor_id,action) values(c.id,auth.uid(),case when p_complete then 'complete' else 'reopen' end);
 return app.get_employee_onboarding(c.id);
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('employee-onboarding','employee-onboarding',false,10485760,array['application/pdf','image/jpeg','image/png']);
create function app.begin_employee_onboarding_file(p_case uuid,p_kind text,p_name text,p_mime text,p_size bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c app.employee_onboardings; f app.employee_onboarding_files; ext text;
begin
 if not app.onboarding_access(p_case) then raise exception '첨부 권한이 없습니다.'; end if;
 select * into c from app.employee_onboardings where id=p_case for update;
 if c.completed_at is not null then raise exception '완료된 기록입니다. 진행 중으로 되돌려 주세요.'; end if;
 if p_kind in ('contract','privacyConsent','biometricConsent') and not app.onboarding_manager() then raise exception '서명본은 관리자가 등록합니다.'; end if;
 if not app.onboarding_manager() and not exists(select 1 from public.profiles where id=c.profile_id and status='active') then raise exception '승인 후 첨부할 수 있습니다.'; end if;
 if p_size not between 1 and 10485760 or length(p_name) not between 1 and 200 then raise exception '파일 크기·이름을 확인해 주세요.'; end if;
 ext:=case p_mime when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else null end;
 if ext is null or (p_mime='application/pdf' and p_name!~*'\.pdf$') or (p_mime='image/jpeg' and p_name!~*'\.jpe?g$') or (p_mime='image/png' and p_name!~*'\.png$') then raise exception 'PDF·JPG·PNG 파일을 선택해 주세요.'; end if;
 f.id:=gen_random_uuid();
 insert into app.employee_onboarding_files(id,case_id,kind,path,name,mime,size,created_by,replaces_id)
 values(f.id,c.id,p_kind,c.company_id::text||'/'||c.id::text||'/'||f.id::text||'.'||ext,p_name,p_mime,p_size,auth.uid(),(select id from app.employee_onboarding_files where case_id=c.id and kind=p_kind and ready and removed_at is null)) returning * into f;
 return jsonb_build_object('id',f.id,'path',f.path);
end; $$;
create function app.finish_employee_onboarding_file(p_file uuid) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare f app.employee_onboarding_files; c app.employee_onboardings;
begin
 select * into f from app.employee_onboarding_files where id=p_file;
 if f.id is null or not app.onboarding_access(f.case_id) or f.created_by<>auth.uid() then raise exception '첨부 권한이 없습니다.'; end if;
 select * into c from app.employee_onboardings where id=f.case_id for update;
 if c.completed_at is not null then raise exception '완료된 기록입니다.'; end if;
 if f.removed_at is not null then raise exception '교체된 파일입니다.'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='employee-onboarding' and o.name=f.path and (o.metadata->>'size')::bigint=f.size and o.metadata->>'mimetype'=f.mime) then raise exception '파일 업로드를 확인하지 못했습니다. 다시 시도해 주세요.'; end if;
 if not f.ready then
 if f.replaces_id is distinct from (select id from app.employee_onboarding_files where case_id=c.id and kind=f.kind and ready and removed_at is null) then raise exception '다른 파일이 먼저 등록됐습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 update app.employee_onboarding_files set removed_at=now() where case_id=f.case_id and kind=f.kind and ready and removed_at is null;
 update app.employee_onboarding_files set ready=true where id=f.id;
 insert into app.employee_onboarding_events(case_id,actor_id,action) values(f.case_id,auth.uid(),'file:'||f.kind);
 end if;
 return app.get_employee_onboarding(c.id);
end; $$;
create function app.remove_employee_onboarding_file(p_file uuid) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare f app.employee_onboarding_files; c app.employee_onboardings;
begin
 select * into f from app.employee_onboarding_files where id=p_file;
 if f.id is null or not app.onboarding_access(f.case_id) or (f.kind in ('contract','privacyConsent','biometricConsent') and not app.onboarding_manager()) then raise exception '첨부 수정 권한이 없습니다.'; end if;
 select * into c from app.employee_onboardings where id=f.case_id for update;
 if c.completed_at is not null then raise exception '완료된 기록입니다.'; end if;
 update app.employee_onboarding_files set removed_at=coalesce(removed_at,now()) where id=f.id;
 return app.get_employee_onboarding(c.id);
end; $$;
create function app.onboarding_storage_access(p_path text,p_write boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app.employee_onboarding_files f join app.employee_onboardings c on c.id=f.case_id where f.path=p_path
 and app.onboarding_access(c.id) and f.removed_at is null
 and (app.onboarding_manager() or f.kind in ('identity','bank','education','residentRegister','businessCertificate'))
 and case when p_write then not f.ready and f.created_by=auth.uid() and c.completed_at is null else f.ready end);
$$;
create function app.get_employee_onboarding_file_path(p_file uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare f app.employee_onboarding_files;
begin
 select * into f from app.employee_onboarding_files where id=p_file;
 if f.id is null or not app.onboarding_storage_access(f.path,false) then raise exception '파일 조회 권한이 없습니다.'; end if;
 return f.path;
end; $$;
create policy onboarding_file_upload on storage.objects for insert to authenticated with check(bucket_id='employee-onboarding' and app.onboarding_storage_access(name,true));
create policy onboarding_file_read on storage.objects for select to authenticated using(bucket_id='employee-onboarding' and app.onboarding_storage_access(name,false));
-- No overwrite/delete policy. A replacement has a new immutable path; removed versions stay inaccessible.

create trigger employee_onboarding_enrollment after insert or update of status,requested_at on public.profiles for each row execute function app.enroll_employee_onboarding();
insert into app.employee_onboardings(company_id,profile_id)
 select company_id,id from public.profiles where company_id='e0000000-0000-4000-8000-000000000001'
 and ((status='pending' and requested_at is not null) or (status='active' and department_id is null)) on conflict do nothing;

create function app.start_employee_onboarding_test() returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is distinct from 'd0000000-0000-4000-8000-000000000001'::uuid or not app.onboarding_manager() then raise exception '테스트 권한이 없습니다.'; end if;
 insert into app.employee_onboardings(company_id,profile_id,is_test) values('e0000000-0000-4000-8000-000000000001',auth.uid(),true)
 on conflict(company_id,profile_id,is_test) do update set is_test=true returning id into result;
 return result;
end; $$;

create function app.get_employee_onboarding(p_case uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c app.employee_onboardings; manager boolean; personal jsonb; company jsonb; roster jsonb;
begin
 if p_case is null then select * into c from app.employee_onboardings where profile_id=auth.uid() and not is_test;
 else select * into c from app.employee_onboardings where id=p_case; end if;
 if c.id is null then return null; end if;
 if not app.onboarding_access(c.id) then raise exception '신규 직원 정보를 조회할 권한이 없습니다.'; end if;
 manager:=app.onboarding_manager();
 personal:=case when c.is_test then c.personal when c.personal_draft or c.submitted_at is null then app.onboarding_personal_roster(c.profile_id)||c.personal else c.personal||app.onboarding_personal_roster(c.profile_id) end;
 company:=case when c.is_test then c.company_info when exists(select 1 from public.profiles where id=c.profile_id and status='pending') then app.onboarding_company_roster(c.profile_id)||c.company_info else c.company_info||app.onboarding_company_roster(c.profile_id) end;
 return jsonb_build_object('id',c.id,'profileId',c.profile_id,'isTest',c.is_test,'version',c.version,'submittedAt',c.submitted_at,
 'completedAt',c.completed_at,'personal',personal,'company',case when manager then company else null end,
 'rosterStamp',case when c.is_test then 'test' else app.onboarding_stamp(c.profile_id) end,
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'name',f.name,'size',f.size)) from app.employee_onboarding_files f
 where f.case_id=c.id and f.ready and f.removed_at is null and (manager or f.kind in ('identity','bank','education','residentRegister','businessCertificate'))),'[]'::jsonb));
end; $$;
create function app.list_employee_onboardings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not app.onboarding_manager() then raise exception '신규 직원 관리 권한이 없습니다.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'profileId',p.id,'isTest',c.is_test,'displayName',case when c.is_test then '개발자 · 테스트' else p.display_name end,
 'email',p.email,'status',p.status,'requestedAt',p.requested_at,'departmentId',p.department_id,'position',p.position,'jobGrade',p.job_grade,'hireDate',p.hire_date,
 'submittedAt',c.submitted_at,'companySaved',c.company_info<>'{}'::jsonb,'completedAt',c.completed_at,'version',c.version,
 'employeeFiles',(select count(*) from app.employee_onboarding_files f where f.case_id=c.id and f.ready and f.removed_at is null and f.kind in ('identity','bank','education','residentRegister','businessCertificate')),
 'signedFiles',(select count(*) from app.employee_onboarding_files f where f.case_id=c.id and f.ready and f.removed_at is null and f.kind in ('contract','privacyConsent','biometricConsent')))
 order by c.is_test desc,c.created_at desc)
 from app.employee_onboardings c join public.profiles p on p.id=c.profile_id where app.onboarding_access(c.id,true) and p.status in ('pending','active')),'[]'::jsonb);
end; $$;

create function app.onboarding_company_calculate(v jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare salary numeric; monthly numeric; weighted numeric; ot numeric; allowances numeric:=0; base numeric; k text; s int; e int; bs int; be int; start_date date; wage_date date; months int;
begin
 if v->>'periodMode'='auto' then
 start_date:=nullif(v->>'hireDate','')::date;
 wage_date:=greatest(start_date,nullif(v->>'documentDate','')::date);
 v:=v||jsonb_build_object('contractStart',coalesce(start_date::text,''),'contractEnd','','wageStart',coalesce(wage_date::text,''),'wageEnd','','probationStart','','probationEnd','');
 if v->>'contractTerm'='fixed' and coalesce(v->>'contractMonths','')~'^[0-9]+$' and start_date is not null then
 months:=(v->>'contractMonths')::int; if months not between 1 and 1200 then raise exception '계약 개월 수를 확인해 주세요.'; end if;
 v:=v||jsonb_build_object('contractEnd',((start_date+make_interval(months=>months))::date-1)::text); end if;
 if v->>'wageTerm'='fixed' and coalesce(v->>'wageMonths','')~'^[0-9]+$' and wage_date is not null then
 months:=(v->>'wageMonths')::int; if months not between 1 and 1200 then raise exception '계약 개월 수를 확인해 주세요.'; end if;
 v:=v||jsonb_build_object('wageEnd',((wage_date+make_interval(months=>months))::date-1)::text); end if;
 if v->>'probationApply'='yes' and start_date is not null and coalesce(v->>'probationMonths','')~'^[0-9]+$' then
 months:=(v->>'probationMonths')::int; if months not between 1 and 1200 then raise exception '수습 개월 수를 확인해 주세요.'; end if;
 v:=v||jsonb_build_object('probationStart',start_date::text,'probationEnd',((start_date+make_interval(months=>months))::date-1)::text); end if;
 end if;
 if v->>'wageMode' is distinct from 'excel' then return v; end if;
 foreach k in array array['monthlyWage','baseHours','basePay','overtimeHours','overtimeAllowance','nightHours','nightAllowance','holidayHours','holidayAllowance','annualLeaveHours','annualLeaveAllowance','fixedOvertimePlan'] loop v:=jsonb_set(v,array[k],'""'); end loop;
 if coalesce(v->>'annualSalary','')!~'^[0-9]+$' then return v; end if;
 salary:=(v->>'annualSalary')::numeric; if salary<=0 or salary>9007199254740991 then raise exception '연봉을 확인해 주세요.'; end if;
 monthly:=salary/12; weighted:=case when monthly<3000000 then 16.3 else 32.6 end;
 v:=v||jsonb_build_object('monthlyWage',round(monthly)::text,'fixedOvertimePlan',case when monthly<3000000 then '유형 1' else '유형 2' end);
 if regexp_replace(translate(coalesce(v->>'payBasis',''),'X×*','xxx'),'\s','','g') not in ('세전','월급x12개월') then return v; end if;
 if coalesce(v->>'workDays','')!~'^주\s*5일' then return v; end if;
 foreach k in array array['workStart','workEnd','breakStart','breakEnd'] loop if coalesce(v->>k,'')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then return v; end if; end loop;
 s:=extract(epoch from (v->>'workStart')::time)/60; e:=extract(epoch from (v->>'workEnd')::time)/60; bs:=extract(epoch from (v->>'breakStart')::time)/60; be:=extract(epoch from (v->>'breakEnd')::time)/60;
 if not(s<=bs and bs<be and be<=e and e-s-(be-bs)=480) then return v; end if;
 foreach k in array array['mealAllowance','carAllowance','researchAllowance','childcareAllowance','dutyAllowance'] loop
 if coalesce(v->>k,'')<>'' then if v->>k!~'^[0-9]+$' or (v->>k)::numeric>9007199254740991 then raise exception '수당을 확인해 주세요.'; end if; allowances:=allowances+(v->>k)::numeric; end if; end loop;
 ot:=round(monthly/(209+weighted)*weighted); base:=round(monthly)-ot-allowances;
 if base<0 then raise exception '연봉과 수당 합계를 확인해 주세요.'; end if;
 return v||jsonb_build_object('baseHours','209','basePay',base::text,'overtimeHours',weighted::text,'overtimeAllowance',ot::text,
 'nightHours','0','nightAllowance','0','holidayHours','0','holidayAllowance','0','annualLeaveHours','0','annualLeaveAllowance','0');
end; $$;

revoke all on function app.onboarding_manager(),app.onboarding_access(uuid,boolean),app.onboarding_personal_roster(uuid),app.onboarding_stamp(uuid),app.onboarding_company_roster(uuid),app.enroll_employee_onboarding(),app.onboarding_company_calculate(jsonb),app.onboarding_storage_access(text,boolean) from public,anon,authenticated;
grant execute on function app.onboarding_storage_access(text,boolean) to authenticated;


create function app.get_my_employee_onboarding_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'submittedAt',c.submitted_at,'completedAt',c.completed_at)
 from app.employee_onboardings c where c.profile_id=auth.uid() and not c.is_test and app.onboarding_access(c.id);
$$;

create function public.save_employee_onboarding(p_case uuid,p_section text,p_data jsonb,p_version bigint,p_roster_stamp text) returns jsonb language sql security invoker set search_path='' as $$ select app.save_employee_onboarding(p_case,p_section,p_data,p_version,p_roster_stamp); $$;
revoke all on function app.save_employee_onboarding(uuid,text,jsonb,bigint,text),public.save_employee_onboarding(uuid,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function app.save_employee_onboarding(uuid,text,jsonb,bigint,text),public.save_employee_onboarding(uuid,text,jsonb,bigint,text) to authenticated;

create function public.set_employee_onboarding_complete(p_case uuid,p_complete boolean,p_version bigint) returns jsonb language sql security invoker set search_path='' as $$ select app.set_employee_onboarding_complete(p_case,p_complete,p_version); $$;
revoke all on function app.set_employee_onboarding_complete(uuid,boolean,bigint),public.set_employee_onboarding_complete(uuid,boolean,bigint) from public,anon,authenticated;
grant execute on function app.set_employee_onboarding_complete(uuid,boolean,bigint),public.set_employee_onboarding_complete(uuid,boolean,bigint) to authenticated;

create function public.begin_employee_onboarding_file(p_case uuid,p_kind text,p_name text,p_mime text,p_size bigint) returns jsonb language sql security invoker set search_path='' as $$ select app.begin_employee_onboarding_file(p_case,p_kind,p_name,p_mime,p_size); $$;
revoke all on function app.begin_employee_onboarding_file(uuid,text,text,text,bigint),public.begin_employee_onboarding_file(uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function app.begin_employee_onboarding_file(uuid,text,text,text,bigint),public.begin_employee_onboarding_file(uuid,text,text,text,bigint) to authenticated;

create function public.finish_employee_onboarding_file(p_file uuid) returns jsonb language sql security invoker set search_path='' as $$ select app.finish_employee_onboarding_file(p_file); $$;
revoke all on function app.finish_employee_onboarding_file(uuid),public.finish_employee_onboarding_file(uuid) from public,anon,authenticated;
grant execute on function app.finish_employee_onboarding_file(uuid),public.finish_employee_onboarding_file(uuid) to authenticated;

create function public.remove_employee_onboarding_file(p_file uuid) returns jsonb language sql security invoker set search_path='' as $$ select app.remove_employee_onboarding_file(p_file); $$;
revoke all on function app.remove_employee_onboarding_file(uuid),public.remove_employee_onboarding_file(uuid) from public,anon,authenticated;
grant execute on function app.remove_employee_onboarding_file(uuid),public.remove_employee_onboarding_file(uuid) to authenticated;

create function public.get_employee_onboarding_file_path(p_file uuid) returns text language sql security invoker set search_path='' as $$ select app.get_employee_onboarding_file_path(p_file); $$;
revoke all on function app.get_employee_onboarding_file_path(uuid),public.get_employee_onboarding_file_path(uuid) from public,anon,authenticated;
grant execute on function app.get_employee_onboarding_file_path(uuid),public.get_employee_onboarding_file_path(uuid) to authenticated;

create function public.start_employee_onboarding_test() returns uuid language sql security invoker set search_path='' as $$ select app.start_employee_onboarding_test(); $$;
revoke all on function app.start_employee_onboarding_test(),public.start_employee_onboarding_test() from public,anon,authenticated;
grant execute on function app.start_employee_onboarding_test(),public.start_employee_onboarding_test() to authenticated;

create function public.get_employee_onboarding(p_case uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select app.get_employee_onboarding(p_case); $$;
revoke all on function app.get_employee_onboarding(uuid),public.get_employee_onboarding(uuid) from public,anon,authenticated;
grant execute on function app.get_employee_onboarding(uuid),public.get_employee_onboarding(uuid) to authenticated;

create function public.list_employee_onboardings() returns jsonb language sql security invoker set search_path='' as $$ select app.list_employee_onboardings(); $$;
revoke all on function app.list_employee_onboardings(),public.list_employee_onboardings() from public,anon,authenticated;
grant execute on function app.list_employee_onboardings(),public.list_employee_onboardings() to authenticated;

create function public.get_my_employee_onboarding_status() returns jsonb language sql security invoker set search_path='' as $$ select app.get_my_employee_onboarding_status(); $$;
revoke all on function app.get_my_employee_onboarding_status(),public.get_my_employee_onboarding_status() from public,anon,authenticated;
grant execute on function app.get_my_employee_onboarding_status(),public.get_my_employee_onboarding_status() to authenticated;

notify pgrst, 'reload schema';
