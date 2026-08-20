import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AndroidLandingPage from './components/AndroidLandingPage.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import './index.css';
import {runStorageMigration} from './lib/storage';
import {runIntegrityCheck} from './lib/integrity';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isAndroidLanding ? <AndroidLandingPage /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
