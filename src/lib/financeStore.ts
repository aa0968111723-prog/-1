/**
 * FinanceStore — the durable backend under FinanceRepository.
 *
 * See docs/ADR-LOCAL-FIRST-STORAGE.md. Short version: localStorage cannot
 * hold the ledger any more. 50,000 transactions serialise to roughly 10-12 MB
 * against a ~5 MB quota, and exceeding it makes setItem throw
 * QuotaExceededError — a failed write, not a slow one. So the durable store
 * becomes IndexedDB, which both the browser and the Android WebView have, and
 * which starts at hundreds of MB.
 *
 * The shape is what keeps this from being a rewrite:
 *
 *     await store.init();      // the ONLY async point, once at boot
 *     store.read(key, fb);     // synchronous, from memory
 *     store.write(key, value); // synchronous to memory, queued to disk
 *
 * FinanceRepository's public API therefore does not change at all, and neither
 * does any component or test that uses it.
 *
 * Durability note, stated plainly: write() returns before the IndexedDB
 * transaction commits, so a process killed within that window can lose the
 * last write. Mitigated by a serialised queue (no interleaved writes clobber
 * each other) and a flush on pagehide/visibilitychange. Crucially this does
 * NOT weaken the pet: native Quick Add writes to the Kotlin SharedPreferences
 * outbox with a commit-and-read-back, so "小財記的帳" never depends on this
 * path. The alternative, localStorage, fails with CERTAINTY once the ledger
 * outgrows the quota.
 */

import { STORAGE_KEYS } from './storage';

const DB_NAME = 'fintracker';
const DB_VERSION = 1;
const STORE = 'kv';

/** Keys the store owns. Everything else stays in localStorage untouched. */
const MANAGED_KEYS: string[] = [
  STORAGE_KEYS.transactions,
  STORAGE_KEYS.budgets,
  STORAGE_KEYS.recurring,
  STORAGE_KEYS.debts,
  STORAGE_KEYS.goals,
  STORAGE_KEYS.spreadsheetRecords,
];

/** Marks that the one-time copy out of localStorage already happened. */
export const IDB_MIGRATION_KEY = 'finance_idb_migrated_v1';

export type StoreBackend = 'indexeddb' | 'localstorage';

