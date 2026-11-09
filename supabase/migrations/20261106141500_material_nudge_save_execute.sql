-- The public invoker wrapper needs permission to call the internal function.
-- The internal function enforces the existing planning and company checks.
grant execute on function app.save_material_nudge_recipients(uuid[]) to authenticated;
