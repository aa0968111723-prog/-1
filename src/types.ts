export type TransactionType = 'income' | 'expense';
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface BudgetConfig {
  amount: number;
  alertEnabled: boolean;
  alertThreshold: number; // Percentage 0-100
}

export type PaymentMethod = 'cash' | 'credit' | 'bank' | 'mobile';

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: '現金',
  credit: '信用卡',
  bank: '銀行轉帳',
  mobile: '行動支付'
};

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  note: string;
  paymentMethod?: PaymentMethod;
  linkedDebtId?: string;
  linkedGoalId?: string;
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

export interface Debt {
  id: string;
  name: string;
  amount: number;
  interestRate: number;
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

export const CATEGORIES = {
  income: ['薪資收入', '投資理財', '零星獎金', '其他收入', 'Investments'],
  expense: ['餐飲美食', '交通出行', '休閒娛樂', '購物消費', '居家生活', '水電網費', '醫療保健', '學習進修', '負債償還', '其他支出', 'Loan Repayments'],
};