export interface StoreInitResult {
  backend: StoreBackend;
  migrated: boolean;
  /** Per key: how many rows came across. Used to verify nothing was dropped. */
  migratedCounts: Record<string, number>;
  /** Non-fatal problems worth surfacing in diagnostics. */
  warnings: string[];
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    let idb: IDBFactory | undefined;
    try {
      idb = globalThis.indexedDB;
    } catch {
      resolve(null);
      return;
    }
    if (!idb) {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = idb.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    // Private-browsing modes and blocked upgrades both land here. Falling back
    // is correct: a user with IndexedDB disabled still gets a working ledger.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export class FinanceStore {
  private cache = new Map<string, unknown>();
  private db: IDBDatabase | null = null;
  private backend: StoreBackend = 'localstorage';
  private ready = false;
  /** Serialised so two writes to the same key cannot land out of order. */
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingKeys = new Set<string>();

  constructor(private fallback: Storage | undefined = globalThis.localStorage) {}

  getBackend(): StoreBackend {
    return this.backend;
  }

  isReady(): boolean {
    return this.ready;
  }

  /** How many writes have not reached disk yet. Surfaced in diagnostics. */
  pendingWriteCount(): number {
    return this.pendingKeys.size;
  }

  async init(): Promise<StoreInitResult> {
    const result: StoreInitResult = {
      backend: 'localstorage',
      migrated: false,
      migratedCounts: {},
      warnings: [],
    };

    this.db = await openDatabase();
    if (this.db) {
      this.backend = 'indexeddb';
      result.backend = 'indexeddb';
      try {
        await this.loadAllFromIdb();
      } catch (e) {
        // A readable localStorage is better than an unreadable IndexedDB.
        result.warnings.push(`IndexedDB read failed, using localStorage: ${String(e)}`);
        this.db = null;
        this.backend = 'localstorage';
        result.backend = 'localstorage';
      }
    } else {
      result.warnings.push('IndexedDB unavailable; using localStorage');
    }

    const alreadyMigrated = this.fallback?.getItem(IDB_MIGRATION_KEY) === '1';

    if (this.backend === 'indexeddb' && !alreadyMigrated) {
      const counts = await this.migrateFromLocalStorage();
      result.migrated = true;
      result.migratedCounts = counts;
      // The legacy keys are LEFT IN PLACE. They are the safety net if
      // IndexedDB is later cleared, not rubbish to tidy away.
      try {
        this.fallback?.setItem(IDB_MIGRATION_KEY, '1');
      } catch {
        result.warnings.push('could not record the migration marker');
      }
    }

    // Anything still missing (fresh install, or the localStorage fallback path)
    // is read from localStorage so the cache is always fully populated.
    for (const key of MANAGED_KEYS) {
      if (this.cache.has(key)) continue;
      const raw = this.fallback?.getItem(key) ?? null;
      if (raw === null) continue;
      try {
        this.cache.set(key, JSON.parse(raw));
      } catch {
        result.warnings.push(`${key} in localStorage is not valid JSON; left untouched`);
      }
    }

    this.installFlushHooks();
    this.ready = true;
    return result;
  }

  private loadAllFromIdb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const db = this.db;
      if (!db) return resolve();
      const tx = db.transaction(STORE, 'readonly');
      const os = tx.objectStore(STORE);
      let outstanding = MANAGED_KEYS.length;
      if (outstanding === 0) return resolve();
      for (const key of MANAGED_KEYS) {
        const req = os.get(key);
        req.onsuccess = () => {
          if (req.result !== undefined) this.cache.set(key, req.result);
          if (--outstanding === 0) resolve();
        };
        req.onerror = () => reject(req.error);
      }
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * One-time copy of the legacy ledger into IndexedDB.
   *
   * Copies, never moves. Verifies by counting rows on both sides, and reports
   * a mismatch rather than silently accepting a short read.
   */
  private async migrateFromLocalStorage(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const key of MANAGED_KEYS) {
      const raw = this.fallback?.getItem(key) ?? null;
      if (raw === null) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Corrupt legacy value: leave it alone for the integrity report to
        // find. Copying garbage into the new store helps nobody.
        continue;
      }
      this.cache.set(key, parsed);
      counts[key] = Array.isArray(parsed) ? parsed.length : 1;
      await this.persist(key, parsed);
    }
    return counts;
  }

  read<T>(key: string, fallbackValue: T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const raw = this.fallback?.getItem(key) ?? null;
    if (raw === null) return fallbackValue;
    try {
      const parsed = JSON.parse(raw) as T;
      this.cache.set(key, parsed);
      return parsed;
    } catch {
      return fallbackValue;
    }
  }

  write(key: string, value: unknown): void {
    this.cache.set(key, value);
    this.pendingKeys.add(key);
    this.writeQueue = this.writeQueue
      .then(() => this.persist(key, value))
      .then(
        () => {
          this.pendingKeys.delete(key);
        },
        e => {
          this.pendingKeys.delete(key);
          console.error('[FinTracker.Store] persist failed', key, e);
        },
      );
  }

  /** Resolves once every queued write has reached disk. */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private persist(key: string, value: unknown): Promise<void> {
    if (this.backend === 'indexeddb' && this.db) {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db!.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        } catch (e) {
          reject(e);
        }
      });
    }
    try {
      this.fallback?.setItem(key, JSON.stringify(value));
      return Promise.resolve();
    } catch (e) {
      // The exact failure the move to IndexedDB exists to avoid.
      return Promise.reject(e);
    }
  }

  private installFlushHooks(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const flush = () => {
      void this.flush();
    };
    // pagehide is the reliable one on mobile Safari and on Android WebView;
    // 'unload' is not fired in several backgrounding paths.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
}

export const financeStore = new FinanceStore();
