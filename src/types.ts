export type TransactionType = 'income' | 'expense';
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface BudgetConfig {
  amount: number;
  alertEnabled: boolean;
  alertThreshold: number; // Percentage 0-100
}

/** The four ids every existing ledger already contains. */
export type LegacyPaymentMethod = 'cash' | 'credit' | 'bank' | 'mobile';

/**
 * Payment method id. The legacy four keep autocomplete; the widened string
 * lets the registry add instruments like 悠遊卡 / LINE Pay without a schema
 * migration (stored values were always plain strings).
 */
export type PaymentMethod = LegacyPaymentMethod | (string & {});

export const PAYMENT_METHODS: Record<LegacyPaymentMethod, string> = {
  cash: '現金',
  credit: '信用卡',
  bank: '銀行轉帳',
  mobile: '行動支付'
};

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  /** Stored as the zh-TW label (legacy shape); see categoryCatalog for the stable id. */
  category: string;
  /** Local calendar date key, YYYY-MM-DD — always produced by getLocalDateKey. */
  date: string;
  note: string;
  paymentMethod?: PaymentMethod;
  linkedDebtId?: string;
  linkedGoalId?: string;

  // --- optional metadata; all additive so existing ledgers stay valid ---
  /** Stable category id captured at write time (labels can be renamed later). */
  categoryId?: string;
  /** Where the entry came from: 'web' | 'pet_quick_add' | 'pet_voice' | 'recurring'. */
  source?: string;
  /** Creation instant (ISO); the `date` field remains the accounting date. */
  createdAt?: string;
  /** Reserved for future multi-currency; absent means TWD. */
  currency?: string;
  /**
   * How much was ACTUALLY applied to the linked debt/goal. Balances clamp at
   * zero, so without this a delete could not restore the previous balance
   * exactly. Absent on legacy rows — those fall back to `amount`.
   */
  linkedDebtApplied?: number;
  linkedGoalApplied?: number;

  // --- cloud sync metadata; all optional so legacy rows stay valid ---
  /**
   * When this row was last edited ON A DEVICE. Merge compares this, not the
   * server's write time: an offline edit made at 09:00 and pushed at 18:00
   * must not beat an online edit made at 17:00.
   */
  updatedAt?: string;
  /**
   * Tombstone. A deleted row keeps travelling, because removing it outright
   * looks identical to "not synced yet" on another device — which is how
   * deleted transactions come back from the dead.
   */
  deletedAt?: string | null;
  /** Which installation produced the current version; breaks merge ties. */
  deviceId?: string;
  /** When the cloud last confirmed this row. Older than updatedAt = dirty. */
  syncedAt?: string;
}

export interface RecurringTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  frequency: Frequency;
  startDate: string;
  nextDate: string;
  note: string;
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: '每天',
  weekly: '每週',
  monthly: '每月',
  yearly: '每年',
};

export type DebtType = 'credit_card' | 'mortgage' | 'auto_loan' | 'student_loan' | 'personal_loan' | 'other';

export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  credit_card: '信用卡債',
  mortgage: '房屋貸款',
  auto_loan: '汽車貸款',
  student_loan: '學生貸款',
  personal_loan: '個人信貸',
  other: '其他負債'
};

export interface Debt {
  id: string;
  name: string;
  type?: DebtType;
  amount: number;
  initialAmount?: number;
  interestRate: number;
  monthlyPayment?: number;
  dueDate: string;
  note: string;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
}

export interface SpreadsheetRecord {
  id: string;
  period: string; // e.g. '2023-01' or user defined string
  assets: number;
  liabilities: number;
  note: string;
}

export const CATEGORIES = {
  income: ['薪資收入', '投資理財', '零星獎金', '其他收入', 'Investments'],
  expense: ['餐飲美食', '交通出行', '休閒娛樂', '購物消費', '居家生活', '水電網費', '醫療保健', '學習進修', '負債償還', '其他支出', 'Loan Repayments'],
};
