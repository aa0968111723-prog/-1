/**
 * Storage layer for FinTracker.
 *
 * All finance data lives in localStorage under the legacy `finance_*` keys.
 * This module is the single place that knows those key names, and it owns
 * the storage schema version + migration pipeline so an app update can
 * never silently wipe an existing ledger.
 */

export const STORAGE_KEYS = {
  transactions: 'finance_transactions',
  budgets: 'finance_budgets',
  recurring: 'finance_recurring',
  debts: 'finance_debts',
  goals: 'finance_goals',
  spreadsheetRecords: 'finance_spreadsheet_records',
  monthlyIncome: 'finance_monthly_income',
  txDefaults: 'fintracker_tx_defaults',
  petSettings: 'finance_pet_settings',
  pinnedCategories: 'finance_pinned_categories',
  customCategories: 'finance_custom_categories',
  paymentMethodPrefs: 'finance_payment_methods',
  integrityReport: 'finance_integrity_report',
  storageVersion: 'finance_storage_version',
  migrationLog: 'finance_migration_log',
  importSafetyBackup: 'finance_backup_before_import',
} as const;

export const CURRENT_STORAGE_VERSION = 1;

const JSON_ARRAY_KEYS: string[] = [
  STORAGE_KEYS.transactions,
  STORAGE_KEYS.recurring,
  STORAGE_KEYS.debts,
  STORAGE_KEYS.goals,
  STORAGE_KEYS.spreadsheetRecords,
];

const JSON_OBJECT_KEYS: string[] = [
  STORAGE_KEYS.budgets,
  STORAGE_KEYS.txDefaults,
  STORAGE_KEYS.petSettings,
];

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  repairedKeys: string[];
  backedUpKeys: string[];
}

function isStorageLike(storage: Storage | undefined | null): storage is Storage {
  return !!storage && typeof storage.getItem === 'function';
}

/**
 * Validates and (only when corrupted) repairs a single JSON key.
 * A corrupted value is never deleted: the raw string is copied to
 * `<key>__backup_v<version>` before the key is reset, so nothing is lost.
 */
function validateJsonKey(
  storage: Storage,
  key: string,
  expectArray: boolean,
  fromVersion: number,
  result: MigrationResult,
): void {
  const raw = storage.getItem(key);
  if (raw === null) return;
  try {
    const parsed = JSON.parse(raw);
    const ok = expectArray ? Array.isArray(parsed) : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    if (ok) return;
  } catch {
    // fall through to repair
  }
  storage.setItem(`${key}__backup_v${fromVersion}`, raw);
  storage.setItem(key, expectArray ? '[]' : '{}');
  result.backedUpKeys.push(key);
  result.repairedKeys.push(key);
}

/**
 * Runs the storage migration pipeline. Must be called before any code
 * reads finance data. Idempotent: once the stored version matches
 * CURRENT_STORAGE_VERSION this is a no-op.
 */
export function runStorageMigration(storage: Storage | undefined = globalThis.localStorage): MigrationResult {
  const result: MigrationResult = {
    fromVersion: 0,
    toVersion: CURRENT_STORAGE_VERSION,
    repairedKeys: [],
    backedUpKeys: [],
  };
  if (!isStorageLike(storage)) return result;

  const rawVersion = storage.getItem(STORAGE_KEYS.storageVersion);
  const fromVersion = rawVersion !== null && !Number.isNaN(Number(rawVersion)) ? Number(rawVersion) : 0;
  result.fromVersion = fromVersion;
  if (fromVersion >= CURRENT_STORAGE_VERSION) {
    result.toVersion = fromVersion;
    return result;
  }

  // v0 -> v1: legacy unversioned data. Validate every known key; back up and
  // reset only keys whose JSON is unreadable. Valid data passes through untouched.
  if (fromVersion < 1) {
    for (const key of JSON_ARRAY_KEYS) validateJsonKey(storage, key, true, fromVersion, result);
    for (const key of JSON_OBJECT_KEYS) validateJsonKey(storage, key, false, fromVersion, result);
    const income = storage.getItem(STORAGE_KEYS.monthlyIncome);
    if (income !== null && Number.isNaN(Number(income))) {
      storage.setItem(`${STORAGE_KEYS.monthlyIncome}__backup_v${fromVersion}`, income);
      storage.setItem(STORAGE_KEYS.monthlyIncome, '0');
      result.backedUpKeys.push(STORAGE_KEYS.monthlyIncome);
      result.repairedKeys.push(STORAGE_KEYS.monthlyIncome);
    }
  }

  // Future migrations chain here: if (fromVersion < 2) { ... }

  storage.setItem(STORAGE_KEYS.storageVersion, String(CURRENT_STORAGE_VERSION));
  appendMigrationLog(storage, result);
  return result;
}

/** Append-only, size-bounded log so migration history is auditable. */
function appendMigrationLog(storage: Storage, result: MigrationResult): void {
  try {
    const log = loadJSON<unknown[]>(STORAGE_KEYS.migrationLog, [], storage);
    const entries = Array.isArray(log) ? log : [];
    entries.push({
      at: new Date().toISOString(),
      from: result.fromVersion,
      to: result.toVersion,
      repairedKeys: result.repairedKeys,
    });
    saveJSON(STORAGE_KEYS.migrationLog, entries.slice(-20), storage);
  } catch {
    // logging must never block a migration
  }
}

export function loadJSON<T>(key: string, fallback: T, storage: Storage | undefined = globalThis.localStorage): T {
  if (!isStorageLike(storage)) return fallback;
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(`Failed to parse ${key}`);
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown, storage: Storage | undefined = globalThis.localStorage): void {
  if (!isStorageLike(storage)) return;
  storage.setItem(key, JSON.stringify(value));
}
