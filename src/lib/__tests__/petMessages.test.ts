import { describe, it, expect } from 'vitest';
import { pickMoodAndMessage } from '../petFinanceState';

const base = {
  goalReached: false,
  goalClose: false,
  budgetRatio: 0,
  hasBudget: false,
  todayCount: 0,
  todayExpense: 0,
  streak: 0,
  showAmounts: false,
};

describe('pet message engine', () => {
  it('greets by time of day when nothing is recorded yet', () => {
    expect(pickMoodAndMessage({ ...base, hour: 8 }).message).toContain('早安');
    expect(pickMoodAndMessage({ ...base, hour: 12 }).message).toContain('午餐');
    expect(pickMoodAndMessage({ ...base, hour: 23 }).mood).toBe('sleepy');
  });

  it('acknowledges the day\'s entries in the evening', () => {
    const r = pickMoodAndMessage({ ...base, hour: 21, todayCount: 4 });
    expect(r.mood).toBe('happy');
    expect(r.message).toContain('4 筆');
    expect(r.message).toContain('辛苦');
  });

  it('celebrates streak milestones without punishing broken streaks', () => {
    expect(pickMoodAndMessage({ ...base, hour: 12, streak: 7 }).mood).toBe('celebrate');
    // broken streak: just a normal message, no negative wording
    const broken = pickMoodAndMessage({ ...base, hour: 15, streak: 0 });
    expect(broken.message).not.toMatch(/中斷|失敗|可惜/);
  });

  it('never shames, even over budget', () => {
    const over = pickMoodAndMessage({ ...base, hour: 12, budgetRatio: 1.4, hasBudget: true });
    expect(over.mood).toBe('warning');
    expect(over.message).not.toMatch(/亂花|太多|敗家|不自律|控制不了/);
    expect(over.message).toContain('一起');
  });

  it('goal reached beats every other signal', () => {
    const r = pickMoodAndMessage({ ...base, hour: 12, goalReached: true, budgetRatio: 2, hasBudget: true });
    expect(r.mood).toBe('celebrate');
  });

  it('respects privacy mode in amount display', () => {
    const hidden = pickMoodAndMessage({ ...base, hour: 12, todayCount: 2, todayExpense: 500 });
    expect(hidden.message).not.toContain('NT$');
    const shown = pickMoodAndMessage({ ...base, hour: 12, todayCount: 2, todayExpense: 500, showAmounts: true });
    expect(shown.message).toContain('NT$500');
  });
});
