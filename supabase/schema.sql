-- Supabase inventory app schema
-- Run in Supabase SQL Editor (step 1)

create extension if not exists pgcrypto;

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  position text,
  item_number text not null unique,
  designation text not null,
  quantity numeric(12, 2) not null default 0,
  unit_of_quantity text,
  spare_parts_identifier text,
  current_stock numeric(12, 2) not null default 0,
  minimum_stock numeric(12, 2) not null default 0,
  location text,
  is_b_grade boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.parts add column if not exists is_b_grade boolean not null default false;

create index if not exists idx_parts_item_number on public.parts(item_number);
create index if not exists idx_parts_designation on public.parts(designation);
create index if not exists idx_parts_low_stock on public.parts(current_stock, minimum_stock);

create table if not exists public.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  tx_type text not null check (tx_type in ('IN', 'OUT', 'ADJUST')),
  qty numeric(12, 2) not null check (qty > 0),
  memo text,
  is_b_grade boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.stock_transactions add column if not exists is_b_grade boolean not null default false;

create table if not exists public.part_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_part_categories_name on public.part_categories(name);

create table if not exists public.part_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_part_locations_code on public.part_locations(code);

create index if not exists idx_stock_transactions_part_id_created_at
  on public.stock_transactions(part_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_parts_updated_at on public.parts;
create trigger trg_parts_updated_at
before update on public.parts
for each row
execute function public.set_updated_at();

drop function if exists public.apply_stock_transaction(text, text, numeric, text);
drop function if exists public.apply_stock_transaction(text, text, numeric, text, boolean);

-- Atomic stock update + transaction log
create or replace function public.apply_stock_transaction(
  p_item_number text,
  p_tx_type text,
  p_qty numeric,
  p_memo text default null,
  p_created_at timestamptz default null,
  p_is_b_grade boolean default false
)
returns public.parts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.parts;
  v_new_stock numeric;
begin
  if p_tx_type not in ('IN', 'OUT', 'ADJUST') then
    raise exception 'Invalid tx_type: %', p_tx_type;
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be > 0';
  end if;

  select * into v_part
  from public.parts
  where item_number = p_item_number
  for update;

  if not found then
    raise exception 'Part not found: %', p_item_number;
  end if;

  if p_tx_type = 'IN' then
    v_new_stock := v_part.current_stock + p_qty;
  elsif p_tx_type = 'OUT' then
    v_new_stock := v_part.current_stock - p_qty;
    if v_new_stock < 0 then
      raise exception 'Insufficient stock for % (current %, requested %)',
        p_item_number, v_part.current_stock, p_qty;
    end if;
  else
    -- ADJUST means set current_stock directly to p_qty
    v_new_stock := p_qty;
  end if;

  update public.parts
  set current_stock = v_new_stock
  where id = v_part.id
  returning * into v_part;

  insert into public.stock_transactions (
    part_id, tx_type, qty, memo, is_b_grade, created_by, created_at
  ) values (
    v_part.id,
    p_tx_type,
    case when p_tx_type = 'ADJUST' then abs(v_new_stock) else p_qty end,
    p_memo,
    coalesce(p_is_b_grade, false),
    auth.uid(),
    coalesce(p_created_at, now())
  );

  return v_part;
end;
$$;

alter table public.parts enable row level security;
alter table public.stock_transactions enable row level security;
alter table public.part_categories enable row level security;
alter table public.part_locations enable row level security;

-- Basic policies (adjust to your auth strategy)
drop policy if exists "parts read" on public.parts;
create policy "parts read"
on public.parts for select
to anon, authenticated
using (true);

drop policy if exists "parts write" on public.parts;
create policy "parts write"
on public.parts for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "stock tx read" on public.stock_transactions;
create policy "stock tx read"
on public.stock_transactions for select
to anon, authenticated
using (true);

drop policy if exists "stock tx insert" on public.stock_transactions;
create policy "stock tx insert"
on public.stock_transactions for insert
to anon, authenticated
with check (true);

grant execute on function public.apply_stock_transaction(text, text, numeric, text, timestamptz, boolean)
to anon, authenticated;

drop policy if exists "part categories read" on public.part_categories;
create policy "part categories read"
on public.part_categories for select
to anon, authenticated
using (true);

drop policy if exists "part locations read" on public.part_locations;
create policy "part locations read"
on public.part_locations for select
to anon, authenticated
using (true);
