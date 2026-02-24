-- Step 3: CSV import helper (run after schema.sql)
-- 1) In Supabase Table Editor, create/upload a staging table or paste CSV into import tool.
-- 2) If your CSV header has spaces, import into staging_parts_raw first.

create table if not exists public.staging_parts_raw (
  position text,
  "item number" text,
  designation text,
  quantity text,
  "unit of quantity" text,
  "spare parts identifier" text,
  "current stock" text,
  "minimum stock" text,
  location text
);

-- Upsert from staging -> parts
insert into public.parts (
  position,
  item_number,
  designation,
  quantity,
  unit_of_quantity,
  spare_parts_identifier,
  current_stock,
  minimum_stock,
  location
)
select
  nullif(trim(position), ''),
  trim("item number"),
  trim(designation),
  coalesce(nullif(trim(quantity), '')::numeric, 0),
  nullif(trim("unit of quantity"), ''),
  nullif(trim("spare parts identifier"), ''),
  coalesce(nullif(trim("current stock"), '')::numeric, coalesce(nullif(trim(quantity), '')::numeric, 0)),
  coalesce(nullif(trim("minimum stock"), '')::numeric, 0),
  nullif(trim(location), '')
from public.staging_parts_raw
where coalesce(trim("item number"), '') <> ''
on conflict (item_number) do update
set
  position = excluded.position,
  designation = excluded.designation,
  quantity = excluded.quantity,
  unit_of_quantity = excluded.unit_of_quantity,
  spare_parts_identifier = excluded.spare_parts_identifier,
  current_stock = excluded.current_stock,
  minimum_stock = excluded.minimum_stock,
  location = excluded.location,
  updated_at = now();

-- Optional cleanup after import
-- truncate table public.staging_parts_raw;

