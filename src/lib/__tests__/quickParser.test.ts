import { describe, it, expect } from 'vitest';
import { parseQuickEntry, parseChineseNumber } from '../quickParser';
import { getLocalDateKey, addDaysKey } from '../datetime';

const NOW = new Date(2026, 7, 19, 12, 30); // 2026-08-19 12:30 local

describe('parseQuickEntry', () => {
  it('parses 午餐120 into a high-confidence food expense dated today', () => {
    const r = parseQuickEntry('午餐120', NOW);
    expect(r.type).toBe('expense');
    expect(r.amount).toBe(120);
    expect(r.categoryId).toBe('food');
    expect(r.category).toBe('餐飲美食');
    expect(r.note).toContain('午餐');
    expect(r.date).toBe(getLocalDateKey(NOW));
    expect(r.confidence).toBe('high');
  });

  it('parses 捷運50悠遊卡 and maps the specific instrument, not generic 行動支付', () => {
    const r = parseQuickEntry('捷運50悠遊卡', NOW);
    expect(r.categoryId).toBe('transport');
    expect(r.amount).toBe(50);
    expect(r.paymentMethod).toBe('easycard');
    expect(r.confidence).toBe('high');
  });

  it('parses 早餐65 and 咖啡80', () => {
    expect(parseQuickEntry('早餐65', NOW)).toMatchObject({ amount: 65, categoryId: 'food' });
    expect(parseQuickEntry('咖啡80', NOW)).toMatchObject({ amount: 80, categoryId: 'food' });
  });

  it('parses 薪水35000 as income', () => {
    const r = parseQuickEntry('薪水35000', NOW);
    expect(r.type).toBe('income');
    expect(r.amount).toBe(35000);
    expect(r.categoryId).toBe('salary');
    expect(r.category).toBe('薪資收入');
  });

  it('recognises merchants: 全聯850信用卡', () => {
    const r = parseQuickEntry('全聯850信用卡', NOW);
    expect(r.amount).toBe(850);
    expect(r.categoryId).toBe('shopping');
    expect(r.paymentMethod).toBe('credit');
    expect(r.confidence).toBe('high');
  });

  it('resolves 昨天晚餐180 to yesterday, local calendar', () => {
    const r = parseQuickEntry('昨天晚餐180', NOW);
    expect(r.amount).toBe(180);
    expect(r.categoryId).toBe('food');
    expect(r.date).toBe(addDaysKey(NOW, -1));
    expect(r.note).not.toContain('昨天');
  });

  it('handles thousands separators and currency prefixes', () => {
    const r = parseQuickEntry('NT$1,234 網購', NOW);
    expect(r.amount).toBe(1234);
    expect(r.categoryId).toBe('shopping');
  });

  it('never guesses an unknown category: 小明120 leaves it for the user', () => {
    const r = parseQuickEntry('小明120', NOW);
    expect(r.amount).toBe(120);
    expect(r.categoryId).toBeNull();
    expect(r.category).toBe('');
    expect(r.confidence).toBe('medium'); // amount only — UI must ask for the category
  });

  it('treats convenience stores as ambiguous rather than mis-filing them', () => {
    const r = parseQuickEntry('7-11 85', NOW);
    expect(r.amount).toBe(85);
    expect(r.categoryId).toBeNull();
    expect(r.confidence).toBe('medium');
    expect(r.note).toContain('7-11');
  });

  it('reports low confidence with no amount and no category', () => {
    const r = parseQuickEntry('今天好熱', NOW);
    expect(r.amount).toBeNull();
    expect(r.confidence).toBe('low');
  });

  it('prefers the longest payment keyword (信用卡 over 刷)', () => {
    expect(parseQuickEntry('晚餐300刷卡', NOW).paymentMethod).toBe('credit');
    expect(parseQuickEntry('晚餐300信用卡', NOW).paymentMethod).toBe('credit');
  });

  it('parses spoken Chinese amounts (語音記帳)', () => {
    const r = parseQuickEntry('午餐一百二十塊', NOW);
    expect(r.amount).toBe(120);
    expect(r.categoryId).toBe('food');
    expect(r.confidence).toBe('high');
  });

  it('rejects nonsense amounts instead of storing them', () => {
    expect(parseQuickEntry('午餐0', NOW).amount).toBeNull();
    expect(parseQuickEntry('午餐', NOW).amount).toBeNull();
  });

  it('parses an explicit 8/17 date within the current year', () => {
    const r = parseQuickEntry('8/17 晚餐 200', NOW);
    expect(r.date).toBe('2026-08-17');
    expect(r.amount).toBe(200);
  });
});

describe('parseChineseNumber', () => {
  it('handles common spoken amounts', () => {
    expect(parseChineseNumber('一百二十')).toBe(120);
    expect(parseChineseNumber('兩百五')).toBe(250);
    expect(parseChineseNumber('十五')).toBe(15);
    expect(parseChineseNumber('三千')).toBe(3000);
    expect(parseChineseNumber('一萬二千')).toBe(12000);
  });

  it('returns null for non-numeric text', () => {
    expect(parseChineseNumber('午餐')).toBeNull();
  });
});
