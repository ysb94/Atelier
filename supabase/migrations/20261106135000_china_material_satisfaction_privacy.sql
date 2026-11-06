-- Keep scores in the planning workflow only; China-facing list and detail never include them.
do $migration$
declare
  body text := pg_get_functiondef('app.read_material_requests(text,uuid,integer)'::regprocedure);
  declaration text := 'v_result jsonb;';
  before_query text := '  select coalesce(jsonb_agg(t.data order by t.updated_at desc,t.id)';
  projection text := 'app.material_round_json(r,p_id is not null)';
  role_check text := $guard$
  if v_role='planning' and not exists (
    select 1 from public.profiles p where p.id=v_uid and p.company_id=v_company
      and p.department_id=app.work_department('china')
  ) then
    v_hidden_round_fields:=array[]::text[];
  end if;
$guard$;
begin
  if strpos(body,declaration)=0 or strpos(body,before_query)=0 or strpos(body,projection)=0
    or strpos(body,'v_hidden_round_fields')>0 then
    raise exception 'Material request read definition changed; review before applying';
  end if;
  body:=replace(body,declaration,declaration||chr(10)||$field$  v_hidden_round_fields text[] := array['satisfaction'];$field$);
  body:=replace(body,before_query,role_check||before_query);
  execute replace(body,projection,'('||projection||' - v_hidden_round_fields)');
end $migration$;
