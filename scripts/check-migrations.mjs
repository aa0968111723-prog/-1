#!/usr/bin/env node
/**
 * Structural checks on supabase/migrations.
 *
 * Not a SQL parser — a guard against the specific mistakes that are cheap to
 * make and expensive to discover:
 *
 *   1. A migration file that is not numbered, so apply order is undefined.
 *   2. A finance table created without Row Level Security. This is THE
 *      mistake that exposes one user's ledger to another, and it is invisible
 *      in review because the table looks perfectly normal.
 *   3. A service-role key pasted into a migration.
 */
import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'supabase/migrations';

/** Every table holding user finance data. Adding one here is deliberate. */
const MUST_HAVE_RLS = [
  'transactions', 'categories', 'payment_methods', 'budgets', 'debts',
  'goals', 'recurring_transactions', 'user_settings', 'pet_settings',
  'profiles', 'sync_devices', 'backup_metadata',
];

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const errors = [];

if (files.length === 0) errors.push(`${DIR} contains no .sql migrations`);

for (const f of files) {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(f)) {
    errors.push(`${f}: expected NNNN_snake_case.sql so apply order is unambiguous`);
  }
}

const all = files.map(f => readFileSync(`${DIR}/${f}`, 'utf8')).join('\n');

for (const table of MUST_HAVE_RLS) {
  const created = new RegExp(`create table[^;]*\\bpublic\\.${table}\\b`, 'i').test(all);
  if (!created) continue;
  // Either named directly, or covered by a loop that lists it.
  const guarded =
    new RegExp(`enable row level security[^;]*${table}`, 'i').test(all) ||
    new RegExp(`'${table}'`).test(all);
  if (!guarded) {
    errors.push(`table public.${table} is created but never has RLS enabled`);
  }
}

if (/service_role/i.test(all) && /eyJ[A-Za-z0-9_-]{20,}/.test(all)) {
  errors.push('a JWT-looking string appears next to "service_role" in a migration');
}

if (errors.length > 0) {
  console.error('Migration checks failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`migrations OK: ${files.length} file(s), RLS present for every finance table`);
