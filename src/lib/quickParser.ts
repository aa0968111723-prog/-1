/**
 * Deterministic natural-language quick-entry parser.
 *
 * Turns strings like「午餐120」or「捷運50悠遊卡」into a transaction draft
 * using regex + keyword maps only. No AI call is involved; AI is reserved
 * as an optional fallback the caller may layer on top when this parser
 * reports low confidence.
 */

import { TransactionType, PaymentMethod, CATEGORIES } from '../types';

export interface ParsedQuickEntry {
  type: TransactionType;
  amount: number | null;
  category: string;
  note: string;
  paymentMethod?: PaymentMethod;
  /** 'high' when both an amount and a category keyword matched. */
  confidence: 'high' | 'medium' | 'low';
}

const EXPENSE_KEYWORDS: Array<{ category: string; words: string[] }> = [
  { category: '餐飲美食', words: ['早餐', '午餐', '晚餐', '宵夜', '便當', '吃飯', '聚餐', '飯', '麵', '壽司', '火鍋', '餐廳', '小吃', '滷味', '雞排', '飲料', '手搖', '咖啡', '奶茶', '珍奶', '紅茶', '綠茶', '拿鐵', '星巴克', '吃'] },
  { category: '交通出行', words: ['捷運', '公車', '客運', '火車', '高鐵', '計程車', 'Uber', 'uber', '加油', '油錢', '停車', '機車', '通勤', '車票', '交通'] },
  { category: '購物消費', words: ['購物', '網購', '蝦皮', '淘寶', '衣服', '鞋子', '包包', '買'] },
  { category: '休閒娛樂', words: ['電影', '遊戲', '課金', 'KTV', 'ktv', '唱歌', '娛樂', '訂閱', 'Netflix', 'netflix', 'Spotify', 'spotify'] },
  { category: '居家生活', words: ['日用品', '衛生紙', '洗衣', '家具', '房租', '租金'] },
  { category: '水電網費', words: ['水費', '電費', '瓦斯', '網路費', '電話費', '手機費'] },
  { category: '醫療保健', words: ['看醫生', '掛號', '藥', '診所', '醫院', '保健'] },
  { category: '學習進修', words: ['書', '課程', '補習', '學費', '文具'] },
];

const INCOME_KEYWORDS: Array<{ category: string; words: string[] }> = [
  { category: '薪資收入', words: ['薪水', '薪資', '月薪', '發薪'] },
  { category: '零星獎金', words: ['獎金', '紅包', '中獎', '回饋'] },
  { category: '投資理財', words: ['股息', '配息', '利息', '投資獲利'] },
  { category: '其他收入', words: ['收入', '入帳', '退款', '賣'] },
];

const PAYMENT_KEYWORDS: Array<{ method: PaymentMethod; words: string[] }> = [
  { method: 'mobile', words: ['悠遊卡', '一卡通', 'LinePay', 'linepay', 'Line Pay', '街口', 'Apple Pay', 'applepay', '行動支付'] },
  { method: 'credit', words: ['刷卡', '信用卡'] },
  { method: 'bank', words: ['轉帳', '匯款'] },
  { method: 'cash', words: ['現金', '付現'] },
];

/** Matches the first standalone number, with optional thousands commas / decimals. */
const AMOUNT_RE = /(?:NT\$|\$|nt\$)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(?:元|塊|圓)?/;

export function parseQuickEntry(input: string): ParsedQuickEntry {
  const text = input.trim();

  let amount: number | null = null;
  const amountMatch = text.match(AMOUNT_RE);
  let noteText = text;
  if (amountMatch) {
    amount = Number(amountMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) amount = null;
    else noteText = (text.slice(0, amountMatch.index) + ' ' + text.slice((amountMatch.index ?? 0) + amountMatch[0].length)).trim();
  }

  let paymentMethod: PaymentMethod | undefined;
  for (const { method, words } of PAYMENT_KEYWORDS) {
    const hit = words.find(w => noteText.includes(w));
    if (hit) {
      paymentMethod = method;
      break;
    }
  }

  let type: TransactionType = 'expense';
  let category = '';
  for (const { category: cat, words } of INCOME_KEYWORDS) {
    if (words.some(w => noteText.includes(w))) {
      type = 'income';
      category = cat;
      break;
    }
  }
  if (!category) {
    for (const { category: cat, words } of EXPENSE_KEYWORDS) {
      if (words.some(w => noteText.includes(w))) {
        category = cat;
        break;
      }
    }
  }

  const matchedCategory = category !== '';
  if (!category) category = CATEGORIES.expense[CATEGORIES.expense.length - 1] === 'Loan Repayments'
    ? '其他支出'
    : CATEGORIES.expense[0];
  if (!matchedCategory) category = '其他支出';

  const note = noteText.replace(/\s+/g, ' ').trim();

  let confidence: ParsedQuickEntry['confidence'] = 'low';
  if (amount !== null && matchedCategory) confidence = 'high';
  else if (amount !== null || matchedCategory) confidence = 'medium';

  return { type, amount, category, note, paymentMethod, confidence };
}
