/**
 * Where is this code actually running?
 *
 * Components kept answering this themselves — one checked for the Capacitor
 * plugin, another sniffed the user agent, a third assumed "not desktop means
 * phone". They disagreed, so the pet page could offer a download button to
 * someone already inside the Android app.
 *
 * One answer, computed once.
 */

import { Capacitor } from '@capacitor/core';

export type RuntimePlatform = 'android-app' | 'ios-app' | 'web';

export interface RuntimeEnvironment {
  platform: RuntimePlatform;
  /** Inside the installed native app (any OS). */
  isNativeApp: boolean;
  /** A browser on an Android device — the audience for the download button. */
  isAndroidBrowser: boolean;
  /** A browser on any phone. Drives layout, not capability. */
  isMobileBrowser: boolean;
  /** A desktop browser: show a QR code rather than a download link it cannot use. */
  isDesktopBrowser: boolean;
}

function detectPlatform(): RuntimePlatform {
  try {
    if (Capacitor.isNativePlatform?.()) {
      const p = Capacitor.getPlatform?.();
      if (p === 'android') return 'android-app';
      if (p === 'ios') return 'ios-app';
    }
  } catch {
    // Capacitor absent in a plain browser build; fall through to web.
  }
  return 'web';
}

export function detectRuntimeEnvironment(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): RuntimeEnvironment {
  const platform = detectPlatform();
  const isNativeApp = platform !== 'web';

  // Only meaningful in a browser. Inside the app these are all false, which is
  // what stops the download CTA appearing to someone who already installed it.
  const lower = ua.toLowerCase();
  const looksAndroid = /android/.test(lower);
  const looksIphone = /iphone|ipod/.test(lower);
  const looksIpad = /ipad/.test(lower) || (/macintosh/.test(lower) && typeof navigator !== 'undefined' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1);
  const isMobileBrowser = !isNativeApp && (looksAndroid || looksIphone || looksIpad);

  return {
    platform,
    isNativeApp,
    isAndroidBrowser: !isNativeApp && looksAndroid,
    isMobileBrowser,
    isDesktopBrowser: !isNativeApp && !isMobileBrowser,
  };
}

/** Computed once at module load; the platform cannot change mid-session. */
export const runtimeEnvironment: RuntimeEnvironment = detectRuntimeEnvironment();
