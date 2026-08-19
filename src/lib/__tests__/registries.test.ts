import { describe, it, expect } from 'vitest';
import {
  CUSTOM_CATEGORY_PREFIX,
  addCustomCategory,
  removeCustomCategory,
  listCategories,
  listCategoryLabels,
  loadCustomCategories,
  saveCustomCategories,
  makeCustomCategoryId,
  describeCategory,
  CustomCategory,
} from '../categoryRegistry';
import {
  ALL_PAYMENT_METHODS,
  DEFAULT_ENABLED_PAYMENT_IDS,
  loadPaymentPrefs,
  savePaymentPrefs,
  listEnabledPaymentMethods,
  paymentMethodLabel,
  togglePaymentMethod,
  movePaymentMethod,
} from '../paymentMethods';
import { CATEGORY_DEFS } from '../categoryCatalog';
import { STORAGE_KEYS } from '../storage';
import { PAYMENT_METHODS, LegacyPaymentMethod, PaymentMethod } from '../../types';
import { createMemoryStorage } from './testUtils';

const LEGACY_IDS: LegacyPaymentMethod[] = ['cash', 'credit', 'bank', 'mobile'];

function customCategory(overrides: Partial<CustomCategory> = {}): CustomCategory {
  return {
    id: `${CUSTOM_CATEGORY_PREFIX}seed`,
    label: '種子',
    emoji: '🌱',
    type: 'expense',
    custom: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('categoryRegistry — addCustomCategory', () => {
  it('adds a category and returns it with a custom: id', () => {
    const storage = createMemoryStorage();
    const result = addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.category).toBeDefined();
    expect(result.category!.id.startsWith(CUSTOM_CATEGORY_PREFIX)).toBe(true);
    expect(result.category!.label).toBe('寵物');
    expect(result.category!.emoji).toBe('🐾');
    expect(result.category!.type).toBe('expense');
    expect(result.category!.custom).toBe(true);
    expect(typeof result.category!.createdAt).toBe('string');
  });

  it('persists into the supplied storage only', () => {
    const storage = createMemoryStorage();
    addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);

    expect(storage.getItem(STORAGE_KEYS.customCategories)).not.toBeNull();
    expect(loadCustomCategories(storage)).toHaveLength(1);
    // A fresh, independent storage must not see it.
    expect(loadCustomCategories(createMemoryStorage())).toHaveLength(0);
  });

  it('appends the new category AFTER the built-ins in listCategories', () => {
    const storage = createMemoryStorage();
    addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);

    const list = listCategories('expense', storage);
    const builtIns = CATEGORY_DEFS.expense;
    expect(list).toHaveLength(builtIns.length + 1);
    expect(list.slice(0, builtIns.length).map(c => c.id)).toEqual(builtIns.map(c => c.id));
    expect(list[list.length - 1]).toEqual({ id: `${CUSTOM_CATEGORY_PREFIX}寵物`, label: '寵物', emoji: '🐾' });
    expect(listCategoryLabels('expense', storage).at(-1)).toBe('寵物');
  });

  it('keeps custom categories scoped to their transaction type', () => {
    const storage = createMemoryStorage();
    addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);

    expect(listCategoryLabels('expense', storage)).toContain('寵物');
    expect(listCategoryLabels('income', storage)).not.toContain('寵物');
    expect(listCategories('income', storage)).toHaveLength(CATEGORY_DEFS.income.length);
  });

  it('rejects an empty or whitespace-only label', () => {
    const storage = createMemoryStorage();
    expect(addCustomCategory({ label: '', emoji: '🐾', type: 'expense' }, storage).ok).toBe(false);
    expect(addCustomCategory({ label: '   ', emoji: '🐾', type: 'expense' }, storage).ok).toBe(false);
    expect(addCustomCategory({ label: '   ', emoji: '🐾', type: 'expense' }, storage).error).toBeTruthy();
    expect(loadCustomCategories(storage)).toHaveLength(0);
  });

  it('rejects a label longer than 10 characters but accepts exactly 10', () => {
    const storage = createMemoryStorage();
    const eleven = 'a'.repeat(11);
    const ten = 'b'.repeat(10);

    const tooLong = addCustomCategory({ label: eleven, emoji: '🐾', type: 'expense' }, storage);
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error).toBeTruthy();
    expect(tooLong.category).toBeUndefined();

    expect(addCustomCategory({ label: ten, emoji: '🐾', type: 'expense' }, storage).ok).toBe(true);
    expect(loadCustomCategories(storage).map(c => c.label)).toEqual([ten]);
  });

  it('trims the label before validating and storing', () => {
    const storage = createMemoryStorage();
    const result = addCustomCategory({ label: '  寵物  ', emoji: '🐾', type: 'expense' }, storage);
    expect(result.ok).toBe(true);
    expect(result.category!.label).toBe('寵物');
  });

  it('rejects a duplicate of a built-in label', () => {
    const storage = createMemoryStorage();
    const builtInLabel = CATEGORY_DEFS.expense[0].label; // 餐飲美食
    const result = addCustomCategory({ label: builtInLabel, emoji: '🐾', type: 'expense' }, storage);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(loadCustomCategories(storage)).toHaveLength(0);
  });

  it('rejects a duplicate custom label', () => {
    const storage = createMemoryStorage();
    expect(addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage).ok).toBe(true);

    const duplicate = addCustomCategory({ label: '寵物', emoji: '🐶', type: 'expense' }, storage);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toBeTruthy();
    expect(loadCustomCategories(storage)).toHaveLength(1);
  });

  it('falls back to a default emoji when none is given', () => {
    const storage = createMemoryStorage();
    expect(addCustomCategory({ label: '寵物', emoji: '', type: 'expense' }, storage).category!.emoji).toBe('🏷️');
    expect(addCustomCategory({ label: '旅遊', emoji: '   ', type: 'expense' }, storage).category!.emoji).toBe('🏷️');
  });
});

