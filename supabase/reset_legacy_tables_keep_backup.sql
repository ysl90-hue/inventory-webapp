-- Reset legacy tables that were created from CSV import with incompatible schema.
-- This is the fastest fix for UUID/bigint FK conflicts during initial setup.
--
-- What it does:
-- - Backs up existing `parts` / `stock_transactions` tables (once)
-- - Drops current tables
-- - Lets you re-run `schema.sql` cleanly
-- - Then you can re-import CSV using import_parts_from_csv.sql

begin;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'parts'
  ) then
    if not exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = 'parts_legacy_backup'
    ) then
      execute 'create table public.parts_legacy_backup as table public.parts';
    end if;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'stock_transactions'
  ) then
    if not exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = 'stock_transactions_legacy_backup'
    ) then
      execute 'create table public.stock_transactions_legacy_backup as table public.stock_transactions';
    end if;
  end if;
end $$;

drop table if exists public.stock_transactions cascade;
drop table if exists public.parts cascade;

commit;

-- Next step:
-- 1) Run /supabase/schema.sql
-- 2) Upload/import CSV again using /supabase/import_parts_from_csv.sql

