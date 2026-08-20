/**
 * PaymentMethodRegistry.
 *
 * The four legacy ids (cash/credit/bank/mobile) are what existing ledgers
 * contain and are never removed. Taiwan-specific instruments (悠遊卡, LINE
 * Pay, 街口…) are added alongside them, and the user chooses which ones are
 * visible and in what order — nobody carries every payment method, and a
 * quick-add row with eight chips is slower than one with three.
 */

import { PaymentMethod, PAYMENT_METHODS as LEGACY_LABELS } from '../types';
import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export interface PaymentMethodDef {
  id: PaymentMethod;
  label: string;
  emoji: string;
  /** Built-ins cannot be deleted, only hidden. */
  builtIn: boolean;
}

/** Everything the app knows about, in a sensible default order. */
export const ALL_PAYMENT_METHODS: PaymentMethodDef[] = [
  { id: 'cash', label: LEGACY_LABELS.cash, emoji: '💵', builtIn: true },
  { id: 'easycard', label: '悠遊卡', emoji: '🚇', builtIn: true },
  { id: 'credit', label: LEGACY_LABELS.credit, emoji: '💳', builtIn: true },
  { id: 'debit', label: '金融卡', emoji: '🏧', builtIn: true },
  { id: 'linepay', label: 'LINE Pay', emoji: '📱', builtIn: true },
  { id: 'jkopay', label: '街口支付', emoji: '🟠', builtIn: true },
  { id: 'wallet', label: '手機錢包', emoji: '⌚', builtIn: true },
  { id: 'mobile', label: LEGACY_LABELS.mobile, emoji: '📲', builtIn: true },
  { id: 'bank', label: LEGACY_LABELS.bank, emoji: '🏦', builtIn: true },
  { id: 'other', label: '其他', emoji: '🧾', builtIn: true },
];

/** Shown until the user customises anything — deliberately short. */
export const DEFAULT_ENABLED_PAYMENT_IDS: PaymentMethod[] = ['cash', 'easycard', 'credit', 'linepay'];

export interface PaymentMethodPrefs {
  /** Ordered list of enabled ids. */
  enabled: PaymentMethod[];
}

export function loadPaymentPrefs(storage: Storage | undefined = globalThis.localStorage): PaymentMethodPrefs {
  const raw = loadJSON<Partial<PaymentMethodPrefs>>(STORAGE_KEYS.paymentMethodPrefs, {}, storage);
  const enabled = Array.isArray(raw.enabled)
    ? raw.enabled.filter(id => typeof id === 'string' && ALL_PAYMENT_METHODS.some(m => m.id === id))
    : [];
  return { enabled: enabled.length > 0 ? enabled : [...DEFAULT_ENABLED_PAYMENT_IDS] };
}

export function savePaymentPrefs(prefs: PaymentMethodPrefs, storage: Storage | undefined = globalThis.localStorage): void {
  saveJSON(STORAGE_KEYS.paymentMethodPrefs, prefs, storage);
}

/** The methods to show in pickers, in the user's order. */
export function listEnabledPaymentMethods(
  storage: Storage | undefined = globalThis.localStorage,
): PaymentMethodDef[] {
  const { enabled } = loadPaymentPrefs(storage);
  const byId = new Map(ALL_PAYMENT_METHODS.map(m => [m.id, m]));
  return enabled.map(id => byId.get(id)).filter((m): m is PaymentMethodDef => !!m);
}

/**
 * Label for a stored value. Always resolves — a method the user later hid
 * still renders correctly on old transactions.
 */
export function paymentMethodLabel(id: PaymentMethod | undefined): string {
  if (!id) return '';
  return ALL_PAYMENT_METHODS.find(m => m.id === id)?.label ?? String(id);
}

export function togglePaymentMethod(
  id: PaymentMethod,
  storage: Storage | undefined = globalThis.localStorage,
): PaymentMethodPrefs {
  const prefs = loadPaymentPrefs(storage);
  const next = prefs.enabled.includes(id)
    ? prefs.enabled.filter(m => m !== id)
    : [...prefs.enabled, id];
  // Never let the picker become empty.
  const result: PaymentMethodPrefs = { enabled: next.length > 0 ? next : [...DEFAULT_ENABLED_PAYMENT_IDS] };
  savePaymentPrefs(result, storage);
  return result;
}

export function movePaymentMethod(
  id: PaymentMethod,
  direction: -1 | 1,
  storage: Storage | undefined = globalThis.localStorage,
): PaymentMethodPrefs {
  const prefs = loadPaymentPrefs(storage);
  const index = prefs.enabled.indexOf(id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= prefs.enabled.length) return prefs;
  const enabled = [...prefs.enabled];
  [enabled[index], enabled[target]] = [enabled[target], enabled[index]];
  const result = { enabled };
  savePaymentPrefs(result, storage);
  return result;
}