describe('categoryRegistry — makeCustomCategoryId', () => {
  it('slugifies a label behind the custom: prefix', () => {
    expect(makeCustomCategoryId('Pet Care', [])).toBe(`${CUSTOM_CATEGORY_PREFIX}pet_care`);
    expect(makeCustomCategoryId('寵物', [])).toBe(`${CUSTOM_CATEGORY_PREFIX}寵物`);
  });

  it('falls back to "category" when a label slugifies to nothing', () => {
    expect(makeCustomCategoryId('!!!', [])).toBe(`${CUSTOM_CATEGORY_PREFIX}category`);
  });

  it('suffixes colliding slugs so ids stay distinct', () => {
    const first = customCategory({ id: `${CUSTOM_CATEGORY_PREFIX}pet`, label: 'pet' });
    expect(makeCustomCategoryId('Pet!', [first])).toBe(`${CUSTOM_CATEGORY_PREFIX}pet_2`);

    const second = customCategory({ id: `${CUSTOM_CATEGORY_PREFIX}pet_2`, label: 'Pet!' });
    expect(makeCustomCategoryId('  pet  ', [first, second])).toBe(`${CUSTOM_CATEGORY_PREFIX}pet_3`);
  });

  it('gives two categories whose labels slugify the same distinct ids end-to-end', () => {
    const storage = createMemoryStorage();
    const a = addCustomCategory({ label: 'pet', emoji: '🐾', type: 'expense' }, storage);
    const b = addCustomCategory({ label: 'pet!', emoji: '🐶', type: 'expense' }, storage);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.category!.id).toBe(`${CUSTOM_CATEGORY_PREFIX}pet`);
    expect(b.category!.id).toBe(`${CUSTOM_CATEGORY_PREFIX}pet_2`);
    expect(a.category!.id).not.toBe(b.category!.id);

    const ids = loadCustomCategories(storage).map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('categoryRegistry — removeCustomCategory', () => {
  it('removes the category from the list', () => {
    const storage = createMemoryStorage();
    const added = addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);
    expect(listCategoryLabels('expense', storage)).toContain('寵物');

    removeCustomCategory(added.category!.id, storage);

    expect(loadCustomCategories(storage)).toHaveLength(0);
    expect(listCategoryLabels('expense', storage)).not.toContain('寵物');
    expect(listCategories('expense', storage)).toHaveLength(CATEGORY_DEFS.expense.length);
  });

  it('leaves other custom categories alone', () => {
    const storage = createMemoryStorage();
    const pet = addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);
    addCustomCategory({ label: '旅遊', emoji: '✈️', type: 'expense' }, storage);

    removeCustomCategory(pet.category!.id, storage);

    expect(loadCustomCategories(storage).map(c => c.label)).toEqual(['旅遊']);
  });

  it('is a no-op for an unknown id', () => {
    const storage = createMemoryStorage();
    addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);

    removeCustomCategory(`${CUSTOM_CATEGORY_PREFIX}nope`, storage);

    expect(loadCustomCategories(storage)).toHaveLength(1);
  });

  it('never touches finance_transactions in the same storage', () => {
    const storage = createMemoryStorage();
    const ledger = [
      { id: 't1', type: 'expense', amount: 120, category: '寵物', date: '2026-08-19', note: '飼料' },
    ];
    storage.setItem(STORAGE_KEYS.transactions, JSON.stringify(ledger));
    const before = storage.getItem(STORAGE_KEYS.transactions);

    const added = addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);
    removeCustomCategory(added.category!.id, storage);

    expect(storage.getItem(STORAGE_KEYS.transactions)).toBe(before);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.transactions) as string)).toEqual(ledger);
  });
});

