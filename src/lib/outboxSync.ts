/**
 * Draining the native outbox into the ledger.
 *
 * This lives outside the React tree because the ORDER of operations is the
 * entire data-safety guarantee, and an ordering guarantee deserves a test
 * that does not depend on rendering:
 *
 *   1. persist each entry (idempotent on the id the native side generated)
 *   2. verify it is actually in storage
 *   3. only then acknowledge it, so the outbox may forget it
 *
 * A crash at any point can therefore only cause a replay, which step 1
 * absorbs. Acking before persisting — the previous behaviour — could lose an
 * entry outright if the process died in between.
 */

import { FinanceRepository } from './financeRepository';
import { PendingNativeTransaction, pendingToTransaction } from './petBridge';

export interface OutboxPort {
  getPendingTransactions(): Promise<{ transactions: PendingNativeTransaction[] }>;
  ackPendingTransactions(options: { ids: string[] }): Promise<void>;
}

export interface DrainResult {
  /** Entries confirmed in storage and acknowledged. */
  importedIds: string[];
  /** Entries that could not be persisted; they stay in the outbox for a retry. */
  failedIds: string[];
}

export async function drainOutbox(
  port: OutboxPort,
  repository: FinanceRepository,
): Promise<DrainResult> {
  const { transactions: pending } = await port.getPendingTransactions();
  const importedIds: string[] = [];
  const failedIds: string[] = [];
  if (pending.length === 0) return { importedIds, failedIds };

  for (const entry of pending) {
    const tx = pendingToTransaction(entry);
    try {
      repository.addTransaction(tx);
      if (repository.hasTransaction(tx.id)) importedIds.push(tx.id);
      else failedIds.push(tx.id);
    } catch (e) {
      console.error('[FinancePet.Sync] failed to persist pet transaction', e);
      failedIds.push(tx.id);
    }
  }

  // Only the confirmed ones. A failed entry stays in the outbox on purpose.
  if (importedIds.length > 0) {
    await port.ackPendingTransactions({ ids: importedIds });
  }
  return { importedIds, failedIds };
}
