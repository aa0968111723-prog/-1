import { describe, it, expect, vi } from 'vitest';
import {
  envOrDefault,
  fetchLatestRelease,
  compareVersions,
  isUpdateAvailable,
  formatBytes,
  androidApiLabel,
  ReleaseManifest,
} from '../appRelease';
import { detectRuntimeEnvironment } from '../runtimeEnvironment';

const VALID: ReleaseManifest = {
  version: '1.1.0',
  versionCode: 10100,
  platform: 'android',
  minAndroid: 24,
  channel: 'production',
  apkUrl: 'https://example.test/app-releases/android/1.1.0/fintracker-1.1.0.apk',
  sha256: 'a'.repeat(64),
  size: 4_269_570,
  releasedAt: '2026-08-20T00:00:00.000Z',
  notes: '首次發布',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('fetchLatestRelease', () => {
  it('returns the manifest when it is well formed', async () => {
    const r = await fetchLatestRelease('u', (async () => jsonResponse(VALID)) as unknown as typeof fetch);
    expect(r.error).toBeNull();
    expect(r.manifest?.version).toBe('1.1.0');
  });

  it('distinguishes "nothing published yet" from "cannot reach it"', async () => {
    const notFound = await fetchLatestRelease('u', (async () => jsonResponse({}, 404)) as unknown as typeof fetch);
    expect(notFound.error).toBe('not-published');

    const dead = await fetchLatestRelease('u', (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch);
    expect(dead.error).toBe('offline');
  });

  it('rejects a manifest with no checksum rather than offering the download anyway', async () => {
    const { sha256, ...noChecksum } = VALID;
    void sha256;
    const r = await fetchLatestRelease('u', (async () => jsonResponse(noChecksum)) as unknown as typeof fetch);
    expect(r.manifest).toBeNull();
    expect(r.error).toBe('malformed');
  });

  it('rejects a truncated checksum', async () => {
    const r = await fetchLatestRelease(
      'u',
      (async () => jsonResponse({ ...VALID, sha256: 'abc123' })) as unknown as typeof fetch,
    );
    expect(r.error).toBe('malformed');
  });

  it('survives a body that is not JSON at all', async () => {
    const r = await fetchLatestRelease('u', (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }) as unknown as Response) as unknown as typeof fetch);
    expect(r.error).toBe('malformed');
  });
});

describe('version comparison', () => {
  it('orders releases correctly', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
    expect(compareVersions('1.1.1', '1.1')).toBeGreaterThan(0);
  });

  it('update detection uses versionCode, which is what Android itself enforces', () => {
    expect(isUpdateAvailable(10000, VALID)).toBe(true);
    expect(isUpdateAvailable(10100, VALID)).toBe(false);
    expect(isUpdateAvailable(10200, VALID)).toBe(false);
  });

  it('never reports an update when there is no manifest', () => {
    expect(isUpdateAvailable(1, null)).toBe(false);
  });
});

describe('presentation helpers', () => {
  it('formats sizes a person can read', () => {
    expect(formatBytes(4_269_570)).toBe('4.1 MB');
    expect(formatBytes(51_200)).toBe('50 KB');
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });

  it('maps API levels to the names people recognise', () => {
    expect(androidApiLabel(26)).toBe('Android 8.0');
    expect(androidApiLabel(34)).toBe('Android 14');
    expect(androidApiLabel(99)).toBe('Android API 99');
  });
});

describe('runtime environment', () => {
  it('an Android browser is offered the download', () => {
    const e = detectRuntimeEnvironment('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126');
    expect(e.isAndroidBrowser).toBe(true);
    expect(e.isNativeApp).toBe(false);
    expect(e.isDesktopBrowser).toBe(false);
  });

  it('a desktop browser gets the QR path, not the download path', () => {
    const e = detectRuntimeEnvironment('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126');
    expect(e.isDesktopBrowser).toBe(true);
    expect(e.isAndroidBrowser).toBe(false);
    expect(e.isMobileBrowser).toBe(false);
  });

  it('an iPhone counts as mobile but not as an Android download target', () => {
    const e = detectRuntimeEnvironment('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari');
    expect(e.isMobileBrowser).toBe(true);
    expect(e.isAndroidBrowser).toBe(false);
  });

  it('an empty user agent degrades to desktop rather than throwing', () => {
    const e = detectRuntimeEnvironment('');
    expect(e.platform).toBe('web');
    expect(e.isDesktopBrowser).toBe(true);
  });
});

describe('build-time env fallbacks', () => {
  it('treats an unset secret (empty string) as absent, not as a value', () => {
    // GitHub Actions substitutes an UNSET secret as '', and Vite inlines that
    // verbatim. `'' ?? fallback` is '', which would have made the download
    // card fetch('') inside the published APK.
    const unsetSecret: string | undefined = process.env.__DEFINITELY_UNSET__ ?? '';
    expect(unsetSecret ?? 'fallback').toBe(''); // the trap, reproduced
    expect(envOrDefault('', 'fallback')).toBe('fallback');
    expect(envOrDefault('   ', 'fallback')).toBe('fallback');
    expect(envOrDefault(undefined, 'fallback')).toBe('fallback');
  });

  it('keeps a real configured value', () => {
    expect(envOrDefault('https://example.test/x.json', 'fallback')).toBe('https://example.test/x.json');
  });
});
