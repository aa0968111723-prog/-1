/**
 * Deterministic natural-language quick-entry parser (V2).
 *
 * Turns strings like「午餐120」「捷運50悠遊卡」「昨天晚餐180」「全聯850信用卡」
 * into a transaction draft using regex + keyword maps only. The maps live in
 * shared/pet-shared-config.json — the exact same config the Android quick add
 * bundles as an asset — so web and native can never drift.
 *
 * No AI is involved: quick add must work in airplane mode. A caller may layer
 * an AI fallback on a `low` confidence result, but must never let it overwrite
 * a confident deterministic parse, and must never auto-save a guess.
 */

import sharedConfig from '../../shared/pet-shared-config.json';
import { TransactionType, PaymentMethod } from '../types';
import { labelForCategoryId } from './categoryCatalog';
import { getLocalDateKey, addDaysKey, RELATIVE_DAY_KEYWORDS } from './datetime';
import { parseAmountInput } from './money';

export interface ParsedQuickEntry {
  type: TransactionType;
  amount: number | null;
  /** Stable category id, or null when we genuinely cannot tell. */
  categoryId: string | null;
  /** zh-TW label for the resolved category; '' when unknown. */
  category: string;
  note: string;
  paymentMethod?: PaymentMethod;
  /** Local date key; defaults to today, shifted by 昨天/前天 etc. */
  date: string;
  /** high = amount + category; medium = one of them; low = neither. */
  confidence: 'high' | 'medium' | 'low';
}

const EXPENSE_KEYWORDS: Record<string, string[]> = sharedConfig.parser.expenseKeywords;
const INCOME_KEYWORDS: Record<string, string[]> = sharedConfig.parser.incomeKeywords;
const PAYMENT_KEYWORDS: Record<string, string[]> = sharedConfig.parser.paymentKeywords;
const MERCHANT_KEYWORDS: Record<string, string[]> = sharedConfig.parser.merchantKeywords ?? {};
const CONVENIENCE_STORES: string[] = sharedConfig.parser.convenienceStoreKeywords ?? [];

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
      if (current === 0) current = 1;
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
  // trailing digit like 兩百五 -> 250
  if (current > 0 && total >= 100 && total % 100 === 0) {
    total += current * (total >= 1000 ? 100 : 10);
  } else {
    total += current;
  }
  return total > 0 ? total : null;
}

function matchKeyword(map: Record<string, string[]>, text: string): string | null {
  // Longest keyword first so 「信用卡」 beats 「刷」 and 「悠遊付」 beats 「悠遊卡」-less matches.
  let best: { id: string; length: number } | null = null;
  for (const [id, words] of Object.entries(map)) {
    for (const w of words) {
      if (text.includes(w) && (!best || w.length > best.length)) best = { id, length: w.length };
    }
  }
  return best?.id ?? null;
}

/** Strips a relative-day word, returning the resolved date key and the remaining text. */
function extractDate(text: string, now: Date): { date: string; rest: string } {
  for (const [word, offset] of Object.entries(RELATIVE_DAY_KEYWORDS)) {
    if (text.includes(word)) {
      return {
        date: offset === 0 ? getLocalDateKey(now) : addDaysKey(now, offset),
        rest: text.replace(word, ' '),
      };
    }
  }
  // 8/19 (this year, local). Only the slash form: "7-11" is a shop, not July 11.
  const md = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(now.getFullYear(), month - 1, day);
      return { date: getLocalDateKey(d), rest: text.replace(md[0], ' ') };
    }
  }
  return { date: getLocalDateKey(now), rest: text };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseQuickEntry(input: string, now: Date = new Date()): ParsedQuickEntry {
  const trimmed = input.trim();

  // Store names are masked out before any number parsing: "7-11 85" must not
  // be read as July 11 or as an amount of 7.
  const storeMatch = CONVENIENCE_STORES.find(s => trimmed.toLowerCase().includes(s.toLowerCase()));
  const masked = storeMatch
    ? trimmed.replace(new RegExp(escapeRegExp(storeMatch), 'i'), ' ')
    : trimmed;

  const { date, rest } = extractDate(masked, now);
  const text = rest;

  let amount: number | null = null;
  let noteText = text;
  const amountMatch = text.match(AMOUNT_RE);
  if (amountMatch) {
    amount = parseAmountInput(amountMatch[1]);
    if (amount !== null) {
      noteText = (text.slice(0, amountMatch.index) + ' ' + text.slice((amountMatch.index ?? 0) + amountMatch[0].length)).trim();
    }
  }
  if (amount === null) {
    const cnMatch = text.match(CN_AMOUNT_RE);
    if (cnMatch) {
      const value = parseChineseNumber(cnMatch[1]);
      amount = value === null ? null : parseAmountInput(String(value));
      if (amount !== null) {
        noteText = (text.slice(0, cnMatch.index) + ' ' + text.slice((cnMatch.index ?? 0) + cnMatch[0].length)).trim();
      }
    }
  }

  let paymentMethod: PaymentMethod | undefined;
  const paymentId = matchKeyword(PAYMENT_KEYWORDS, noteText);
  if (paymentId) paymentMethod = paymentId;

  let type: TransactionType = 'expense';
  let categoryId = matchKeyword(INCOME_KEYWORDS, noteText);
  if (categoryId) {
    type = 'income';
  } else {
    // Activity words first (午餐/捷運…), then merchant names (全聯/星巴克…).
    categoryId = matchKeyword(EXPENSE_KEYWORDS, noteText) ?? matchKeyword(MERCHANT_KEYWORDS, noteText);
  }

  // Convenience stores are genuinely ambiguous (a meal or shampoo), so the
  // merchant is kept as the note and the category is left unset rather than
  // guessed — the UI then asks 「分類：請選擇」 instead of mis-filing the entry.
  const note = [storeMatch ?? '', noteText].join(' ').replace(/\s+/g, ' ').trim();
  if (!categoryId && storeMatch && amount !== null) {
    return {
      type: 'expense',
      amount,
      categoryId: null,
      category: '',
      note,
      paymentMethod,
      date,
      confidence: 'medium',
    };
  }
  const confidence: ParsedQuickEntry['confidence'] =
    amount !== null && categoryId ? 'high' : amount !== null || categoryId ? 'medium' : 'low';

  return {
    type,
    amount,
    categoryId,
    category: categoryId ? labelForCategoryId(categoryId) : '',
    note,
    paymentMethod,
    date,
    confidence,
  };
}
