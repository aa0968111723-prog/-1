import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceSyncEngine, toCloudRow, fromCloudRow, SupabaseLike } from '../syncEngine';
import { FinanceRepository } from '../../financeRepository';
import { createMemoryStorage } from '../../__tests__/testUtils';
import { Transaction } from '../../../types';

const USER = 'user-1';

function repo() {
  return new FinanceRepository(createMemoryStorage());
}

/** A fake cloud: records what was pushed, returns what we tell it to. */
function fakeCloud(opts: {
  rows?: unknown[];
  pullError?: string;
  pushError?: string;
} = {}) {
  const pushed: unknown[][] = [];
  let lastGt: unknown = undefined;
  const client: SupabaseLike = {
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        gt: (_c: string, v: unknown) => {
          lastGt = v;
          return q;
        },
        order: () => q,
        limit: async () =>
          opts.pullError
            ? { data: null, error: { message: opts.pullError } }
            : { data: opts.rows ?? [], error: null },
      };
      return {
        select: () => q,
        upsert: async (rows: unknown[]) => {
          if (opts.pushError) return { error: { message: opts.pushError } };
          pushed.push(rows);
          return { error: null };
        },
      } as never;
    },
  };
  return { client, pushed, getLastGt: () => lastGt };
}

function cloudRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: USER,
    type: 'expense',
    amount: '120.0000',
    currency: 'TWD',
    category_id: 'food',
    category_label_snapshot: '餐飲美食',
    payment_method_id: 'cash',
    merchant: null,
    note: '午餐',
    transaction_date: '2026-08-20',
    linked_debt_id: null,
    linked_goal_id: null,
    linked_debt_applied: null,
    linked_goal_applied: null,
    source: 'web',
    device_id: 'other-device',
    updated_at: '2026-08-20T10:00:00.000Z',
    client_updated_at: '2026-08-20T09:59:00.000Z',
    deleted_at: null,
    ...over,
  };
}

describe('cloud row mapping', () => {
  it('round-trips a transaction without losing fields', () => {
    const tx: Transaction = {
      id: 't1',
      type: 'expense',
      amount: 120.5,
      category: '餐飲美食',
      categoryId: 'food',
      date: '2026-08-20',
      note: '午餐',
      paymentMethod: 'easycard',
      updatedAt: '2026-08-20T10:00:00.000Z',
    };
    const cloud = toCloudRow(tx, USER, 'dev') as Record<string, unknown>;
    const back = fromCloudRow({ ...cloud, updated_at: '2026-08-20T10:00:00.000Z' } as never);
    expect(back.id).toBe('t1');
    expect(back.amount).toBe(120.5);
    expect(back.category).toBe('餐飲美食');
    expect(back.paymentMethod).toBe('easycard');
    expect(back.date).toBe('2026-08-20');
  });

  it('parses Postgres numeric strings rather than producing NaN', () => {
    // numeric comes back as a string over the wire; Number(null) would be 0,
    // which would silently turn "no linked debt" into "applied 0".
    const row = fromCloudRow(cloudRow('t2') as never);
    expect(row.amount).toBe(120);
    expect(row.linkedDebtApplied).toBeUndefined();
  });

  it('prefers client_updated_at for merge decisions', () => {
    const row = fromCloudRow(cloudRow('t3') as never);
    expect(row.updatedAt).toBe('2026-08-20T09:59:00.000Z');
  });

  it('falls back to the server time when the client one is absent', () => {
    const row = fromCloudRow(cloudRow('t4', { client_updated_at: null }) as never);
    expect(row.updatedAt).toBe('2026-08-20T10:00:00.000Z');
  });
});

