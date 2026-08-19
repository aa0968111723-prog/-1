import { describe, it, expect } from 'vitest';
import { parseQuickEntry, parseChineseNumber } from '../quickParser';

describe('parseQuickEntry', () => {
  it('parses 午餐120 into a high-confidence food expense', () => {
    const r = parseQuickEntry('午餐120');
    expect(r.type).toBe('expense');
    expect(r.amount).toBe(120);
    expect(r.category).toBe('餐飲美食');
    expect(r.note).toContain('午餐');
    expect(r.confidence).toBe('high');
  });

  it('parses 捷運50悠遊卡 with payment method mapping', () => {
    const r = parseQuickEntry('捷運50悠遊卡');
    expect(r.type).toBe('expense');
    expect(r.amount).toBe(50);
    expect(r.category).toBe('交通出行');
    expect(r.paymentMethod).toBe('mobile');
    expect(r.confidence).toBe('high');
  });

  it('detects income keywords', () => {
    const r = parseQuickEntry('薪水50000');
    expect(r.type).toBe('income');
    expect(r.amount).toBe(50000);
    expect(r.category).toBe('薪資收入');
  });

  it('handles thousands separators and currency prefixes', () => {
    const r = parseQuickEntry('NT$1,234 網購');
    expect(r.amount).toBe(1234);
    expect(r.category).toBe('購物消費');
  });

  it('reports medium confidence when only an amount is found', () => {
    const r = parseQuickEntry('雜項999');
    expect(r.amount).toBe(999);
    expect(r.category).toBe('其他支出');
    expect(r.confidence).toBe('medium');
  });

  it('reports low confidence with no amount', () => {
    const r = parseQuickEntry('今天好熱');
    expect(r.amount).toBeNull();
    expect(r.confidence).toBe('low');
  });

  it('maps 刷卡 to credit', () => {
    const r = parseQuickEntry('晚餐300刷卡');
    expect(r.paymentMethod).toBe('credit');
    expect(r.category).toBe('餐飲美食');
  });

  it('parses spoken Chinese amounts (語音記帳)', () => {
    const r = parseQuickEntry('午餐一百二十塊');
    expect(r.amount).toBe(120);
    expect(r.category).toBe('餐飲美食');
    expect(r.confidence).toBe('high');
  });

  it('parses income phrasing 薪水35000', () => {
    const r = parseQuickEntry('薪水35000');
    expect(r.type).toBe('income');
    expect(r.amount).toBe(35000);
    expect(r.category).toBe('薪資收入');
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
