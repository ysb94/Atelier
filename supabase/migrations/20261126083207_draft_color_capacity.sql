-- Keep both deployed color save paths aligned while preserving their current checks and grants.
do $migration$
declare
  v_function regprocedure;
  v_definition text;
  v_guard constant text := 'if jsonb_array_length(p_colors) > 9 then';
  v_message constant text := '최대 9컬러까지 추가할 수 있습니다.';
begin
  foreach v_function in array array[
    'public.save_draft_colors(uuid,timestamptz,jsonb)'::regprocedure,
    'public.save_draft_colors_with_names(uuid,timestamptz,jsonb)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    if length(v_definition) - length(replace(v_definition, v_guard, '')) <> length(v_guard)
      or length(v_definition) - length(replace(v_definition, v_message, '')) <> length(v_message) then
      raise exception 'Draft color limit definition changed in %; review before applying.', v_function;
    end if;
    execute replace(
      replace(v_definition, v_guard, 'if jsonb_array_length(p_colors) > 100 then'),
      v_message, '최대 100컬러까지 추가할 수 있습니다.'
    );
  end loop;
end
$migration$;
