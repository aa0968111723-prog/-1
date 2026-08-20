/** Pet (小財) settings, persisted in localStorage and mirrored to native. */

import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export type PetSize = 'small' | 'medium' | 'large';
export type PetEdge = 'left' | 'right' | 'auto';
export type PetAutoCollapse = 'off' | '5s' | '15s';
export type PetAnimationLevel = 'full' | 'simple';
export type PetOpacity = '100' | '85' | '70';
/** What the pet's speech bubble may reveal on screen. */
export type PetBubbleDisplay = 'text' | 'count' | 'todaySpend' | 'budget';

export interface PetSettings {
  enabled: boolean;
  size: PetSize;
  edge: PetEdge;
  autoCollapse: PetAutoCollapse;
  animation: PetAnimationLevel;
  /** true = tapping a quick category immediately saves (超高速模式). */
  fastMode: boolean;
  /** false = bubble never shows money amounts (privacy mode, default). */
  showAmounts: boolean;
  petName: string;
  /** Quick add opens with this transaction type. */
  defaultType: 'expense' | 'income';
  /** Gate the full finance app behind device credential / biometrics. Quick add stays free. */
  appLock: boolean;
  /** Quick add stays usable without unlocking, even when appLock is on. */
  quickAddWithoutUnlock: boolean;
  /** Never below 70% — the pet has to stay tappable. */
  opacity: PetOpacity;
  /** Privacy: how much the bubble may say. Default reveals no numbers. */
  bubbleDisplay: PetBubbleDisplay;
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  enabled: false,
  size: 'medium',
  edge: 'auto',
  autoCollapse: '15s',
  animation: 'full',
  fastMode: false,
  showAmounts: false,
  petName: '小財',
  defaultType: 'expense',
  appLock: false,
  quickAddWithoutUnlock: true,
  opacity: '100',
  bubbleDisplay: 'text',
};

export function loadPetSettings(storage: Storage | undefined = globalThis.localStorage): PetSettings {
  const saved = loadJSON<Partial<PetSettings>>(STORAGE_KEYS.petSettings, {}, storage);
  const merged = { ...DEFAULT_PET_SETTINGS, ...saved };
  // Older installs only had the showAmounts boolean; honour it once so a user
  // who had opted in does not silently lose the setting.
  if (saved.bubbleDisplay === undefined && saved.showAmounts) merged.bubbleDisplay = 'todaySpend';
  merged.showAmounts = bubbleShowsAmounts(merged);
  return merged;
}

/** Whether the chosen bubble mode is allowed to print money on screen. */
export function bubbleShowsAmounts(settings: Pick<PetSettings, 'bubbleDisplay'>): boolean {
  return settings.bubbleDisplay === 'todaySpend' || settings.bubbleDisplay === 'budget';
}

export function savePetSettings(settings: PetSettings, storage: Storage | undefined = globalThis.localStorage): void {
  saveJSON(STORAGE_KEYS.petSettings, settings, storage);
}
