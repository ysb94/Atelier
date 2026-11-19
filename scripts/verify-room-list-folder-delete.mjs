import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0')
const brand = id(1), otherBrand = id(2), owner = id(3), colleague = id(4)
const folder = id(5), otherFolder = id(6), crossBrandFolder = id(7)
const migrations = [
  '20261111054232_warehouse_room_list_folders.sql',
  '20261111082704_warehouse_room_list_folder_edit.sql',
  '20261119083748_warehouse_room_list_folder_delete.sql',
]
const setActor = actor => db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
const remove = (target, targetBrand, creator, revision) => db.query(
  'delete from public.warehouse_room_list_folders where id=$1 and brand_id=$2 and created_by=$3 and revision=$4 returning id',
  [target, targetBrand, creator, revision],
)

try {
  await db.exec(`
    create schema app; create schema auth;
    create role authenticated; create role anon;
    grant usage on schema app,auth to authenticated;
    create table public.brands(id uuid primary key);
    create table public.profiles(id uuid primary key,display_name text,status text);
    grant select on public.profiles to authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function app.can_read_brand(uuid) returns boolean language sql stable as $$ select true $$;
    create function app.basic_work_allowed(text,uuid) returns boolean language sql stable as $$
      select $1='logistics' and $2::text=current_setting('fixture.brand',true)
    $$;
    insert into public.brands values ('${brand}'),('${otherBrand}');
    insert into public.profiles values ('${owner}','등록자','active'),('${colleague}','동료','active');
    select set_config('fixture.brand','${brand}',false);
  `)
  for (const file of migrations) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'))
  }
  await db.query(`insert into public.warehouse_room_list_folders(id,brand_id,title,items,created_by) values
    ($1,$2,'삭제 대상','[["상품","3"]]'::jsonb,$3),
    ($4,$2,'다른 직원 폴더','[["상품","5"]]'::jsonb,$5),
    ($6,$7,'다른 브랜드 폴더','[["상품","7"]]'::jsonb,$3)`,
  [folder, brand, owner, otherFolder, colleague, crossBrandFolder, otherBrand])
  await db.exec('set role anon')
  await assert.rejects(remove(folder, brand, owner, 0), { code: '42501' })
  await db.exec('reset role; set role authenticated')
  await setActor(colleague)
  assert.deepEqual((await remove(folder, brand, owner, 0)).rows, [])

  await setActor(owner)
  assert.deepEqual((await remove(crossBrandFolder, otherBrand, owner, 0)).rows, [])
  await db.query("update public.warehouse_room_list_folders set title='동시 수정' where id=$1", [folder])
  assert.deepEqual((await remove(folder, brand, owner, 0)).rows, [])
  assert.deepEqual((await remove(folder, brand, owner, 1)).rows, [{ id: folder }])
  assert.deepEqual((await remove(folder, brand, owner, 1)).rows, [])
  await db.exec('reset role')
  assert.deepEqual((await db.query('select id from public.warehouse_room_list_folders order by id')).rows,
    [{ id: otherFolder }, { id: crossBrandFolder }])
  console.log('Room list deletion verified for ownership, brand access, stale edits and repeated requests.')
} finally {
  await db.close()
}
