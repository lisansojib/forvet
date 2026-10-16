-- =====================================================================
-- Forvet — Supabase schema (v6)
-- Run once in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run: every statement is idempotent.
--
-- Security model
--   * Anyone (anon key, not signed in) can READ formulations, materials
--     and settings. This is the "public view" the owner asked for.
--   * Only users listed in public.forvet_admins can INSERT/UPDATE/DELETE.
--     There is no client-side path to become an admin.
--   * Every update/delete keeps the previous row in forvet_revisions
--     (admin-readable) so accidental changes can be recovered.
--   * version is incremented by the database; the app uses it for
--     optimistic-concurrency (two devices cannot silently overwrite).
-- =====================================================================

-- ---------- Admin registry ----------
create table if not exists public.forvet_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

create or replace function public.is_forvet_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.forvet_admins a where a.user_id = auth.uid());
$$;

-- ---------- Entity tables (one jsonb document per record) ----------
create table if not exists public.forvet_ingredients (
  id         text primary key check (char_length(id) between 1 and 120),
  data       jsonb not null,
  deleted    boolean not null default false,
  version    bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.forvet_formulations (
  id         text primary key check (char_length(id) between 1 and 120),
  data       jsonb not null,
  deleted    boolean not null default false,
  version    bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.forvet_settings (
  id         text primary key check (char_length(id) between 1 and 120),
  data       jsonb not null,
  deleted    boolean not null default false,
  version    bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.forvet_revisions (
  id         bigserial primary key,
  entity     text not null,
  entity_id  text not null,
  version    bigint,
  data       jsonb,
  deleted    boolean,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index if not exists forvet_revisions_entity_idx
  on public.forvet_revisions (entity, entity_id, changed_at desc);

-- ---------- Triggers: server-owned version / timestamps / audit ----------
create or replace function public.forvet_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function public.forvet_keep_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.forvet_revisions (entity, entity_id, version, data, deleted, changed_by)
  values (tg_table_name, old.id, old.version, old.data, old.deleted, auth.uid());
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['forvet_ingredients','forvet_formulations','forvet_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_bw', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.forvet_before_write()', t || '_bw', t);
    execute format('drop trigger if exists %I on public.%I', t || '_rev', t);
    execute format('create trigger %I after update or delete on public.%I for each row execute function public.forvet_keep_revision()', t || '_rev', t);
  end loop;
end $$;

-- ---------- Row Level Security ----------
alter table public.forvet_admins       enable row level security;
alter table public.forvet_ingredients  enable row level security;
alter table public.forvet_formulations enable row level security;
alter table public.forvet_settings     enable row level security;
alter table public.forvet_revisions    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['forvet_ingredients','forvet_formulations','forvet_settings'] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('drop policy if exists "admin insert" on public.%I', t);
    execute format('create policy "admin insert" on public.%I for insert to authenticated with check (public.is_forvet_admin())', t);
    execute format('drop policy if exists "admin update" on public.%I', t);
    execute format('create policy "admin update" on public.%I for update to authenticated using (public.is_forvet_admin()) with check (public.is_forvet_admin())', t);
    execute format('drop policy if exists "admin delete" on public.%I', t);
    execute format('create policy "admin delete" on public.%I for delete to authenticated using (public.is_forvet_admin())', t);
  end loop;
end $$;

drop policy if exists "read own admin row" on public.forvet_admins;
create policy "read own admin row" on public.forvet_admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "admins read revisions" on public.forvet_revisions;
create policy "admins read revisions" on public.forvet_revisions
  for select to authenticated using (public.is_forvet_admin());

-- ---------- Grants (RLS still applies on top of these) ----------
revoke all on public.forvet_admins    from anon, authenticated;
revoke all on public.forvet_revisions from anon, authenticated;
grant select on public.forvet_admins    to authenticated;
grant select on public.forvet_revisions to authenticated;

grant select on public.forvet_ingredients, public.forvet_formulations, public.forvet_settings to anon, authenticated;
grant insert, update, delete on public.forvet_ingredients, public.forvet_formulations, public.forvet_settings to authenticated;

revoke all on function public.is_forvet_admin() from public;
grant execute on function public.is_forvet_admin() to anon, authenticated;

-- =====================================================================
-- AFTER RUNNING: make yourself an administrator
--   1. Authentication → Users → Add user (email + password, auto-confirm).
--   2. Run (replace the email):
--
--   insert into public.forvet_admins (user_id, note)
--   select id, 'owner' from auth.users where email = 'you@example.com'
--   on conflict do nothing;
--
-- To remove an admin:
--   delete from public.forvet_admins
--   where user_id = (select id from auth.users where email = 'person@example.com');
-- =====================================================================
