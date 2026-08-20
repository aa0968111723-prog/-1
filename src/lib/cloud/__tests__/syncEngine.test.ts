import { describe, it, expect, beforeEach, vi } from 'vitest';
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

    // Retained on disk so the deletion keeps syncing...
    expect(r.getAllTransactionsIncludingDeleted()).toHaveLength(1);
    // ...but invisible to every ordinary reader. getTransactions() used to
    // return it, which put a deleted transaction back into every total the
    // analytics engine computed.
    expect(r.getTransactions()).toHaveLength(0);
    expect(engine.visibleTransactions()).toHaveLength(0);
  });
});

describe('the post-write nudge', () => {
  beforeEach(() => vi.useFakeTimers());

  it('collapses a burst of writes into a single cycle', async () => {
    // Quick add, a correction, another entry — one intent, one radio use.
    const storage = createMemoryStorage();
    const r = new FinanceRepository(storage);
    const { client, pushed } = fakeCloud({ rows: [] });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);
    const spy = vi.spyOn(engine, 'sync');

    engine.nudge(USER, 3000);
    engine.nudge(USER, 3000);
    engine.nudge(USER, 3000);
    expect(spy).not.toHaveBeenCalled(); // nothing yet — still collapsing

    await vi.advanceTimersByTimeAsync(3000);
    expect(spy).toHaveBeenCalledTimes(1);
    void pushed;
  });

  it('does nothing at all when signed out', async () => {
    const storage = createMemoryStorage();
    const r = new FinanceRepository(storage);
    const { client } = fakeCloud({ rows: [] });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);
    const spy = vi.spyOn(engine, 'sync');

    engine.nudge(null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spy).not.toHaveBeenCalled();
  });
});

/*
 * The window between the pre-push snapshot and the post-push write.
 *
 * The cycle used to compute its final array before awaiting the upsert and
 * then write that array back afterwards. On a phone the await is seconds
 * long — long enough for the user to record a transaction, which the write
 * then erased while the cycle reported ok:true.
 */
describe('a local edit made while the push is in flight', () => {
  // An earlier suite installs fake timers and does not restore them, so the
  // awaited setTimeout below would never fire.
  beforeEach(() => vi.useRealTimers());

  /** A cloud whose upsert runs `during` before resolving. */
  function slowCloud(during: () => void): SupabaseLike {
    return {
      from() {
        const q = {
          select: () => q,
          eq: () => q,
          gt: () => q,
          order: () => q,
          limit: async () => ({ data: [], error: null }),
        };
        return {
          select: () => q,
          upsert: async () => {
            during();
            await new Promise(res => setTimeout(res, 0));
            return { error: null };
          },
        } as never;
      },
    };
  }

  it('survives the sync that was already in progress', async () => {
    const r = repo();
    r.addTransaction({ id: 'local-1', type: 'expense', amount: 100, category: '餐飲美食', date: '2026-08-20', note: '' });

    const client = slowCloud(() => {
      r.addTransaction({ id: 'during-push', type: 'expense', amount: 999, category: '交通出行', date: '2026-08-20', note: '' });
    });
    const engine = new FinanceSyncEngine(r, createMemoryStorage(), () => client, () => true);

    const outcome = await engine.sync(USER);
    expect(outcome.ok).toBe(true);
    expect(r.getTransactions().map(t => t.id).sort()).toEqual(['during-push', 'local-1']);
  });

  it('is not marked synced at a version the cloud never received', async () => {
    const r = repo();
    r.addTransaction({ id: 'edited', type: 'expense', amount: 100, category: '餐飲美食', date: '2026-08-20', note: '' });

    const client = slowCloud(() => {
      // The user corrects the amount while the old value is being uploaded.
      const rows = r.getTransactions().map(t =>
        t.id === 'edited' ? { ...t, amount: 250, updatedAt: '2999-01-01T00:00:00Z' } : t,
      );
      r.saveTransactions(rows);
    });
    const engine = new FinanceSyncEngine(r, createMemoryStorage(), () => client, () => true);

    await engine.sync(USER);

    const row = r.getTransactions().find(t => t.id === 'edited') as { amount: number; syncedAt?: string };
    expect(row.amount).toBe(250);           // the correction survived
    expect(row.syncedAt).toBeUndefined();   // and is still queued to go out
    expect(engine.countPending()).toBe(1);
  });
});

describe('subscribers can tell that a pull changed the ledger', () => {
  beforeEach(() => vi.useRealTimers());

  it('reports how many rows came down', async () => {
    const r = repo();
    const storage = createMemoryStorage();
    const { client } = fakeCloud({ rows: [cloudRow('c1'), cloudRow('c2')] });
    const engine = new FinanceSyncEngine(r, storage, () => client, () => true);

    const seen: number[] = [];
    engine.subscribe(s => seen.push(s.lastPulled));
    await engine.sync(USER);

    // Without this, the only way to learn a pull happened was to be the caller
    // who awaited sync() — so rows from another device stayed off screen until
    // the user reloaded.
    expect(engine.getStatus().lastPulled).toBe(2);
    expect(seen[seen.length - 1]).toBe(2);
  });

  it('stays at zero when the cycle brought nothing', async () => {
    const r = repo();
    const { client } = fakeCloud({ rows: [] });
    const engine = new FinanceSyncEngine(r, createMemoryStorage(), () => client, () => true);

    await engine.sync(USER);

    expect(engine.getStatus().lastPulled).toBe(0);
  });
});
