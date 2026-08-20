import { Transaction } from '../types';

/**
 * Deletion semantics, in a module with no dependencies.
 *
 * Both the storage layer and the analytics engine need to agree on what
 * "deleted" means, and neither should have to import the other to find out —
 * pulling FinanceRepository into the analytics graph would drag IndexedDB
 * along with it, into a module that also runs server-side.
 */

/** How long a tombstone has to survive so every device can hear about it. */
export const TOMBSTONE_RETENTION_DAYS = 180;

/** A row the user deleted. It stays on disk so the deletion itself can sync. */
export function isTombstoned(t: Transaction | undefined | null): boolean {
  if (!t) return false;
  const deletedAt = (t as Transaction & { deletedAt?: string | null }).deletedAt;
  return deletedAt != null && deletedAt !== '';
}
