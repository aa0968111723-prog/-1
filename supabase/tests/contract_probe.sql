-- Contract probe: does the row shape the client actually sends fit the table,
-- and does RLS really stop one user reading another's ledger?
--
-- Why this exists as a separate thing from the unit tests: every sync test in
-- src/lib/cloud/__tests__ runs against a FAKE cloud. That is the right way to
-- test merge logic, but it means a mismatch between toCloudRow() and the real
-- schema — a renamed column, a type the table rejects, a primary key that
-- cannot hold a deterministic recurring id — is invisible until a user's first
-- real sync. This closes that gap.
--
-- Run against the project with:
--   supabase db execute --file supabase/tests/contract_probe.sql
-- or paste into the SQL editor. It creates two throwaway users, exercises the
-- real write paths as those users WITH RLS ACTIVE, and deletes everything it
-- made. It leaves no rows behind, and it raises rather than returning quietly
-- if anything is wrong.

do $$
declare
  uid   uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  visible int;
  leaked  int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'contract-probe@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
         (other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'contract-probe-2@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  -- Exactly the columns src/lib/cloud/syncEngine.ts toCloudRow() sends.
  -- The second row is the important one: a deterministic recurring id. If the
  -- primary key were uuid instead of text, every recurring occurrence would be
  -- unsyncable and this insert would fail here rather than in production.
  insert into public.transactions (
    id, user_id, type, amount, currency, category_id, category_label_snapshot,
    payment_method_id, merchant, note, transaction_date, linked_debt_id,
    linked_goal_id, linked_debt_applied, linked_goal_applied, source, device_id,
    client_updated_at, deleted_at
  ) values
    ('probe-uuid-1', uid, 'expense', 120.50, 'TWD', 'food', '餐飲美食',
     'easycard', null, '午餐', '2026-08-20', null, null, null, null,
     'pet_quick_add', 'probe-device', '2026-08-20T09:59:00Z', null),
    ('recurring:rule-9:2026-08-01', uid, 'expense', 1200, 'TWD', 'home', '居家生活',
     'bank', null, '房租', '2026-08-01', null, null, null, null,
     'recurring', 'probe-device', '2026-08-01T00:00:00Z', null);

  -- Every push is an upsert; replaying one must not duplicate or fail.
  insert into public.transactions (id, user_id, type, amount, transaction_date,
                                   category_label_snapshot, note, source, client_updated_at)
  values ('probe-uuid-1', uid, 'expense', 999, '2026-08-20', '餐飲美食', '改過了', 'web',
          '2026-08-20T11:00:00Z')
  on conflict (id) do update set
    amount            = excluded.amount,
    note              = excluded.note,
    client_updated_at = excluded.client_updated_at;

  -- Deletes are tombstones.
  update public.transactions set deleted_at = '2026-08-20T12:00:00Z'
  where id = 'recurring:rule-9:2026-08-01';

  select count(*) into visible from public.transactions;

  -- Become a different user and try to read the first one's ledger.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', other, 'role', 'authenticated')::text, true);
  select count(*) into leaked from public.transactions;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id in (uid, other);

  if visible <> 2 then
    raise exception 'CONTRACT FAIL: owner saw % rows, expected 2', visible;
  end if;
  if leaked <> 0 then
    raise exception 'RLS FAIL: another user saw % of this user''s rows', leaked;
  end if;
  raise notice 'contract OK: client row shape accepted, cross-user read blocked';
end;
$$;
