import { envOrDefault } from '../appRelease';

/**
 * Is cloud sync configured — answered WITHOUT importing the Supabase SDK.
 *
 * supabaseClient.ts exports the same fact, but reaching it means importing
 * @supabase/supabase-js, and anything the entry chunk imports is downloaded
 * and parsed before the first paint. Wiring auth and sync into main/App pushed
 * the entry bundle from 346 kB to 577 kB that way — a 67% regression in
 * first-load cost, paid by every user, to support a feature that is switched
 * off.
 *
 * Reading the env var directly costs nothing and lets both call sites skip the
 * dynamic import entirely when there is no key.
 */
const url = envOrDefault(import.meta.env?.VITE_SUPABASE_URL, 'https://oylnzelynmbkozjlwsrd.supabase.co');
const publishableKey = envOrDefault(import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY, '');

export const cloudSyncConfigured: boolean = Boolean(url && publishableKey);
