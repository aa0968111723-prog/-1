/**
 * FinanceSyncEngine — moves the ledger between this device and the account.
 *
 * The single most important rule, and the one that shapes everything else:
 *
 *     A LOCAL WRITE THAT SUCCEEDED IS A SUCCESS.
 *
 * Sync failing afterwards is a background condition, never a failed save. The
 * user is told "記好啦" because the entry is genuinely, durably theirs — it is
 * on the device. Telling them "記帳失敗" because a phone was in a lift would
 * be a lie that makes people re-enter transactions they already have.
 *
 * Shape of a cycle:
 *
 *     pull (rows changed since the cursor)
 *        -> merge with local, by id, LWW on client edit time
 *        -> write merged set locally
 *        -> push the rows the cloud is missing or has stale
 *        -> advance the cursor ONLY after both halves succeeded
 *
 * The cursor is the server's updated_at, not the device's clock, so a wrong
 * clock cannot make rows invisible. It advances last so a crash mid-cycle
 * re-pulls rather than skips.
 */

import { Transaction } from '../../types';
import { FinanceRepository } from '../financeRepository';
import { mergeById, withoutTombstones, Syncable } from './merge';
import { getSupabase, isCloudConfigured } from './supabaseClient';
import { getDeviceId } from './device';
import { categoryIdForStored } from '../categoryCatalog';

/** A transaction carrying the metadata sync needs. All fields optional on legacy rows. */
export type SyncableTransaction = Transaction & Syncable;

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

/**
 * Only the surface the engine actually uses. Typing against this instead of
 * SupabaseClient keeps a test fake to a few lines and makes it obvious how
 * small the cloud dependency really is.
 */
export interface SyncQuery {
  select(columns: string): SyncQuery;
  eq(column: string, value: unknown): SyncQuery;
  gt(column: string, value: unknown): SyncQuery;
  order(column: string, opts: { ascending: boolean }): SyncQuery;
  limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
}

export interface SyncTable {
  select(columns: string): SyncQuery;
  upsert(rows: unknown[], opts: { onConflict: string }): Promise<{ error: { message: string } | null }>;
}

export interface SyncableLike {
  from(table: string): SyncTable;
}

export type SupabaseLike = SyncableLike;

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncAt: string | null;
  pendingCount: number;
  lastError: string | null;
  /** Conflicts resolved in the last cycle; surfaced only in diagnostics. */
  lastConflictCount: number;
}

export interface SyncOutcome {
  ok: boolean;
  pulled: number;
  pushed: number;
  conflicts: number;
  error?: string;
}

const CURSOR_KEY = 'fintracker.sync_cursor';
const LAST_SYNC_KEY = 'fintracker.sync_last_at';

/** Cloud row shape. Mirrors supabase/migrations/0001. */
interface CloudTransaction {
  id: string;
  user_id: string;
  type: 'income' | 'expense';
  amount: number | string;
  currency: string;
  category_id: string | null;
  category_label_snapshot: string;
  payment_method_id: string | null;
  merchant: string | null;
  note: string;
  transaction_date: string;
  linked_debt_id: string | null;
  linked_goal_id: string | null;
  linked_debt_applied: number | string | null;
  linked_goal_applied: number | string | null;
  source: string;
  device_id: string | null;
  updated_at: string;
  client_updated_at: string | null;
  deleted_at: string | null;
}

/** Postgres numeric arrives as a string; Number() on null would give 0, not undefined. */
function num(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function toCloudRow(tx: SyncableTransaction, userId: string, deviceId: string): Record<string, unknown> {
  return {
    id: tx.id,
    user_id: userId,
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency ?? 'TWD',
    category_id: tx.categoryId ?? categoryIdForStored(tx.category),
    category_label_snapshot: tx.category ?? '',
    payment_method_id: tx.paymentMethod ?? null,
    merchant: null,
    note: tx.note ?? '',
    transaction_date: tx.date,
    linked_debt_id: tx.linkedDebtId ?? null,
    linked_goal_id: tx.linkedGoalId ?? null,
    linked_debt_applied: tx.linkedDebtApplied ?? null,
    linked_goal_applied: tx.linkedGoalApplied ?? null,
    source: tx.source ?? 'web',
    device_id: tx.deviceId ?? deviceId,
    client_updated_at: tx.updatedAt ?? tx.createdAt ?? new Date().toISOString(),
    deleted_at: tx.deletedAt ?? null,
  };
}

export function fromCloudRow(row: CloudTransaction): SyncableTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: num(row.amount) ?? 0,
    category: row.category_label_snapshot || '',
    categoryId: row.category_id ?? undefined,
    date: row.transaction_date,
    note: row.note ?? '',
    paymentMethod: row.payment_method_id ?? undefined,
    linkedDebtId: row.linked_debt_id ?? undefined,
    linkedGoalId: row.linked_goal_id ?? undefined,
    linkedDebtApplied: num(row.linked_debt_applied),
    linkedGoalApplied: num(row.linked_goal_applied),
    source: row.source,
    currency: row.currency,
    // client_updated_at drives merge decisions; updated_at only drives the cursor.
    updatedAt: row.client_updated_at ?? row.updated_at,
    deletedAt: row.deleted_at,
    deviceId: row.device_id ?? undefined,
  };
}

export class FinanceSyncEngine {
  private running = false;
  private status: SyncStatus = {
    phase: 'idle',
    lastSyncAt: null,
    pendingCount: 0,
    lastError: null,
    lastConflictCount: 0,
  };
  private listeners = new Set<(s: SyncStatus) => void>();

