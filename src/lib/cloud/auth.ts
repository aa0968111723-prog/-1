/**
 * Accounts, and the right to not have one.
 *
 * Guest is the DEFAULT, not a downgrade. FinTracker is a local-first ledger:
 * everything — the pet, quick add, every analytic — works with no account at
 * all. Signing in adds cross-device sync and nothing else. An app that demands
 * an email before it will let you write down that you spent 120 on lunch has
 * misunderstood what it is for.
 *
 * Email OTP is the only method wired up. It is the one that works identically
 * in a browser and inside a Capacitor WebView, with no redirect-URI scheme
 * registration and no OAuth consent screen to misconfigure. Google sign-in
 * fits the same interface when it is added — see docs/CLOUD_SYNC_ARCHITECTURE.md.
 */

import { getSupabase, isCloudConfigured } from './supabaseClient';

/**
 * The slice of the Supabase client this controller actually uses. Narrow on
 * purpose: a fake in a test should not have to implement a database.
 */
export interface SupabaseLikeAuth {
  auth: {
    getSession(): Promise<{ data: { session: { user?: { id: string; email?: string | null } } | null } }>;
    onAuthStateChange(
      cb: (event: string, session: { user?: { id: string; email?: string | null } } | null) => void,
    ): unknown;
  };
}

export type AuthMode = 'guest' | 'signed-in';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthState {
  mode: AuthMode;
  user: AuthUser | null;
  /** True until the stored session has been checked, so the UI can avoid a flash. */
  loading: boolean;
  /** Cloud sync is simply unavailable in this build; guest still works fully. */
  cloudAvailable: boolean;
}

export type AuthListener = (state: AuthState) => void;

/** Set when the user explicitly chose to stay local, so we stop asking. */
const GUEST_CHOICE_KEY = 'fintracker.guest_mode_chosen';

export class AuthController {
  private state: AuthState = {
    mode: 'guest',
    user: null,
    loading: true,
    cloudAvailable: isCloudConfigured,
  };
  private listeners = new Set<AuthListener>();

  /**
   * [supabaseFactory] is injectable for the same reason FinanceSyncEngine's
   * client is: session restore decides whether a signed-in user sees their own
   * ledger, and code that cannot be tested without a network does not get
   * tested. init() had no test at all, which is how it ended up with no caller.
   */
  constructor(
    private storage: Storage | undefined = globalThis.localStorage,
    private supabaseFactory: () => SupabaseLikeAuth | null = getSupabase as unknown as () => SupabaseLikeAuth | null,
  ) {}

  getState(): AuthState {
    return { ...this.state };
  }

  subscribe(fn: AuthListener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<AuthState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.getState());
  }

  hasChosenGuest(): boolean {
    return this.storage?.getItem(GUEST_CHOICE_KEY) === '1';
  }

  chooseGuest(): void {
    try {
      this.storage?.setItem(GUEST_CHOICE_KEY, '1');
    } catch {
      /* the prompt reappearing is a nuisance, not a failure */
    }
    this.emit({ mode: 'guest', user: null, loading: false });
  }

  /** Restore any stored session. Safe to call when cloud is not configured. */
  async init(): Promise<AuthState> {
    const supabase = this.supabaseFactory();
    if (!supabase) {
      this.emit({ loading: false, cloudAvailable: false, mode: 'guest' });
      return this.getState();
    }
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      this.emit({
        loading: false,
        mode: user ? 'signed-in' : 'guest',
        user: user ? { id: user.id, email: user.email ?? null } : null,
      });

      supabase.auth.onAuthStateChange((_event, session) => {
        const u = session?.user;
        this.emit({
          mode: u ? 'signed-in' : 'guest',
          user: u ? { id: u.id, email: u.email ?? null } : null,
          loading: false,
        });
      });
    } catch (e) {
      // A broken session must not lock anyone out of their own local ledger.
      console.warn('[FinTracker.Auth] session restore failed; continuing as guest', e);
      this.emit({ loading: false, mode: 'guest', user: null });
    }
    return this.getState();
  }

  /** Send a 6-digit code. No password to forget, no reset flow to build. */
  async sendEmailCode(email: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: '這個版本沒有啟用雲端同步' };
    const trimmed = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return { ok: false, error: 'Email 格式看起來不太對' };

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: true },
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  async verifyEmailCode(email: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: '這個版本沒有啟用雲端同步' };
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email',
    });
    if (error) return { ok: false, error: error.message };
    const user = data.user;
    if (user) this.emit({ mode: 'signed-in', user: { id: user.id, email: user.email ?? null }, loading: false });
    return { ok: true };
  }

  /**
   * Sign out WITHOUT touching local data by default.
   *
   * Signing out is "stop syncing", not "delete my ledger". Wiping on logout
   * would mean a guest who signs in, syncs, then signs out loses everything
   * they had before they ever had an account.
   */
  async signOut(): Promise<void> {
    const supabase = getSupabase();
    try {
      await supabase?.auth.signOut();
    } catch (e) {
      console.warn('[FinTracker.Auth] sign out call failed; clearing locally anyway', e);
    }
    this.emit({ mode: 'guest', user: null, loading: false });
  }
}

export const authController = new AuthController();
