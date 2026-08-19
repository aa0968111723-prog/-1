/**
 * Startup data-integrity check.
 *
 * This module DIAGNOSES, it never repairs. [checkIntegrity] is a pure
 * function: it reads the arrays it is handed and returns a report, and it
 * MUST NOT mutate, reorder, drop or rewrite a single record.
 * [runIntegrityCheck] only READS the ledger through FinanceRepository and
 * WRITES the resulting report to its own storage key — no code path here
 * deletes or edits a transaction, a debt or a goal. A ledger that fails the
 * check keeps every byte it had; fixing it is always the user's call.
 *
 * Privacy: the report may be surfaced in a diagnostics panel (and pasted into
 * a support message), so `detail` strings carry only counts, positions and
 * transaction ids — never amounts, notes, or category labels.
 */

import { Debt, Goal, Transaction } from '../types';
import { isValidDateKey } from './datetime';
import { MAX_TRANSACTION_AMOUNT } from './money';
import { FinanceRepository } from './financeRepository';
import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export type IntegrityIssueKind =
  | 'duplicate_id'
  | 'invalid_amount'
  | 'missing_type'
  | 'invalid_date'
  | 'unknown_category'
  | 'orphan_link';

export interface IntegrityIssue {
  kind: IntegrityIssueKind;
  /** Transaction id, when the offending record has a usable one. */
  id?: string;
  /** Short zh-TW description. Never contains amounts, notes or labels. */
  detail: string;
}

export interface IntegrityReport {
  /** ISO instant the check ran. */
  checkedAt: string;
  transactionCount: number;
  issues: IntegrityIssue[];
  ok: boolean;
}

export interface IntegrityInput {
  transactions: readonly Transaction[];
  debts: readonly Debt[];
  goals: readonly Goal[];
}

function asArray<T>(value: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function idSet(items: readonly { id?: unknown }[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item && typeof item.id === 'string' && item.id !== '') ids.add(item.id);
  }
  return ids;
}

/** A stable id, or undefined when the record has none we can quote. */
function usableId(tx: Transaction | undefined): string | undefined {
  const id = tx?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** Where an unidentifiable record sits, so the user can still find it. */
function positionHint(index: number): string {
  return `（第 ${index + 1} 筆）`;
}

/**
 * Pure diagnostic pass over the ledger. Returns what looks wrong; changes
 * nothing. Runs in a single O(n) sweep so it stays cheap at startup.
 */
export function checkIntegrity(input: IntegrityInput): IntegrityReport {
  const transactions = asArray(input?.transactions);
  const debtIds = idSet(asArray(input?.debts));
  const goalIds = idSet(asArray(input?.goals));
  const issues: IntegrityIssue[] = [];

  // --- duplicate ids: counted first so each duplicated id is reported once ---
  const idCounts = new Map<string, number>();
  for (const tx of transactions) {
    const id = usableId(tx);
    if (id === undefined) continue;
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      issues.push({ kind: 'duplicate_id', id, detail: `有 ${count} 筆記錄共用同一個 ID` });
    }
  }

  // --- per-record field checks ---
  for (let i = 0; i < transactions.length; i += 1) {
    const tx = transactions[i];
    const id = usableId(tx);
    const where = id === undefined ? positionHint(i) : '';

    if (!tx || typeof tx !== 'object') {
      issues.push({ kind: 'missing_type', detail: `記錄格式不正確${positionHint(i)}` });
      continue;
    }

    const amount = tx.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX_TRANSACTION_AMOUNT) {
      issues.push({ kind: 'invalid_amount', ...(id ? { id } : {}), detail: `金額不是有效的正數，或超出可記帳上限${where}` });
    }

    if (tx.type !== 'income' && tx.type !== 'expense') {
      issues.push({ kind: 'missing_type', ...(id ? { id } : {}), detail: `記錄沒有收入／支出類型${where}` });
    }

    if (!isValidDateKey(tx.date)) {
      issues.push({ kind: 'invalid_date', ...(id ? { id } : {}), detail: `日期不是有效的 YYYY-MM-DD${where}` });
    }

    if (typeof tx.category !== 'string' || tx.category.trim() === '') {
      issues.push({ kind: 'unknown_category', ...(id ? { id } : {}), detail: `記錄沒有可辨識的分類${where}` });
    }

    // Orphan links are EXPECTED after deleting a debt or goal — the ledger
    // keeps the record on purpose, so the wording stays informational.
    if (typeof tx.linkedDebtId === 'string' && tx.linkedDebtId !== '' && !debtIds.has(tx.linkedDebtId)) {
      issues.push({
        kind: 'orphan_link',
        ...(id ? { id } : {}),
        detail: `連結的負債已不存在，記錄本身完好${where}（刪除負債後屬正常情形）`,
      });
    }
    if (typeof tx.linkedGoalId === 'string' && tx.linkedGoalId !== '' && !goalIds.has(tx.linkedGoalId)) {
      issues.push({
        kind: 'orphan_link',
        ...(id ? { id } : {}),
        detail: `連結的目標已不存在，記錄本身完好${where}（刪除目標後屬正常情形）`,
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    transactionCount: transactions.length,
    issues,
    ok: issues.length === 0,
  };
}

/**
 * Reads the ledger, runs the pure check, and stores the report under
 * STORAGE_KEYS.integrityReport. The only write is the report itself.
 */
export function runIntegrityCheck(storage: Storage | undefined = globalThis.localStorage): IntegrityReport {
  const repository = new FinanceRepository(storage);
  const report = checkIntegrity({
    transactions: repository.getTransactions(),
    debts: repository.getDebts(),
    goals: repository.getGoals(),
  });
  saveJSON(STORAGE_KEYS.integrityReport, report, storage);
  return report;
}

/** The last stored report, or null when there is none / it is unreadable. */
export function loadIntegrityReport(
  storage: Storage | undefined = globalThis.localStorage,
): IntegrityReport | null {
  const raw = loadJSON<unknown>(STORAGE_KEYS.integrityReport, null, storage);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<IntegrityReport>;
  if (typeof candidate.checkedAt !== 'string' || !Array.isArray(candidate.issues)) return null;
  return {
    checkedAt: candidate.checkedAt,
    transactionCount: typeof candidate.transactionCount === 'number' ? candidate.transactionCount : 0,
    issues: candidate.issues as IntegrityIssue[],
    ok: candidate.ok === true,
  };
}
