/**
 * CategoryRegistry — built-in catalog + user-defined categories.
 *
 * Built-ins come from shared/pet-shared-config.json (the same file the
 * Android quick add bundles). Users can add their own (寵物/旅遊/社團…);
 * those live in localStorage and are merged in here, so every surface —
 * the full form, quick add chips, the native sheet — sees one list.
 *
 * Stored transactions keep using the zh-TW label (the legacy shape); the
 * stable id travels alongside for cross-layer matching.
 */

import { TransactionType } from '../types';
import { CATEGORY_DEFS, CategoryDef, categoryIdForStored, labelForCategoryId } from './categoryCatalog';
import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export interface CustomCategory extends CategoryDef {
  type: TransactionType;
  /** Always true for user-created entries. */
  custom: true;
  createdAt: string;
}

export const CUSTOM_CATEGORY_PREFIX = 'custom:';
export const MAX_CUSTOM_CATEGORIES = 40;

export function loadCustomCategories(storage: Storage | undefined = globalThis.localStorage): CustomCategory[] {
  const raw = loadJSON<unknown>(STORAGE_KEYS.customCategories, [], storage);
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is CustomCategory => {
    const v = c as Partial<CustomCategory>;
    return (
      !!v &&
      typeof v.id === 'string' &&
      v.id.startsWith(CUSTOM_CATEGORY_PREFIX) &&
      typeof v.label === 'string' &&
      v.label.trim() !== '' &&
      (v.type === 'expense' || v.type === 'income')
    );
  });
}

export function saveCustomCategories(
  categories: CustomCategory[],
  storage: Storage | undefined = globalThis.localStorage,
): void {
  saveJSON(STORAGE_KEYS.customCategories, categories.slice(0, MAX_CUSTOM_CATEGORIES), storage);
}

/** Slug for a user label; collisions get a numeric suffix. */
export function makeCustomCategoryId(label: string, existing: CustomCategory[]): string {
  const base =
    CUSTOM_CATEGORY_PREFIX +
    (label.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'category');
  if (!existing.some(c => c.id === base)) return base;
  let n = 2;
  while (existing.some(c => c.id === `${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export interface AddCategoryResult {
  ok: boolean;
  error?: string;
  category?: CustomCategory;
}

export function addCustomCategory(
  input: { label: string; emoji: string; type: TransactionType },
  storage: Storage | undefined = globalThis.localStorage,
): AddCategoryResult {
  const label = input.label.trim();
  if (label === '') return { ok: false, error: '請輸入分類名稱' };
  if (label.length > 10) return { ok: false, error: '分類名稱請控制在 10 個字以內' };

  const existing = loadCustomCategories(storage);
  if (existing.length >= MAX_CUSTOM_CATEGORIES) return { ok: false, error: '自訂分類數量已達上限' };

  const clashesBuiltIn = CATEGORY_DEFS[input.type].some(d => d.label === label);
  if (clashesBuiltIn) return { ok: false, error: '已經有同名的內建分類了' };
  if (existing.some(c => c.type === input.type && c.label === label)) {
    return { ok: false, error: '已經有同名的自訂分類了' };
  }

  const category: CustomCategory = {
    id: makeCustomCategoryId(label, existing),
    label,
    emoji: input.emoji.trim() || '🏷️',
    type: input.type,
    custom: true,
    createdAt: new Date().toISOString(),
  };
  saveCustomCategories([...existing, category], storage);
  return { ok: true, category };
}

/**
 * Removes a custom category. Existing transactions keep their stored label —
 * removing a category never rewrites or deletes history.
 */
export function removeCustomCategory(id: string, storage: Storage | undefined = globalThis.localStorage): void {
  saveCustomCategories(loadCustomCategories(storage).filter(c => c.id !== id), storage);
}

/** Built-ins followed by the user's own categories, for a transaction type. */
export function listCategories(
  type: TransactionType,
  storage: Storage | undefined = globalThis.localStorage,
): CategoryDef[] {
  const custom = loadCustomCategories(storage)
    .filter(c => c.type === type)
    .map(({ id, label, emoji }) => ({ id, label, emoji }));
  return [...CATEGORY_DEFS[type], ...custom];
}

/** Labels only — drop-in for the legacy CATEGORIES[type] arrays. */
export function listCategoryLabels(
  type: TransactionType,
  storage: Storage | undefined = globalThis.localStorage,
): string[] {
  return listCategories(type, storage).map(c => c.label);
}

/** Resolves a stored value to its display parts, including custom categories. */
export function describeCategory(
  stored: string,
  storage: Storage | undefined = globalThis.localStorage,
): CategoryDef {
  const custom = loadCustomCategories(storage).find(c => c.label === stored || c.id === stored);
  if (custom) return { id: custom.id, label: custom.label, emoji: custom.emoji };
  const id = categoryIdForStored(stored);
  const builtIn = [...CATEGORY_DEFS.expense, ...CATEGORY_DEFS.income].find(d => d.id === id);
  return builtIn ?? { id, label: labelForCategoryId(id), emoji: '🏷️' };
}
