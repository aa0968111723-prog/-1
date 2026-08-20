import { formatMoney } from './money';
import { parseLocalDateKey } from './datetime';

/**
 * Historic entry point kept so existing screens don't churn; the single
 * implementation now lives in money.formatMoney ("NT$ 1,280").
 */
export const formatCurrency = (amount: number): string => formatMoney(amount);

/**
 * Renders a stored YYYY-MM-DD key. Parsed as a LOCAL date: `new Date('2026-08-19')`
 * is UTC midnight, which renders as the previous day in any negative-offset
 * timezone.
 */
export const formatDate = (dateString: string): string => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ? parseLocalDateKey(dateString)
    : new Date(dateString);
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};
