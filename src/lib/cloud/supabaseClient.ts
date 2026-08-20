/**
 * The Supabase connection.
 *
 * Only the PUBLISHABLE key ever appears here. That key is designed to be
 * public — it is in the JS bundle, and that bundle ships inside the APK, so
 * treating it as a secret would be self-deception. What actually protects the
 * data is Row Level Security: every finance table has RLS enabled AND forced
 * with `user_id = auth.uid()`, verified in supabase/migrations/0002. The key
 * gets you to the door; RLS decides which rows exist for you.
 *
 * The service role key must NEVER reach this file, the bundle, or the APK.
 * It bypasses RLS entirely. It lives only in CI secrets, used by the release
 * workflow to upload APKs.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { envOrDefault } from '../appRelease';

// Same trap as the release manifest: an unset GitHub secret arrives as '', and
// `?? ` does not fall back on an empty string.
const url = envOrDefault(import.meta.env?.VITE_SUPABASE_URL, 'https://oylnzelynmbkozjlwsrd.supabase.co');
const publishableKey = envOrDefault(import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY, '');

/**
 * Cloud sync is OPTIONAL. Without a key the app is a complete local-first
 * ledger, which is exactly what guest mode is, so an unconfigured build must
 * degrade quietly rather than crash on import.
 */
export const isCloudConfigured: boolean = Boolean(url && publishableKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isCloudConfigured) return null;
  if (!client) {
    client = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The session lands in localStorage. On Android that is inside the
        // app's private data directory, unreadable by other apps without
        // root — see docs/SUPABASE_SECURITY.md for the threat model and what
        // this does and does not protect against.
        storageKey: 'fintracker.auth',
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }
  return client;
}
