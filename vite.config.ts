import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {defineConfig} from 'vite';

/**
 * Build stamp — so anyone can tell WHICH commit the live site is running.
 *
 * This exists because "is the deployed site actually the latest main?" was
 * genuinely unanswerable: the site looked stale, and there was no way to tell
 * a caching problem from a deployment that never fired. A visible commit sha
 * turns that from a guess into a lookup.
 *
 * These are build metadata, not secrets. The rule about `define` is that a
 * server secret must never be inlined — see the note on the config below —
 * and a version string is the opposite of that.
 */
function buildStamp() {
  const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
  // CI checks out a detached HEAD; GITHUB_SHA is the reliable source there.
  let commit = process.env.VITE_BUILD_COMMIT ?? process.env.GITHUB_SHA ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
    } catch {
      commit = 'unknown'; // a tarball build with no git; not worth failing over
    }
  }
  return {version, commit: commit.slice(0, 7), builtAt: new Date().toISOString()};
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // Build metadata only. Never a secret: everything defined here is
      // inlined into the JS bundle, and that bundle ships inside the APK.
      __BUILD_STAMP__: JSON.stringify(buildStamp()),
    },
    // NOTE: no `define` for GEMINI_API_KEY.
    // Injecting it here would inline the real key into the JS bundle — and the
    // bundle ships inside the Android APK. The key is only ever read
    // server-side (server.ts) from the process environment; the client calls
    // our own endpoint instead. Quick add never needs it at all.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
