-- FinTracker cloud schema — initial.
--
-- Design notes that matter for correctness:
--
-- * Entity ids are TEXT, not UUID. The local ledger already mints two shapes:
--   crypto.randomUUID() for normal rows and a DETERMINISTIC
--   `recurring:<ruleId>:<dateKey>` for recurring occurrences. That determinism
--   is what stops two devices from each materialising the same occurrence, so
--   the cloud has to be able to store it as the primary key. A uuid column
--   would silently make every recurring row unsyncable.
--
-- * Two timestamps, deliberately:
--     updated_at        — set by the server on every write. This is the pull
--                         cursor. Server-side so a device with a wrong clock
--                         cannot hide rows from other devices.
--     client_updated_at — when the edit actually happened on the device. This
--                         is what last-write-wins compares, because an offline
--                         edit made at 09:00 and pushed at 18:00 should not
--                         beat an online edit made at 17:00.
--
-- * deleted_at, never DELETE. A hard delete on one device looks identical to
--   "row not yet synced" on another, which resurrects it. Tombstones sync.
--
-- * Money is numeric, never float. numeric is exact decimal in Postgres and
--   round-trips the app's integer-minor-unit arithmetic without drift.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  locale        text        not null default 'zh-TW',
  currency      text        not null default 'TWD',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  revision      integer     not null default 1
);

-- ------------------------------------------------------------ transactions
create table if not exists public.transactions (
  id                      text        primary key,
  user_id                 uuid        not null references auth.users(id) on delete cascade,

  type                    text        not null check (type in ('income','expense')),
  amount                  numeric(18,4) not null check (amount >= 0),
  currency                text        not null default 'TWD',

  category_id             text,
  -- Labels can be renamed later; the snapshot keeps history readable.
  category_label_snapshot text        not null default '',
  payment_method_id       text,

  merchant                text,
  note                    text        not null default '',
  transaction_date        date        not null,

  linked_debt_id          text,
  linked_goal_id          text,
  -- What was ACTUALLY applied after clamping at zero, so a delete reverses exactly.
  linked_debt_applied     numeric(18,4),
  linked_goal_applied     numeric(18,4),

  -- 'web' | 'app' | 'pet' | 'pet_quick_add' | 'pet_voice' | 'recurring' | 'import'.
  -- Deliberately no CHECK: a new client writing a new source value must not be
  -- rejected by a cloud schema an older migration pinned (see ADR, additive rule).
  source                  text        not null default 'web',
  device_id               text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  client_updated_at       timestamptz,
  deleted_at              timestamptz,
  revision                integer     not null default 1,
  schema_version          integer     not null default 1
);

-- --------------------------------------------------------------- categories
create table if not exists public.categories (
  id                text        primary key,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  label             text        not null,
  type              text        not null check (type in ('income','expense')),
  emoji             text,
  sort_order        integer     not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz,
  deleted_at        timestamptz,
  revision          integer     not null default 1,
  schema_version    integer     not null default 1
);

-- ---------------------------------------------------------- payment_methods
create table if not exists public.payment_methods (
  id                text        primary key,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  label             text        not null,
  enabled           boolean     not null default true,
  sort_order        integer     not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz,
  deleted_at        timestamptz,
  revision          integer     not null default 1,
  schema_version    integer     not null default 1
);

-- ------------------------------------------------------------------ budgets
create table if not exists public.budgets (
  id                text        primary key,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  category_id       text        not null,
  amount            numeric(18,4) not null check (amount >= 0),
  alert_enabled     boolean     not null default true,
  alert_threshold   integer     not null default 80 check (alert_threshold between 0 and 100),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz,
  deleted_at        timestamptz,
  revision          integer     not null default 1,
  schema_version    integer     not null default 1
);
-- One live budget per category per user; tombstones are exempt.
create unique index if not exists budgets_user_category_live
  on public.budgets (user_id, category_id) where deleted_at is null;

-- -------------------------------------------------------------------- debts
create table if not exists public.debts (
  id                text        primary key,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  name              text        not null,
  type              text,
  amount            numeric(18,4) not null default 0,
  initial_amount    numeric(18,4),
  interest_rate     numeric(9,4) not null default 0,
  monthly_payment   numeric(18,4),
  due_date          date,
  note              text        not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz,
  deleted_at        timestamptz,
  revision          integer     not null default 1,
  schema_version    integer     not null default 1
);

-- -------------------------------------------------------------------- goals
create table if not exists public.goals (
  id                text        primary key,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  name              text        not null,
  target_amount     numeric(18,4) not null default 0,
  current_amount    numeric(18,4) not null default 0,
  target_date       date,
  note              text        not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz,
  deleted_at        timestamptz,
  revision          integer     not null default 1,
  schema_version    integer     not null default 1
);

-- ---------------------------------------------------- recurring_transactions
create table if not exists public.recurring_transactions (
  id                text        primary key,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  type              text        not null check (type in ('income','expense')),
  amount            numeric(18,4) not null check (amount >= 0),
  category          text        not null default '',
  frequency         text        not null check (frequency in ('daily','weekly','monthly','yearly')),
  start_date        date        not null,
  next_date         date        not null,
  note              text        not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz,
  deleted_at        timestamptz,
  revision          integer     not null default 1,
  schema_version    integer     not null default 1
);

-- ------------------------------------------------- settings (one per user)
create table if not exists public.user_settings (
  user_id           uuid        primary key references auth.users(id) on delete cascade,
  settings          jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz,
  revision          integer     not null default 1,
  schema_version    integer     not null default 1
);

create table if not exists public.pet_settings (
  user_id           uuid        primary key references auth.users(id) on delete cascade,
  settings          jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_updated_at timestamptz,
  revision          integer     not null default 1,
  schema_version    integer     not null default 1
);

-- ------------------------------------------------------------- sync_devices
create table if not exists public.sync_devices (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  device_id      text        not null,
  label          text,
  platform       text,
  app_version    text,
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- ---------------------------------------------------------- backup_metadata
-- Metadata only. Backup CONTENT is never stored here; export stays a local file.
create table if not exists public.backup_metadata (
  id           text        primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  kind         text        not null,
  row_counts   jsonb       not null default '{}'::jsonb,
  size_bytes   bigint,
  checksum     text,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------ indexes
create index if not exists transactions_user_date  on public.transactions (user_id, transaction_date desc);
create index if not exists transactions_user_upd   on public.transactions (user_id, updated_at);
create index if not exists transactions_user_live  on public.transactions (user_id, deleted_at);
create index if not exists categories_user_upd     on public.categories (user_id, updated_at);
create index if not exists payment_methods_user_upd on public.payment_methods (user_id, updated_at);
create index if not exists budgets_user_upd        on public.budgets (user_id, updated_at);
create index if not exists debts_user_upd          on public.debts (user_id, updated_at);
create index if not exists goals_user_upd          on public.goals (user_id, updated_at);
create index if not exists recurring_user_upd      on public.recurring_transactions (user_id, updated_at);

-- ------------------------------------- server-owned updated_at and revision
-- The pull cursor must never depend on a device's clock, and a client that
-- forgets to bump revision must not be able to make a row invisible to sync.
create or replace function public.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.revision   := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','transactions','categories','payment_methods','budgets',
    'debts','goals','recurring_transactions','user_settings','pet_settings'
  ] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$I
       for each row execute function public.touch_row()', t);
  end loop;
end;
$$;
