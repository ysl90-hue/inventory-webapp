-- Use this only when a legacy `public.parts` table already exists
-- (for example, created by CSV import with headers like "item number").
-- Run this BEFORE re-running schema.sql.

begin;

-- 1) Rename legacy columns (space headers) -> snake_case
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'item number'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'item_number'
  ) then
    execute 'alter table public.parts rename column "item number" to item_number';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'unit of quantity'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'unit_of_quantity'
  ) then
    execute 'alter table public.parts rename column "unit of quantity" to unit_of_quantity';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'spare parts identifier'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'spare_parts_identifier'
  ) then
    execute 'alter table public.parts rename column "spare parts identifier" to spare_parts_identifier';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'current stock'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'current_stock'
  ) then
    execute 'alter table public.parts rename column "current stock" to current_stock';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'minimum stock'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parts' and column_name = 'minimum_stock'
  ) then
    execute 'alter table public.parts rename column "minimum stock" to minimum_stock';
  end if;
end $$;

-- 2) Add missing columns required by the app schema
alter table public.parts add column if not exists id uuid default gen_random_uuid();
alter table public.parts add column if not exists position text;
alter table public.parts add column if not exists item_number text;
alter table public.parts add column if not exists designation text;
alter table public.parts add column if not exists quantity numeric(12,2) default 0;
alter table public.parts add column if not exists unit_of_quantity text;
alter table public.parts add column if not exists spare_parts_identifier text;
alter table public.parts add column if not exists current_stock numeric(12,2) default 0;
alter table public.parts add column if not exists minimum_stock numeric(12,2) default 0;
alter table public.parts add column if not exists location text;
alter table public.parts add column if not exists created_at timestamptz default now();
alter table public.parts add column if not exists updated_at timestamptz default now();

-- 3) Fill required values if null/empty
update public.parts
set
  item_number = coalesce(nullif(trim(item_number), ''), 'MIGRATED-' || left(md5(random()::text), 8))
where item_number is null or trim(item_number) = '';

update public.parts
set designation = coalesce(nullif(trim(designation), ''), item_number)
where designation is null or trim(designation) = '';

update public.parts
set quantity = coalesce(quantity, 0)
where quantity is null;

update public.parts
set current_stock = coalesce(current_stock, quantity, 0)
where current_stock is null;

update public.parts
set minimum_stock = coalesce(minimum_stock, 0)
where minimum_stock is null;

update public.parts
set created_at = coalesce(created_at, now())
where created_at is null;

update public.parts
set updated_at = coalesce(updated_at, now())
where updated_at is null;

-- 4) Convert text columns to expected numeric types if needed
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='parts'
      and column_name='quantity' and data_type in ('text', 'character varying')
  ) then
    execute $sql$
      alter table public.parts
      alter column quantity type numeric(12,2)
      using coalesce(nullif(trim(quantity::text), '')::numeric, 0)
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='parts'
      and column_name='current_stock' and data_type in ('text', 'character varying')
  ) then
    execute $sql$
      alter table public.parts
      alter column current_stock type numeric(12,2)
      using coalesce(nullif(trim(current_stock::text), '')::numeric, 0)
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='parts'
      and column_name='minimum_stock' and data_type in ('text', 'character varying')
  ) then
    execute $sql$
      alter table public.parts
      alter column minimum_stock type numeric(12,2)
      using coalesce(nullif(trim(minimum_stock::text), '')::numeric, 0)
    $sql$;
  end if;
end $$;

-- 5) Ensure PK/constraints/index prerequisites
alter table public.parts
  alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.parts'::regclass
      and contype = 'p'
  ) then
    execute 'alter table public.parts add constraint parts_pkey primary key (id)';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.parts'::regclass
      and conname = 'parts_item_number_key'
  ) then
    execute 'alter table public.parts add constraint parts_item_number_key unique (item_number)';
  end if;
end $$;

commit;

-- Next step:
-- 1) Run /supabase/schema.sql again (it will create missing indexes/functions/policies)
-- 2) If schema.sql fails on stock_transactions because of a partially created table, share the error text.