describe('a sync cycle', () => {
  let r: FinanceRepository;
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    r = new FinanceRepository(storage);
  });

  it('pulls cloud rows into an empty local ledger', async () => {
    const { client } = fakeCloud({ rows: [cloudRow('c1'), cloudRow('c2')] });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);

    const out = await engine.sync(USER);

    expect(out.ok).toBe(true);
    expect(out.pulled).toBe(2);
    expect(r.getTransactions().map(t => t.id).sort()).toEqual(['c1', 'c2']);
  });

  it('pushes local-only rows and keeps both sides', async () => {
    r.addTransaction({ id: 'local-1', type: 'expense', amount: 50, category: '交通出行', date: '2026-08-20', note: '' });
    const { client, pushed } = fakeCloud({ rows: [cloudRow('cloud-1')] });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);

    const out = await engine.sync(USER);

    expect(out.ok).toBe(true);
    expect(out.pushed).toBe(1);
    expect(r.getTransactions().map(t => t.id).sort()).toEqual(['cloud-1', 'local-1']);
    expect((pushed[0][0] as Record<string, unknown>).id).toBe('local-1');
  });

  it('marks synced rows so the pending count is not permanently wrong', async () => {
    r.addTransaction({
      id: 'local-1', type: 'expense', amount: 50, category: '交通出行',
      date: '2026-08-20', note: '', updatedAt: '2026-08-20T10:00:00.000Z',
    } as Transaction);
    const { client } = fakeCloud({ rows: [] });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);

    expect(engine.countPending()).toBe(1);
    await engine.sync(USER);
    expect(engine.countPending()).toBe(0);
  });

  it('advances the cursor only after the whole cycle succeeded', async () => {
    const ok = fakeCloud({ rows: [cloudRow('c1', { updated_at: '2026-08-20T11:00:00.000Z' })] });
    const engine = new FinanceSyncEngine(r, storage, () => ok.client, () => true);
    await engine.sync(USER);

    // Second cycle must ask only for rows newer than the first batch.
    const next = fakeCloud({ rows: [] });
    const engine2 = new FinanceSyncEngine(r, storage, () => next.client, () => true);
    await engine2.sync(USER);
    expect(next.getLastGt()).toBe('2026-08-20T11:00:00.000Z');
  });

  it('does NOT advance the cursor when the push fails', async () => {
    r.addTransaction({ id: 'local-1', type: 'expense', amount: 50, category: '交通出行', date: '2026-08-20', note: '' });
    const failing = fakeCloud({ rows: [cloudRow('c1', { updated_at: '2026-08-20T11:00:00.000Z' })], pushError: 'boom' });
    const engine = new FinanceSyncEngine(r, storage, () => failing.client, () => true);

    const out = await engine.sync(USER);
    expect(out.ok).toBe(false);

    // A skipped cursor would mean those rows are never pulled again.
    const next = fakeCloud({ rows: [] });
    await new FinanceSyncEngine(r, storage, () => next.client, () => true).sync(USER);
    expect(next.getLastGt()).toBeUndefined();
  });

  it('reports failure through status instead of throwing', async () => {
    // The rule the whole design rests on: a sync problem must never be able to
    // turn a successful local save into a user-visible failure.
    const { client } = fakeCloud({ pullError: 'network unreachable' });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);

    await expect(engine.sync(USER)).resolves.toMatchObject({ ok: false });
    expect(engine.getStatus().phase).toBe('error');
    expect(engine.getStatus().lastError).toContain('network unreachable');
  });

  it('keeps the local ledger intact when the cloud is unreachable', async () => {
    r.addTransaction({ id: 'local-1', type: 'expense', amount: 50, category: '交通出行', date: '2026-08-20', note: '' });
    const { client } = fakeCloud({ pullError: 'offline' });
    await new FinanceSyncEngine(r, storage, () => client, () => true).sync(USER);
    expect(r.getTransactions()).toHaveLength(1);
  });

  it('does nothing when signed out, and says so', async () => {
    const { client, pushed } = fakeCloud({});
    const out = await new FinanceSyncEngine(r, storage, () => client, () => true).sync(null);
    expect(out.error).toBe('not-signed-in');
    expect(pushed).toHaveLength(0);
  });

  it('does nothing when cloud sync is not configured', async () => {
    const { client } = fakeCloud({});
    const out = await new FinanceSyncEngine(r, storage, () => client, () => false).sync(USER);
    expect(out.error).toBe('not-signed-in');
  });

  it('refuses to run two cycles at once', async () => {
    const { client } = fakeCloud({ rows: [] });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);
    const [a, b] = await Promise.all([engine.sync(USER), engine.sync(USER)]);
    const errors = [a.error, b.error].filter(Boolean);
    expect(errors).toContain('already-running');
  });

  it('a cloud tombstone hides the row locally without deleting the record', async () => {
    r.addTransaction({
      id: 'x1', type: 'expense', amount: 50, category: '交通出行',
      date: '2026-08-20', note: '', updatedAt: '2026-08-20T08:00:00.000Z',
    } as Transaction);
    const { client } = fakeCloud({
      rows: [cloudRow('x1', { deleted_at: '2026-08-20T12:00:00.000Z', client_updated_at: '2026-08-20T12:00:00.000Z' })],
    });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);
    await engine.sync(USER);

    expect(r.getTransactions()).toHaveLength(1);         // tombstone retained
    expect(engine.visibleTransactions()).toHaveLength(0); // but not shown
  });
});