describe('categoryRegistry — describeCategory', () => {
  it('resolves a built-in label', () => {
    const storage = createMemoryStorage();
    expect(describeCategory('餐飲美食', storage)).toEqual({ id: 'food', label: '餐飲美食', emoji: '🍱' });
  });

  it('resolves a built-in id', () => {
    const storage = createMemoryStorage();
    expect(describeCategory('salary', storage)).toEqual({ id: 'salary', label: '薪資收入', emoji: '💰' });
  });

  it('resolves a legacy English label', () => {
    const storage = createMemoryStorage();
    expect(describeCategory('Loan Repayments', storage)).toEqual({ id: 'debt', label: '負債償還', emoji: '💳' });
    expect(describeCategory('Investments', storage)).toEqual({
      id: 'investment',
      label: '投資理財',
      emoji: '📈',
    });
  });

  it('resolves a custom label and a custom id', () => {
    const storage = createMemoryStorage();
    const added = addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);

    expect(describeCategory('寵物', storage)).toEqual({ id: added.category!.id, label: '寵物', emoji: '🐾' });
    expect(describeCategory(added.category!.id, storage)).toEqual({
      id: added.category!.id,
      label: '寵物',
      emoji: '🐾',
    });
  });

  it('falls back to 其他支出 for an unknown value', () => {
    const storage = createMemoryStorage();
    // categoryIdForStored() maps anything unrecognised to 'other_expense',
    // so an unknown value resolves to the built-in "other expense" def.
    expect(describeCategory('完全沒看過的東西', storage)).toEqual({
      id: 'other_expense',
      label: '其他支出',
      emoji: '📦',
    });
  });

  it('still resolves a custom label after the category was removed (from the catalog fallback)', () => {
    const storage = createMemoryStorage();
    const added = addCustomCategory({ label: '寵物', emoji: '🐾', type: 'expense' }, storage);
    removeCustomCategory(added.category!.id, storage);

    // History keeps its stored label; it now resolves through the catalog fallback.
    expect(describeCategory('寵物', storage).id).toBe('other_expense');
  });

  it('ignores malformed rows persisted in storage', () => {
    const storage = createMemoryStorage();
    saveCustomCategories(
      [
        customCategory({ id: 'no-prefix', label: '壞的' }) as CustomCategory,
        customCategory({ id: `${CUSTOM_CATEGORY_PREFIX}ok`, label: '好的', emoji: '✅' }),
      ],
      storage,
    );

    expect(loadCustomCategories(storage).map(c => c.label)).toEqual(['好的']);
    expect(listCategoryLabels('expense', storage)).not.toContain('壞的');
  });
});

describe('paymentMethods — catalog', () => {
  it('keeps every legacy id present (existing ledgers depend on them)', () => {
    for (const id of LEGACY_IDS) {
      const def = ALL_PAYMENT_METHODS.find(m => m.id === id);
      expect(def, `legacy payment method "${id}" must never disappear`).toBeDefined();
      expect(def!.label).toBe(PAYMENT_METHODS[id]);
      expect(def!.builtIn).toBe(true);
    }
  });

  it('has unique ids and non-empty labels', () => {
    const ids = ALL_PAYMENT_METHODS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of ALL_PAYMENT_METHODS) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.emoji.length).toBeGreaterThan(0);
    }
  });

  it('defaults are all real methods', () => {
    for (const id of DEFAULT_ENABLED_PAYMENT_IDS) {
      expect(ALL_PAYMENT_METHODS.some(m => m.id === id)).toBe(true);
    }
  });
});

