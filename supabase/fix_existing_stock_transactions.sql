-- Fix legacy stock_transactions table type mismatch (part_id bigint -> uuid)
-- Run this before re-running schema.sql if you see:
-- "foreign key ... cannot be implemented ... incompatible types: uuid and bigint"

begin;

-- If a legacy table exists, back it up (optional) and recreate cleanly.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'stock_transactions'
  ) then
    -- Keep old data temporarily in a backup table if not already created.
    if not exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'stock_transactions_legacy_backup'
    ) then
      execute 'create table public.stock_transactions_legacy_backup as table public.stock_transactions';
    end if;

    execute 'drop table public.stock_transactions cascade';
  end if;
end $$;

commit;

-- Next:
-- 1) Run /supabase/schema.sql again
-- 2) (Optional) If you need legacy history migration, share the columns of stock_transactions_legacy_backup

