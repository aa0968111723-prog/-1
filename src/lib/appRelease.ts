/**
 * Android release manifest.
 *
 * The download centre must not hardcode a version. Hardcoded version strings
 * in React are how a site ends up advertising 1.0.0 three releases later, and
 * how a download button keeps pointing at an APK that no longer exists.
 * Everything the page shows comes from one manifest that CI republishes on
 * every release.
 *
 * The manifest lives in a public Supabase Storage bucket rather than as a
 * GitHub Release asset, because this repository is PRIVATE: a release asset
 * URL requires a token, so it cannot be handed to an ordinary user.
 */

export interface ReleaseManifest {
  version: string;
  versionCode: number;
  platform: 'android';
  /** Minimum Android API level the APK will install on. */
  minAndroid: number;
  /** 'production' is what the public download centre offers. */
  channel: 'production' | 'internal';
  apkUrl: string;
  sha256: string;
  size: number;
  releasedAt: string;
  notes: string;
  /** Present on internal builds: which commit produced it. */
  commit?: string;
}

export const RELEASE_MANIFEST_URL: string =
  (import.meta.env?.VITE_RELEASE_MANIFEST_URL as string | undefined) ??
  'https://oylnzelynmbkozjlwsrd.supabase.co/storage/v1/object/public/app-releases/android/latest.json';

/** Where a desktop visitor's QR code should point. Never the raw APK. */
export const DOWNLOAD_PAGE_PATH = '/app/android';

function isManifest(v: unknown): v is ReleaseManifest {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.version === 'string' &&
    typeof m.versionCode === 'number' &&
    typeof m.apkUrl === 'string' &&
    // A manifest without a checksum is not something to hand a user an
    // installer from; treat it as malformed rather than "mostly fine".
    typeof m.sha256 === 'string' &&
    m.sha256.length === 64
  );
}

export interface ReleaseFetchResult {
  manifest: ReleaseManifest | null;
  /** Why there is nothing to show — the page says so instead of pretending. */
  error: 'offline' | 'not-published' | 'malformed' | null;
}

export async function fetchLatestRelease(
  url: string = RELEASE_MANIFEST_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, { cache: 'no-cache' });
  } catch {
    return { manifest: null, error: 'offline' };
  }
  if (response.status === 404) return { manifest: null, error: 'not-published' };
  if (!response.ok) return { manifest: null, error: 'offline' };

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { manifest: null, error: 'malformed' };
  }
  if (!isManifest(parsed)) return { manifest: null, error: 'malformed' };
  return { manifest: parsed, error: null };
}

/** Bytes as something a person reads, e.g. "4.1 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Compare semver-ish strings. Returns <0, 0, >0. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Is there a newer build than the one running?
 *
 * versionCode is the comparison, not the name: it is the integer Android
 * itself uses to decide whether an APK is an upgrade, so it is the only value
 * that cannot disagree with what the installer will do.
 */
export function isUpdateAvailable(installedVersionCode: number, manifest: ReleaseManifest | null): boolean {
  if (!manifest || typeof manifest.versionCode !== 'number') return false;
  return manifest.versionCode > installedVersionCode;
}

/** Android API level -> the version people recognise. */
export function androidApiLabel(api: number): string {
  const names: Record<number, string> = { 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16' };
  return names[api] ? `Android ${names[api]}` : `Android API ${api}`;
}