describe('paymentMethods — prefs', () => {
  it('returns the defaults when nothing is stored', () => {
    const storage = createMemoryStorage();
    expect(loadPaymentPrefs(storage).enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
    expect(listEnabledPaymentMethods(storage).map(m => m.id)).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
  });

  it('returns the defaults when the stored value is empty or unusable', () => {
    expect(loadPaymentPrefs(createMemoryStorage({ [STORAGE_KEYS.paymentMethodPrefs]: '{}' })).enabled).toEqual(
      DEFAULT_ENABLED_PAYMENT_IDS,
    );
    expect(
      loadPaymentPrefs(createMemoryStorage({ [STORAGE_KEYS.paymentMethodPrefs]: '{"enabled":[]}' })).enabled,
    ).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
    expect(
      loadPaymentPrefs(createMemoryStorage({ [STORAGE_KEYS.paymentMethodPrefs]: '{"enabled":["nope"]}' }))
        .enabled,
    ).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
  });

  it('drops unknown ids but keeps the known ones', () => {
    const storage = createMemoryStorage({
      [STORAGE_KEYS.paymentMethodPrefs]: JSON.stringify({ enabled: ['cash', 'ghost', 'bank'] }),
    });
    expect(loadPaymentPrefs(storage).enabled).toEqual(['cash', 'bank']);
  });

  it('listEnabledPaymentMethods respects the stored order', () => {
    const storage = createMemoryStorage();
    savePaymentPrefs({ enabled: ['linepay', 'cash', 'bank'] }, storage);

    expect(listEnabledPaymentMethods(storage).map(m => m.id)).toEqual(['linepay', 'cash', 'bank']);
    expect(listEnabledPaymentMethods(storage).map(m => m.label)).toEqual(['LINE Pay', '現金', '銀行轉帳']);
  });
});

describe('paymentMethods — togglePaymentMethod', () => {
  it('adds a method that is not enabled (at the end)', () => {
    const storage = createMemoryStorage();
    const next = togglePaymentMethod('bank', storage);

    expect(next.enabled).toEqual([...DEFAULT_ENABLED_PAYMENT_IDS, 'bank']);
    expect(loadPaymentPrefs(storage).enabled).toEqual(next.enabled);
  });

  it('removes a method that is enabled', () => {
    const storage = createMemoryStorage();
    const next = togglePaymentMethod('credit', storage);

    expect(next.enabled).not.toContain('credit');
    expect(next.enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS.filter(id => id !== 'credit'));
    expect(loadPaymentPrefs(storage).enabled).toEqual(next.enabled);
  });

  it('is its own inverse', () => {
    const storage = createMemoryStorage();
    togglePaymentMethod('bank', storage);
    const back = togglePaymentMethod('bank', storage);
    expect(back.enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
  });

  it('falls back to the defaults instead of leaving an empty picker', () => {
    const storage = createMemoryStorage();
    savePaymentPrefs({ enabled: ['cash'] }, storage);

    const next = togglePaymentMethod('cash', storage);

    expect(next.enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
    expect(next.enabled.length).toBeGreaterThan(0);
    expect(loadPaymentPrefs(storage).enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
    expect(listEnabledPaymentMethods(storage).length).toBeGreaterThan(0);
  });
});

describe('paymentMethods — movePaymentMethod', () => {
  it('moves a method earlier', () => {
    const storage = createMemoryStorage();
    const next = movePaymentMethod('credit', -1, storage);

    expect(next.enabled).toEqual(['cash', 'credit', 'easycard', 'linepay']);
    expect(loadPaymentPrefs(storage).enabled).toEqual(next.enabled);
  });

  it('moves a method later', () => {
    const storage = createMemoryStorage();
    const next = movePaymentMethod('cash', 1, storage);

    expect(next.enabled).toEqual(['easycard', 'cash', 'credit', 'linepay']);
    expect(listEnabledPaymentMethods(storage).map(m => m.id)).toEqual(next.enabled);
  });

  it('is a no-op at the first position', () => {
    const storage = createMemoryStorage();
    const next = movePaymentMethod('cash', -1, storage);

    expect(next.enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
    expect(loadPaymentPrefs(storage).enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
  });

  it('is a no-op at the last position', () => {
    const storage = createMemoryStorage();
    const next = movePaymentMethod('linepay', 1, storage);

    expect(next.enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
    expect(loadPaymentPrefs(storage).enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
  });

  it('is a no-op for a method that is not enabled', () => {
    const storage = createMemoryStorage();
    const next = movePaymentMethod('bank', -1, storage);

    expect(next.enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
  });

  it('two opposite moves restore the original order', () => {
    const storage = createMemoryStorage();
    movePaymentMethod('cash', 1, storage);
    const back = movePaymentMethod('cash', -1, storage);

    expect(back.enabled).toEqual(DEFAULT_ENABLED_PAYMENT_IDS);
  });
});

describe('paymentMethods — paymentMethodLabel', () => {
  it('resolves every legacy id', () => {
    expect(paymentMethodLabel('cash')).toBe('現金');
    expect(paymentMethodLabel('credit')).toBe('信用卡');
    expect(paymentMethodLabel('bank')).toBe('銀行轉帳');
    expect(paymentMethodLabel('mobile')).toBe('行動支付');
  });

  it('resolves a method the user has hidden but old rows still reference', () => {
    const storage = createMemoryStorage();
    savePaymentPrefs({ enabled: ['cash'] }, storage);

    expect(listEnabledPaymentMethods(storage).map(m => m.id)).not.toContain('jkopay');
    expect(paymentMethodLabel('jkopay')).toBe('街口支付');
    expect(paymentMethodLabel('easycard')).toBe('悠遊卡');
  });

  it('returns the raw id for something unknown', () => {
    expect(paymentMethodLabel('bitcoin' as PaymentMethod)).toBe('bitcoin');
  });

  it('returns an empty string for undefined', () => {
    expect(paymentMethodLabel(undefined)).toBe('');
  });
});
