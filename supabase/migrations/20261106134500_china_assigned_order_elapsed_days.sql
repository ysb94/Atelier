-- Expose the existing round start date to the already-scoped worker list.
do $migration$
declare
  body text := pg_get_functiondef('app.get_my_china_work_orders()'::regprocedure);
  anchor text := $anchor$'fileName',r.item->>'name','closed',r.closed,$anchor$;
  field text := $field$'shippedAt',coalesce(nullif(btrim(r.item->>'shippedAt'),''),
       case when r.kind='color' then nullif(btrim(d.specs->>'colorSampleRequestedAt'),'') end),$field$;
begin
  if strpos(body,anchor)=0 or strpos(body,$anchor$'shippedAt',$anchor$)>0
     or strpos(body,$scope$d.specs->'chinaWorkAssignment'->>'assigneeId'=auth.uid()::text$scope$)=0 then
    raise exception 'Assigned work order list definition changed; review before applying';
  end if;
  execute replace(body,anchor,anchor||chr(10)||'     '||field);
end $migration$;
