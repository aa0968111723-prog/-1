/** Pet (小財) settings, persisted in localStorage and mirrored to native. */

import { STORAGE_KEYS, loadJSON, saveJSON } from './storage';

export type PetSize = 'small' | 'medium' | 'large';
export type PetEdge = 'left' | 'right' | 'auto';
export type PetAutoCollapse = 'off' | '5s' | '15s';
export type PetAnimationLevel = 'full' | 'simple';

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
};

export function loadPetSettings(storage: Storage | undefined = globalThis.localStorage): PetSettings {
  const saved = loadJSON<Partial<PetSettings>>(STORAGE_KEYS.petSettings, {}, storage);
  return { ...DEFAULT_PET_SETTINGS, ...saved };
}

export function savePetSettings(settings: PetSettings, storage: Storage | undefined = globalThis.localStorage): void {
  saveJSON(STORAGE_KEYS.petSettings, settings, storage);
}
