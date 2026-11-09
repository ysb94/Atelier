-- Share scores in an owned notice detail while keeping the China department exclusion.
do $migration$
declare
  definition text := pg_get_functiondef('app.material_nudge_workspace(text,uuid,integer)'::regprocedure);
  projection text := $before$-'satisfaction' order by r.round_no$before$;
  recipient_projection text := $after$ - case
          when p_scope='notice' and exists (
            select from public.profiles recipient
            where recipient.id=v_actor and recipient.company_id=v_company
              and recipient.status='active'
              and recipient.department_id is distinct from app.work_department('china')
          ) then array[]::text[]
          else array['satisfaction']
        end order by r.round_no$after$;
begin
  if length(definition) - length(replace(definition,projection,'')) <> length(projection) then
    raise exception 'Material nudge detail definition changed; review before applying';
  end if;
  execute replace(definition,projection,recipient_projection);
end $migration$;
