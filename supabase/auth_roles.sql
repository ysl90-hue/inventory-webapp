-- Supabase Auth + profiles(role) setup
-- Run after /supabase/schema.sql

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('user', 'admin');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists display_name text;

create index if not exists idx_profiles_role on public.profiles(role);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    'user'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

drop policy if exists "profiles read self or admin" on public.profiles;
drop policy if exists "profiles read all authenticated" on public.profiles;
create policy "profiles read all authenticated"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (true);

-- Make parts CRUD admin-only (read stays public from schema.sql)
drop policy if exists "parts write" on public.parts;
drop policy if exists "parts write admin only" on public.parts;
create policy "parts write admin only"
on public.parts for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "part categories write" on public.part_categories;
create policy "part categories write"
on public.part_categories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "part locations write" on public.part_locations;
create policy "part locations write"
on public.part_locations for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "location images public read" on storage.objects;
create policy "location images public read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'part-location-images');

drop policy if exists "location images admin insert" on storage.objects;
create policy "location images admin insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'part-location-images' and public.is_admin());

drop policy if exists "location images admin update" on storage.objects;
create policy "location images admin update"
on storage.objects for update
to authenticated
using (bucket_id = 'part-location-images' and public.is_admin())
with check (bucket_id = 'part-location-images' and public.is_admin());

drop policy if exists "location images admin delete" on storage.objects;
create policy "location images admin delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'part-location-images' and public.is_admin());

drop policy if exists "stock tx update admin only" on public.stock_transactions;
drop policy if exists "stock tx update authenticated" on public.stock_transactions;
create policy "stock tx update authenticated"
on public.stock_transactions for update
to authenticated
using (true)
with check (true);

drop policy if exists "stock tx delete admin only" on public.stock_transactions;
create policy "stock tx delete admin only"
on public.stock_transactions for delete
to authenticated
using (public.is_admin());

insert into public.profiles (id, email, display_name, role)
select u.id, u.email, split_part(coalesce(u.email, ''), '@', 1), 'user'::public.app_role
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Promote an admin after sign-up:
-- update public.profiles set role = 'admin' where email = 'you@example.com';
