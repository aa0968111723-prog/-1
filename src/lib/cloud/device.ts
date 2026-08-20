/**
 * A stable id for this installation.
 *
 * Used for two things only: breaking merge ties deterministically, and
 * showing the user which devices have been syncing. It is a random id
 * generated locally — not a hardware identifier, nothing derived from the
 * device, and nothing that follows the user anywhere else.
 */

const DEVICE_ID_KEY = 'fintracker.device_id';
const DEVICE_LABEL_KEY = 'fintracker.device_label';

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

export function getDeviceId(storage: Storage | undefined = globalThis.localStorage): string {
  const existing = storage?.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomId();
  try {
    storage?.setItem(DEVICE_ID_KEY, id);
  } catch {
    // Non-persistent storage: a per-session id still breaks ties correctly.
  }
  return id;
}

/**
 * A name the user will recognise in the device list. Guessed from the user
 * agent because asking someone to name their phone during onboarding is a
 * question nobody wants; they can still change it later.
 */
export function guessDeviceLabel(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const s = ua.toLowerCase();
  if (/android/.test(s)) {
    const model = /;\s*([^;)]+)\s+build\//i.exec(ua)?.[1]?.trim();
    return model ? `Android · ${model}` : 'Android 手機';
  }
  if (/iphone/.test(s)) return 'iPhone';
  if (/ipad/.test(s)) return 'iPad';
  if (/macintosh|mac os x/.test(s)) return 'Mac';
  if (/windows/.test(s)) return 'Windows';
  if (/linux/.test(s)) return 'Linux';
  return '這台裝置';
}

export function getDeviceLabel(storage: Storage | undefined = globalThis.localStorage): string {
  const saved = storage?.getItem(DEVICE_LABEL_KEY);
  if (saved) return saved;
  const guess = guessDeviceLabel();
  try {
    storage?.setItem(DEVICE_LABEL_KEY, guess);
  } catch {
    /* label is cosmetic; failing to persist it changes nothing */
  }
  return guess;
}

export function setDeviceLabel(label: string, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(DEVICE_LABEL_KEY, label.trim().slice(0, 60));
  } catch {
    /* cosmetic */
  }
}