  /**
   * [clientFactory] exists so the cycle can be tested against a fake without a
   * network. Untestable sync code is how a data-loss bug ships.
   */
  constructor(
    private repository: FinanceRepository,
    private storage: Storage | undefined = globalThis.localStorage,
    private clientFactory: () => SupabaseLike | null = getSupabase as unknown as () => SupabaseLike | null,
    private cloudConfigured: () => boolean = () => isCloudConfigured,
  ) {
    this.status.lastSyncAt = this.storage?.getItem(LAST_SYNC_KEY) ?? null;
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.getStatus());
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.getStatus());
  }

  private get cursor(): string | null {
    return this.storage?.getItem(CURSOR_KEY) ?? null;
  }

  private setCursor(value: string): void {
    try {
      this.storage?.setItem(CURSOR_KEY, value);
    } catch {
      // A lost cursor costs a full re-pull, which is slow but still correct.
    }
  }

  /** Local rows the cloud has not confirmed. Drives the "等待同步 N 筆" hint. */
  countPending(): number {
    const rows = this.repository.getTransactions() as SyncableTransaction[];
    return rows.filter(r => {
      if (!r.updatedAt) return false; // legacy row, never edited since sync existed
      return !r.syncedAt || r.updatedAt > r.syncedAt;
    }).length;
  }

  /**
   * Run one cycle. Never throws: sync problems are reported through status,
   * because a caller in the save path must not be able to turn a successful
   * local write into a user-visible failure.
   */
  async sync(userId: string | null): Promise<SyncOutcome> {
    if (!this.cloudConfigured() || !userId) {
      return { ok: false, pulled: 0, pushed: 0, conflicts: 0, error: 'not-signed-in' };
    }
    if (this.running) return { ok: false, pulled: 0, pushed: 0, conflicts: 0, error: 'already-running' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.emit({ phase: 'offline' });
      return { ok: false, pulled: 0, pushed: 0, conflicts: 0, error: 'offline' };
    }

    const supabase = this.clientFactory();
    if (!supabase) return { ok: false, pulled: 0, pushed: 0, conflicts: 0, error: 'not-configured' };

    this.running = true;
    this.emit({ phase: 'syncing', lastError: null });
    const deviceId = getDeviceId(this.storage);

    try {
      // ---- pull ----
      let builder = supabase.from('transactions').select('*').eq('user_id', userId);
      const since = this.cursor;
      if (since) builder = builder.gt('updated_at', since);
      // Ordered by the SERVER's updated_at so the cursor advances monotonically
      // regardless of any device's clock.
      const { data, error } = await builder.order('updated_at', { ascending: true }).limit(2000);
      if (error) throw new Error(`pull failed: ${error.message}`);

      const remote = (data ?? []).map(r => fromCloudRow(r as CloudTransaction));
      // The newest server timestamp in this batch becomes the next cursor —
      // taken from the DATA, never from the local clock.
      const newestServer = (data ?? []).reduce<string | null>(
        (acc, r) => {
          const u = (r as CloudTransaction).updated_at;
          return !acc || u > acc ? u : acc;
        },
        null,
      );

      // ---- merge ----
      const local = this.repository.getTransactions() as SyncableTransaction[];
      const result = mergeById(local, remote);

      // Local state is written BEFORE the push. If the push then fails, the
      // device still has everything the cloud sent; the reverse order could
      // acknowledge rows that never landed locally.
      this.repository.saveTransactions(result.merged);

      // ---- push ----
      let pushed = 0;
      const confirmed = new Set<string>();
      if (result.toPush.length > 0) {
        // Chunked so one oversized request cannot fail the whole cycle, and so
        // a partial failure still leaves the earlier chunks confirmed.
        for (let i = 0; i < result.toPush.length; i += 200) {
          const chunk = result.toPush.slice(i, i + 200);
          const { error: pushError } = await supabase
            .from('transactions')
            .upsert(chunk.map(tx => toCloudRow(tx, userId, deviceId)), { onConflict: 'id' });
          if (pushError) throw new Error(`push failed: ${pushError.message}`);
          for (const tx of chunk) confirmed.add(tx.id);
          pushed += chunk.length;
        }
      }

      // Stamp what the cloud has actually confirmed. Without this every row
      // looks dirty forever and the UI reports "等待同步 322 筆" on a fully
      // synced ledger. Rows that came FROM the cloud are confirmed by
      // definition; rows we pushed are confirmed by the upsert succeeding.
      const remoteIds = new Set(remote.map(r => r.id));
      const stamped = result.merged.map(tx =>
        confirmed.has(tx.id) || remoteIds.has(tx.id)
          ? { ...tx, syncedAt: tx.updatedAt ?? new Date().toISOString() }
          : tx,
      );
      this.repository.saveTransactions(stamped);

      // ---- cursor last ----
      // Only now, with both halves done. A crash before this point re-pulls
      // the same window next time, which the id-based merge absorbs.
      if (newestServer) this.setCursor(newestServer);
      const at = new Date().toISOString();
      try {
        this.storage?.setItem(LAST_SYNC_KEY, at);
      } catch { /* cosmetic */ }

      this.emit({
        phase: 'idle',
        lastSyncAt: at,
        lastError: null,
        lastConflictCount: result.conflicts.length,
        pendingCount: 0,
      });
      return { ok: true, pulled: remote.length, pushed, conflicts: result.conflicts.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Reported, not thrown. The ledger on this device is untouched and
      // complete; the next trigger tries again.
      console.warn('[FinTracker.Sync] cycle failed, will retry', message);
      this.emit({ phase: 'error', lastError: message });
      return { ok: false, pulled: 0, pushed: 0, conflicts: 0, error: message };
    } finally {
      this.running = false;
    }
  }

  /** Visible ledger: tombstones are storage, not content. */
  visibleTransactions(): Transaction[] {
    return withoutTombstones(this.repository.getTransactions() as SyncableTransaction[]);
  }
}
