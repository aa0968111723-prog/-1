/**
 * Deterministic natural-language quick-entry parser.
 *
 * Turns strings like「午餐120」or「捷運50悠遊卡」into a transaction draft
 * using regex + keyword maps only. The keyword maps live in
 * shared/pet-shared-config.json — the exact same config the Android quick
 * add ships as an asset — so web and native never drift. No AI call is
 * involved; AI is reserved as an optional fallback the caller may layer on
 * top when this parser reports low confidence.
 */

import sharedConfig from '../../shared/pet-shared-config.json';
import { TransactionType, PaymentMethod } from '../types';
import { labelForCategoryId } from './categoryCatalog';

export interface ParsedQuickEntry {
  type: TransactionType;
  amount: number | null;
  category: string;
  note: string;
  paymentMethod?: PaymentMethod;
  /** 'high' when both an amount and a category keyword matched. */
  confidence: 'high' | 'medium' | 'low';
}

const EXPENSE_KEYWORDS: Record<string, string[]> = sharedConfig.parser.expenseKeywords;
const INCOME_KEYWORDS: Record<string, string[]> = sharedConfig.parser.incomeKeywords;
const PAYMENT_KEYWORDS: Record<string, string[]> = sharedConfig.parser.paymentKeywords;

/** Matches the first standalone number, with optional thousands commas / decimals. */
const AMOUNT_RE = /(?:NT\$|\$|nt\$)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(?:元|塊|圓)?/;

/** 中文數字金額，例：一百二十、兩百五、三千。語音輸入常見。 */
const CN_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 萬: 10000 };
const CN_AMOUNT_RE = /([零一二兩三四五六七八九十百千萬]{1,10})\s*(?:元|塊|圓)/;

export function parseChineseNumber(text: string): number | null {
  let total = 0;
  let current = 0;
  let sawAny = false;
  for (const ch of text) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch];
      sawAny = true;
    } else if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch];
      if (current === 0) current = 1; // 十 = 10, 百五 handled below
      if (unit === 10000) {
        total = (total + current) * unit;
      } else {
        total += current * unit;
      }
      current = 0;
      sawAny = true;
    } else {
      return null;
    }
  }
  if (!sawAny) return null;
  // trailing digit like 兩百五 -> 250: scale by last unit / 10 heuristic
  if (current > 0 && total >= 100 && total % 100 === 0) {
    total += current * (total >= 1000 ? 100 : 10);
  } else {
    total += current;
  }
  return total > 0 ? total : null;
}

function matchKeyword(map: Record<string, string[]>, text: string): string | null {
  for (const [categoryId, words] of Object.entries(map)) {
    if (words.some(w => text.includes(w))) return categoryId;
  }
  return null;
}

export function parseQuickEntry(input: string): ParsedQuickEntry {
  const text = input.trim();

  let amount: number | null = null;
  let noteText = text;
  const amountMatch = text.match(AMOUNT_RE);
  if (amountMatch) {
    amount = Number(amountMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) amount = null;
    else noteText = (text.slice(0, amountMatch.index) + ' ' + text.slice((amountMatch.index ?? 0) + amountMatch[0].length)).trim();
  }
  if (amount === null) {
    const cnMatch = text.match(CN_AMOUNT_RE);
    if (cnMatch) {
      amount = parseChineseNumber(cnMatch[1]);
      if (amount !== null) {
        noteText = (text.slice(0, cnMatch.index) + ' ' + text.slice((cnMatch.index ?? 0) + cnMatch[0].length)).trim();
      }
    }
  }

  let paymentMethod: PaymentMethod | undefined;
  const paymentId = matchKeyword(PAYMENT_KEYWORDS, noteText);
  if (paymentId) paymentMethod = paymentId as PaymentMethod;

  let type: TransactionType = 'expense';
  let categoryId = matchKeyword(INCOME_KEYWORDS, noteText);
  if (categoryId) {
    type = 'income';
  } else {
    categoryId = matchKeyword(EXPENSE_KEYWORDS, noteText);
  }

  const matchedCategory = categoryId !== null;
  const category = labelForCategoryId(categoryId ?? 'other_expense');
  const note = noteText.replace(/\s+/g, ' ').trim();

  let confidence: ParsedQuickEntry['confidence'] = 'low';
  if (amount !== null && matchedCategory) confidence = 'high';
  else if (amount !== null || matchedCategory) confidence = 'medium';

  return { type, amount, category, note, paymentMethod, confidence };
}
