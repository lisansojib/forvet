-- Run after mock_supabase.sql + supabase/forvet_schema.sql, as a superuser.
-- Users: 1111 = admin, 2222 = viewer (forvet_viewers), 3333 = signed in but NOT a member.
-- Every check prints "ok"; anything else is a failure.
\set ON_ERROR_STOP 1
insert into public.forvet_admins (user_id) values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;
insert into public.forvet_viewers (user_id) values ('22222222-2222-2222-2222-222222222222') on conflict do nothing;
create or replace function pg_temp.check(ok boolean, label text) returns text language sql as $$ select case when ok then 'ok   ' else 'FAIL ' end || label $$;

\echo '--- ADMIN: insert + update (version bump, revision kept)'
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into forvet_formulations(id,data) values ('f1','{"name":"A"}');
update forvet_formulations set data='{"name":"B"}' where id='f1' and version=1;
select pg_temp.check((select version from forvet_formulations where id='f1') = 2, 'admin update bumps version');
select pg_temp.check((select count(*) from forvet_revisions) = 1, 'admin sees revision');
select pg_temp.check(public.is_forvet_admin() and public.is_forvet_member(), 'admin flags');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
with u as (update forvet_formulations set data='{"name":"STALE"}' where id='f1' and version=1 returning 1)
select pg_temp.check((select count(*) from u) = 0, 'stale-version update affects 0 rows');
commit;

\echo '--- ANON (publishable key, not signed in): reads nothing'
begin; set local role anon;
\set ON_ERROR_STOP 0
select count(*) as anon_read_should_error from forvet_formulations;
\set ON_ERROR_STOP 1
rollback;
begin; set local role anon;
select pg_temp.check(not has_table_privilege('anon','public.forvet_formulations','select'), 'anon has no select grant');
select pg_temp.check(not has_table_privilege('anon','public.forvet_ingredients','select'), 'anon no select on ingredients');
select pg_temp.check(not has_table_privilege('anon','public.forvet_settings','select'), 'anon no select on settings');
rollback;

\echo '--- VIEWER: read ok, writes blocked'
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check((select count(*) from forvet_formulations) = 1, 'viewer can read');
select pg_temp.check(public.is_forvet_member() and not public.is_forvet_admin(), 'viewer flags');
with u as (update forvet_formulations set data='{}' returning 1) select pg_temp.check((select count(*) from u) = 0, 'viewer update blocked');
with d as (delete from forvet_formulations returning 1) select pg_temp.check((select count(*) from d) = 0, 'viewer delete blocked');
select pg_temp.check((select count(*) from forvet_revisions) = 0, 'viewer sees no revisions');
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\set ON_ERROR_STOP 0
insert into forvet_formulations(id,data) values ('y','{}');
\set ON_ERROR_STOP 1
rollback;

\echo '--- STRANGER (signed in, not a member): reads nothing, writes blocked'
begin; set local role authenticated; set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.check((select count(*) from forvet_formulations) = 0, 'stranger reads 0 formulations');
select pg_temp.check((select count(*) from forvet_ingredients) = 0 and (select count(*) from forvet_settings) = 0, 'stranger reads 0 materials/settings');
select pg_temp.check(not public.is_forvet_member(), 'stranger is not member');
with u as (update forvet_formulations set data='{}' returning 1) select pg_temp.check((select count(*) from u) = 0, 'stranger update blocked');
select pg_temp.check((select count(*) from forvet_viewers) = 0 and (select count(*) from forvet_admins) = 0, 'stranger sees no membership rows');
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\set ON_ERROR_STOP 0
insert into forvet_viewers(user_id) values ('33333333-3333-3333-3333-333333333333');
insert into forvet_admins(user_id) values ('33333333-3333-3333-3333-333333333333');
\set ON_ERROR_STOP 1
rollback;
select pg_temp.check(not exists (select 1 from forvet_viewers where user_id='33333333-3333-3333-3333-333333333333')
                 and not exists (select 1 from forvet_admins where user_id='33333333-3333-3333-3333-333333333333'), 'stranger cannot self-enrol');

\echo '--- ADMIN cannot forge version'
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update forvet_formulations set version=500, data='{"name":"C"}' where id='f1';
select pg_temp.check((select version from forvet_formulations where id='f1') = 3, 'version is server-owned');
rollback;
select pg_temp.check(not exists (select 1 from pg_policies where policyname = 'public read'), 'old public-read policies removed');
