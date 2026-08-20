/// <reference types="vite/client" />

/**
 * Only PUBLIC configuration belongs here.
 *
 * Anything named VITE_* is inlined into the JS bundle at build time, and that
 * bundle ships inside the Android APK. A server secret placed here is a
 * published secret. The Supabase publishable key is safe precisely because it
 * is designed to be public and is useless without RLS letting the caller
 * through — which is why RLS is enforced and forced on every table.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_RELEASE_MANIFEST_URL?: string;
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
