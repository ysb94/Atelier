-- Applied to the shared database on 2026-11-10 with user authorization.
-- Preserve both existing function bodies and permissions. Only disambiguate
-- the table aliases added by the workforce-management boundary migration.
do $fix$
declare
  item record;
  target regprocedure;
  body text;
  definition text;
  replacement text;
  metadata_before jsonb;
  metadata_after jsonb;
begin
  for item in select * from (values
    ('app.advance_attendance_presence(uuid,timestamp with time zone)',
     'from public.attendance_clock_ins c where c.id=p_clock_id and app.workforce_mode(c.employee_id)',
     'from public.attendance_clock_ins presence_scope_clock where presence_scope_clock.id=p_clock_id and app.workforce_mode(presence_scope_clock.employee_id)'),
    ('app.dispatch_extra_leave_grant_notice(uuid)',
     'from app.employee_extra_leave g where g.id=p_grant and app.workforce_mode(g.employee_id)',
     'from app.employee_extra_leave notice_scope_grant where notice_scope_grant.id=p_grant and app.workforce_mode(notice_scope_grant.employee_id)')
  ) fixes(signature, old_text, new_text) loop
    target := to_regprocedure(item.signature);
    if target is null then raise exception 'Required function missing: %', item.signature; end if;
    select p.prosrc, pg_get_functiondef(p.oid), to_jsonb(p) - 'prosrc'
      into body, definition, metadata_before from pg_proc p where p.oid=target;
    if position(item.old_text in body)=0 then
      if position(item.new_text in body)>0 then continue; end if;
      raise exception 'Expected workforce guard missing: %', item.signature;
    end if;
    if (length(body)-length(replace(body,item.old_text,'')))/length(item.old_text)<>1 then
      raise exception 'Expected exactly one workforce guard: %', item.signature;
    end if;
    replacement := replace(body,item.old_text,item.new_text);
    execute replace(definition,body,replacement);
    select to_jsonb(p) - 'prosrc' into metadata_after from pg_proc p where p.oid=target;
    if metadata_before is distinct from metadata_after then
      raise exception 'Function metadata changed unexpectedly: %', item.signature;
    end if;
  end loop;
end $fix$;
