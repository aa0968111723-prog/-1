import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
