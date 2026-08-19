/**
 * petBridge — the only place the web app talks to the native Floating Pet.
 *
 * On Android this maps to the FinancePetPlugin Capacitor plugin; on web
 * every method degrades to a safe no-op so the pet feature never becomes a
 * hard dependency of FinTracker itself.
 */

import { registerPlugin, Capacitor, PluginListenerHandle } from '@capacitor/core';
import { Transaction } from '../types';
import { PetSettings } from './petSettings';
import { PetFinanceState } from './petFinanceState';

export type PetEventKind =
  | 'petTapped'
  | 'quickExpenseRequested'
  | 'quickIncomeRequested'
  | 'openDashboardRequested'
  | 'openPetSettingsRequested'
  | 'transactionQueued'
  | 'petStopped';

export interface PetEvent {
  kind: PetEventKind;
}

export interface PetStatus {
  running: boolean;
  permissionGranted: boolean;
  pendingCount: number;
}

/** A transaction captured natively (QuickAddActivity) while the WebView was not around. */
export interface PendingNativeTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  date: string;
  note: string;
  paymentMethod?: string;
}

export interface FinancePetPluginContract {
  canDrawOverlays(): Promise<{ granted: boolean }>;
  requestOverlayPermission(): Promise<{ granted: boolean }>;
  startPet(options: { settings: PetSettings }): Promise<{ started: boolean; reason?: string }>;
  stopPet(): Promise<void>;
  getPetStatus(): Promise<PetStatus>;
  setPetSettings(options: { settings: PetSettings }): Promise<void>;
  updatePetState(options: { state: PetFinanceState & { showAmounts: boolean; petName: string } }): Promise<void>;
  getPendingTransactions(): Promise<{ transactions: PendingNativeTransaction[] }>;
  ackPendingTransactions(options: { ids: string[] }): Promise<void>;
  addListener(
    eventName: 'petEvent',
    listener: (event: PetEvent) => void,
  ): Promise<PluginListenerHandle>;
}

class FinancePetWeb {
  async canDrawOverlays() {
    return { granted: false };
  }
  async requestOverlayPermission() {
    return { granted: false };
  }
  async startPet() {
    return { started: false, reason: 'web' };
  }
  async stopPet() {}
  async getPetStatus(): Promise<PetStatus> {
    return { running: false, permissionGranted: false, pendingCount: 0 };
  }
  async setPetSettings() {}
  async updatePetState() {}
  async getPendingTransactions() {
    return { transactions: [] };
  }
  async ackPendingTransactions() {}
}

export const FinancePet = registerPlugin<FinancePetPluginContract>('FinancePet', {
  web: () => new FinancePetWeb(),
});

export function isNativePetAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/** Converts a native pending entry into the web Transaction shape (id preserved for dedupe). */
export function pendingToTransaction(p: PendingNativeTransaction): Transaction {
  return {
    id: p.id,
    type: p.type,
    amount: p.amount,
    category: p.category,
    date: p.date,
    note: p.note,
    ...(p.paymentMethod ? { paymentMethod: p.paymentMethod as Transaction['paymentMethod'] } : {}),
  };
}
