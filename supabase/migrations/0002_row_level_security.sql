-- Row Level Security for every finance table.
--
-- This is the only thing standing between one user's ledger and another's.
-- The client filters by user_id too, but that is a convenience, not a control:
-- anyone can craft their own request with the publishable key. RLS is what
-- actually enforces ownership, in the database, on every path.
--
-- Policies are generated in a loop rather than hand-written 40 times. That is
-- deliberate: a hand-written set is one typo away from a table that quietly
-- allows everything, and the typo is invisible in review. The loop cannot
-- disagree with itself. The verification query at the bottom of
-- docs/SUPABASE_SECURITY.md lists what actually landed.

-- Tables keyed by a user_id column.
do $$
declare t text;
begin
  foreach t in array array[
    'transactions','categories','payment_methods','budgets',
    'debts','goals','recurring_transactions','sync_devices','backup_metadata'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);

    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    -- DELETE is granted even though the app soft-deletes: account deletion and
    -- "forget this device" are real, and a user must be able to remove their
    -- own rows outright.
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated
         using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Tables keyed by the user's own id (one row per user).
do $$
declare t text; col text;
begin
  foreach t in array array['profiles','user_settings','pet_settings'] loop
    col := case when t = 'profiles' then 'id' else 'user_id' end;

    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);

    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using (%2$I = (select auth.uid()))', t, col);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated
         with check (%2$I = (select auth.uid()))', t, col);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated
         using (%2$I = (select auth.uid()))
         with check (%2$I = (select auth.uid()))', t, col);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated
         using (%2$I = (select auth.uid()))', t, col);
  end loop;
end;
$$;

-- A profile row should exist the moment a user does, so the app never has to
-- special-case "logged in but no profile yet".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
