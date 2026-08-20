import { FinanceSyncEngine } from './syncEngine';
import { financeRepository } from '../financeRepository';

/**
 * The one sync engine.
 *
 * It used to be constructed inside AccountPanel, which put the whole sync
 * lifecycle inside a settings component: the triggers (sign-in, foreground,
 * network back) were that component's effects, so syncing only happened while
 * the user had the account screen open — and that screen now sits behind the
 * 小財 tab's 進階設定, in a lazily-loaded chunk. "Sync runs while you are
 * looking at the sync settings" is indistinguishable from sync being broken.
 *
 * A module singleton also means the pending count and last-sync time are the
 * same numbers everywhere, instead of resetting each time the panel mounts.
 */
export const financeSync = new FinanceSyncEngine(financeRepository);
