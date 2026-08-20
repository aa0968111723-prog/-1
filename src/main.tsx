import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AndroidLandingPage from './components/AndroidLandingPage.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import './index.css';
import {runStorageMigration} from './lib/storage';
import {runIntegrityCheck} from './lib/integrity';
import {financeStore} from './lib/financeStore';
import {cloudSyncConfigured} from './lib/cloud/enabled';

// Storage schema migration must complete before any component reads finance data.
runStorageMigration();

// Read-only sanity pass over the ledger. It reports; it never repairs or
// deletes, so a false positive can never cost the user data.
try {
  const report = runIntegrityCheck();
  if (!report.ok) {
    console.warn('[FinTracker.Storage] integrity issues found', report.issues.length);
  }
} catch (e) {
  console.error('[FinTracker.Storage] integrity check failed', e);
}

/**
 * One standalone route, matched by path rather than by pulling in a router.
 * /app/android has to be shareable and QR-scannable on its own, but the rest
 * of FinTracker is a single view — a routing library for one extra page would
 * be more moving parts than the problem has.
 */
const isAndroidLanding = window.location.pathname.replace(/\/+$/, '') === '/app/android';

/**
 * Expose the build stamp before anything renders.
 *
 * "Is the deployed site actually the latest main?" was unanswerable without
 * this — a stale-looking page could equally be a failed deploy or a cached
 * bundle, and there was no way to tell which. Now it is one line in the
 * console on any device, including a phone with no devtools via the 進階
 * section of the pet page.
 */
(window as unknown as { __FINTRACKER_BUILD__?: unknown }).__FINTRACKER_BUILD__ = __BUILD_STAMP__;
console.info(
  `[FinTracker] v${__BUILD_STAMP__.version} build ${__BUILD_STAMP__.commit} (${__BUILD_STAMP__.builtAt})`,
);

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        {isAndroidLanding ? <AndroidLandingPage /> : <App />}
      </ErrorBoundary>
    </StrictMode>,
  );
}

/**
 * The one await the storage move costs us (see ADR-LOCAL-FIRST-STORAGE).
 * Components still read synchronously; they just cannot start before the
 * cache is warm, or the first render would show an empty ledger and then
 * flash the real one in.
 *
 * If init() ever rejects we still mount: FinanceStore falls back to
 * localStorage internally, and a working app on the old backend beats a
 * blank screen.
 */
/*
 * Restore any stored session.
 *
 * authController.init() existed, was documented as safe to call without cloud
 * configured, and had no caller anywhere in the app. Its one job is to clear
 * `loading`, which the account panel renders as a spinner — so with a
 * publishable key set, that screen would have sat on the spinner forever and
 * nobody could have signed in.
 *
 * Deliberately NOT awaited before mount: the ledger is local-first and must
 * not wait on the network to draw. Failures are already swallowed inside
 * init(), which falls back to guest.
 *
 * Imported dynamically and only when a key is configured: a static import
 * would put the whole Supabase SDK in the entry chunk, which every user
 * downloads before the first paint whether or not they sync.
 */
if (cloudSyncConfigured) {
  void import('./lib/cloud/auth')
    .then(m => m.authController.init())
    .catch(e => console.warn('[FinTracker.Auth] init failed', e));
}

financeStore
  .init()
  .then(result => {
    console.info(
      `[FinTracker.Store] backend=${result.backend}` +
        (result.migrated ? ` migrated=${JSON.stringify(result.migratedCounts)}` : ''),
    );
    for (const w of result.warnings) console.warn('[FinTracker.Store]', w);
  })
  .catch(e => console.error('[FinTracker.Store] init failed; continuing on localStorage', e))
  .finally(mount);
