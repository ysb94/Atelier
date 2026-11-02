-- No historical rows, global permissions, tables or policies are changed.
create function app.cancel_work_request(p_id uuid,p_revision bigint,p_command uuid,p_action text default 'request') returns bigint
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare r public.work_requests%rowtype; me public.profiles%rowtype; event jsonb; outcome text; message text;
begin
 select * into r from public.work_requests where id=p_id for update;
 if not found or not app.work_request_read(p_id) then raise exception '요청 조회 권한이 없습니다.' using errcode='42501'; end if;
 select * into me from public.profiles where id=auth.uid() and status='active' and company_id=r.company_id;
 if not found then raise exception '직원 세션을 확인해 주세요.' using errcode='42501'; end if;
 if p_action='request' then
  if r.requester_id<>me.id then raise exception '본인 요청만 취소할 수 있습니다.' using errcode='42501'; end if;
 elsif p_action in ('approve','reject') then
  if not app.work_manage_allowed(r.owner) then raise exception '해당 부서 업무 관리 담당자만 취소 요청을 처리할 수 있습니다.' using errcode='42501'; end if;
 else raise exception '취소 처리 방식을 확인하세요.' using errcode='22023'; end if;
 if p_command is null then raise exception '요청 식별자를 확인하세요.' using errcode='22023'; end if;
 if exists(select 1 from public.work_request_commands where actor_id=me.id and command_id=p_command and request_id=p_id) then return r.revision; end if;
 if r.revision is distinct from p_revision then raise exception '업무 상태가 바뀌었습니다. 다시 조회하세요.' using errcode='40001'; end if;
 if r.status in ('draft','completed','cancelled','rejected') or coalesce((r.data->>'deleted')::boolean,false) then raise exception '취소 처리할 수 없는 업무입니다.' using errcode='40001'; end if;
 if p_action='request' then
  if r.data->'cancellation'->>'state'='requested' then return r.revision; end if;
  outcome:=case when r.status in ('requested','reviewing') or r.kind='internal' then 'cancelled' else 'requested' end;
  event:=jsonb_build_object('state',outcome,'requestedBy',me.id,'requestedName',me.display_name,'requestedAt',clock_timestamp());
  message:=case when outcome='cancelled' then '요청자가 작업 요청을 취소했습니다.' else '요청자가 작업 취소를 요청했습니다. 업무 관리 담당자가 취소 요청을 확인해 주세요.' end;
 else
  if r.data->'cancellation'->>'state' is distinct from 'requested' then raise exception '처리 대기 중인 취소 요청이 없습니다.' using errcode='40001'; end if;
  outcome:=case when p_action='approve' then 'approved' else 'rejected' end;
  event:=r.data->'cancellation'||jsonb_build_object('state',outcome,'resolvedBy',me.id,'resolvedName',me.display_name,'resolvedAt',clock_timestamp());
  message:=case when p_action='approve' then '업무 관리 담당자가 취소 요청을 수락했습니다.' else '업무 관리 담당자가 취소 요청을 반려했습니다. 기존 업무를 계속 진행합니다.' end;
 end if;
 if outcome in ('cancelled','approved') then
  update public.work_request_time_entries set accumulated_ms=accumulated_ms+greatest(0,(extract(epoch from(clock_timestamp()-mounted_at))*1000)::bigint),mounted_at=null where request_id=p_id and mounted_at is not null;
 end if;
 update public.work_requests set status=case when outcome in ('cancelled','approved') then 'cancelled' else status end,
  data=data||jsonb_build_object('cancellation',event,'cancellationHistory',coalesce(data->'cancellationHistory','[]'::jsonb)||jsonb_build_array(event)),revision=revision+1,updated_at=clock_timestamp()
 where id=p_id returning revision into p_revision;
 insert into public.work_request_commands(actor_id,command_id,request_id) values(me.id,p_command,p_id);
 perform app.send_work_request_message(p_id,'requester',message,gen_random_uuid());
 return p_revision;
end $$;
create function public.cancel_work_request(p_id uuid,p_revision bigint,p_command uuid,p_action text default 'request') returns bigint
language sql security invoker set search_path='' as $$ select app.cancel_work_request(p_id,p_revision,p_command,p_action) $$;
revoke all on function app.cancel_work_request(uuid,bigint,uuid,text),public.cancel_work_request(uuid,bigint,uuid,text) from public,anon;
grant execute on function app.cancel_work_request(uuid,bigint,uuid,text),public.cancel_work_request(uuid,bigint,uuid,text) to authenticated;

do $patch$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('app.save_work_request(uuid,bigint,jsonb,uuid)'::regprocedure);
 needle:='(own and next_status=''cancelled'' and r.status<>''draft'')';
 if position(needle in definition)=0 then raise exception '작업 저장 함수 정의가 변경되었습니다.'; end if;
 execute replace(definition,needle,'(own and next_status=''cancelled'' and (r.status in (''requested'',''reviewing'') or (r.kind=''internal'' and r.status<>''draft'')))');
 definition:=pg_get_functiondef('app.list_department_work(text)'::regprocedure);
 needle:='''kind'',r.kind,';
 if position(needle in definition)=0 then raise exception '부서 목록 함수 정의가 변경되었습니다.'; end if;
 execute replace(definition,needle,'''kind'',r.kind,''cancellation'',r.data->''cancellation'',');
end $patch$;
notify pgrst,'reload schema';
