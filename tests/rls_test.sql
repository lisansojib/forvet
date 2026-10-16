\set ON_ERROR_STOP 0
\echo '--- ADMIN: insert + update (version bump, revision kept)'
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into forvet_formulations(id,data) values ('f1','{"name":"A"}');
update forvet_formulations set data='{"name":"B"}' where id='f1' and version=1;
select id, version, data->>'name' as name, updated_by is not null as has_by from forvet_formulations;
select count(*) as revisions_visible_to_admin from forvet_revisions;
select public.is_forvet_admin() as admin_flag;
commit;
\echo '--- ADMIN: stale-version update must affect 0 rows'
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
with u as (update forvet_formulations set data='{"name":"STALE"}' where id='f1' and version=1 returning 1) select count(*) as stale_rows_updated from u;
commit;
\echo '--- ANON: read ok, writes blocked'
begin; set local role anon;
select count(*) as anon_can_read from forvet_formulations;
insert into forvet_formulations(id,data) values ('x','{}');
rollback;
begin; set local role anon;
with u as (update forvet_formulations set data='{}' returning 1) select count(*) as anon_rows_updated from u;
select count(*) as anon_revisions from forvet_revisions;
rollback;
begin; set local role anon; select * from forvet_admins; rollback;
\echo '--- VIEWER (signed in, not admin): read ok, writes blocked'
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as viewer_can_read from forvet_formulations;
select public.is_forvet_admin() as viewer_admin_flag;
insert into forvet_formulations(id,data) values ('y','{}');
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
with u as (update forvet_formulations set data='{}' returning 1) select count(*) as viewer_rows_updated from u;
with d as (delete from forvet_formulations returning 1) select count(*) as viewer_rows_deleted from d;
select count(*) as viewer_revisions from forvet_revisions;
insert into forvet_admins(user_id) values ('22222222-2222-2222-2222-222222222222');
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update forvet_settings set version = 99; select 'viewer settings update attempted' as note;
rollback;
\echo '--- ADMIN cannot forge version'
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update forvet_formulations set version=500, data='{"name":"C"}' where id='f1'; select version from forvet_formulations where id='f1';
rollback;
