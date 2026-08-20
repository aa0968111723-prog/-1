import { describe, it, expect, vi } from 'vitest';
import { AuthController, SupabaseLikeAuth } from '../auth';
import { createMemoryStorage } from '../../__tests__/testUtils';

/*
 * init() had no test and no caller.
 *
 * The state it clears is `loading: true`, which AccountPanel renders as a
 * spinner. Nobody noticed because the panel short-circuits on
 * `!cloudAvailable` first, and cloud is not configured in production — so the
 * moment a publishable key is set, the account screen would sit on that
 * spinner forever and signing in would be impossible.
 */

function fakeSupabase(session: { user?: { id: string; email?: string | null } } | null): {
  client: SupabaseLikeAuth;
  fire: (s: { user?: { id: string; email?: string | null } } | null) => void;
} {
  let listener: ((event: string, s: unknown) => void) | null = null;
  return {
    client: {
      auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: (cb: (event: string, s: never) => void) => {
          listener = cb as never;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    } as SupabaseLikeAuth,
    fire: s => listener?.('SIGNED_IN', s),
  };
}

describe('session restore', () => {
  it('clears loading even when cloud is not configured', async () => {
    const c = new AuthController(createMemoryStorage(), () => null);
    expect(c.getState().loading).toBe(true);

    const state = await c.init();

    expect(state.loading).toBe(false);
    expect(state.cloudAvailable).toBe(false);
    expect(state.mode).toBe('guest');
  });

  it('restores a stored session so the user is not signed out every launch', async () => {
    const { client } = fakeSupabase({ user: { id: 'u1', email: 'a@b.co' } });
    const c = new AuthController(createMemoryStorage(), () => client);

    const state = await c.init();

    expect(state.loading).toBe(false);
    expect(state.mode).toBe('signed-in');
    expect(state.user).toEqual({ id: 'u1', email: 'a@b.co' });
  });

  it('lands on guest when there is no session', async () => {
    const { client } = fakeSupabase(null);
    const c = new AuthController(createMemoryStorage(), () => client);

    const state = await c.init();

    expect(state.mode).toBe('guest');
    expect(state.user).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('follows later sign-in and sign-out without another init', async () => {
    const { client, fire } = fakeSupabase(null);
    const c = new AuthController(createMemoryStorage(), () => client);
    await c.init();

    fire({ user: { id: 'u2', email: 'c@d.co' } });
    expect(c.getState().mode).toBe('signed-in');

    fire(null);
    expect(c.getState().mode).toBe('guest');
  });

  it('a broken session leaves the local ledger reachable as a guest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = {
      auth: {
        getSession: async () => {
          throw new Error('token signature invalid');
        },
        onAuthStateChange: () => ({}),
      },
    } as unknown as SupabaseLikeAuth;

    const state = await new AuthController(createMemoryStorage(), () => client).init();

    // Never a locked door: a bad token must not cost the user their own data.
    expect(state.loading).toBe(false);
    expect(state.mode).toBe('guest');
    warn.mockRestore();
  });

  it('notifies subscribers, since the panel renders from the subscription', async () => {
    const { client } = fakeSupabase({ user: { id: 'u3', email: null } });
    const c = new AuthController(createMemoryStorage(), () => client);

    const seen: boolean[] = [];
    c.subscribe(s => seen.push(s.loading));
    await c.init();

    expect(seen[0]).toBe(true);            // initial, still loading
    expect(seen[seen.length - 1]).toBe(false); // and the panel is told when it ends
  });
});
