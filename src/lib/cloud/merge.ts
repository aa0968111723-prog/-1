/**
 * Merging a local ledger with a cloud ledger.
 *
 * This is the file where a bug costs someone their money, so it is pure: no
 * network, no storage, no clock of its own. Everything it decides is a
 * function of its inputs, which is what makes the cases in
 * __tests__/merge.test.ts able to pin the behaviour exactly.
 *
 * The dangerous scenario this exists for (requirement §12):
 *
 *     phone has 200 local rows
 *     account has 100 cloud rows
 *     user logs in
 *     -> 300 rows, and NEITHER side disappears
 *
 * The rules, in order:
 *
 *  1. Union by id. An id on one side only is kept, never dropped.
 *  2. A tombstone is a fact, not an absence. `deletedAt` syncs like any other
 *     field, because a hard delete on one device is indistinguishable from
 *     "not synced yet" on another — which is how deleted rows resurrect.
 *  3. When both sides changed the same id, last-write-wins on the CLIENT edit
 *     time, not the server write time. An offline edit made at 09:00 and
 *     pushed at 18:00 must not beat an online edit made at 17:00.
 *  4. Ties break deterministically on deviceId, then on id. Two devices whose
 *     clocks agree to the millisecond must still converge to the same answer,
 *     or they will push conflicting rows at each other forever.
 */

export interface SyncMeta {
  /** When this row was last edited ON A DEVICE (ISO 8601). */
  updatedAt?: string;
  /** Tombstone. Set means deleted; the row still travels. */
  deletedAt?: string | null;
  /** Which device produced the current version. Used only to break ties. */
  deviceId?: string;
}

export type Syncable = SyncMeta & { id: string };

export type MergeSide = 'local' | 'remote' | 'equal';

export interface MergeConflict<T> {
  id: string;
  local: T;
  remote: T;
  winner: MergeSide;
  reason: 'client-time' | 'tie-device' | 'tie-id';
}

export interface MergeResult<T> {
  /** What the local ledger should become. */
  merged: T[];
  /** Rows the cloud does not have, or has an older version of. */
  toPush: T[];
  /** Both sides had edits; recorded so a Conflict Centre can show them. */
  conflicts: Array<MergeConflict<T>>;
  stats: {
    localOnly: number;
    remoteOnly: number;
    bothAgreed: number;
    bothConflicted: number;
    tombstones: number;
  };
}

/** Missing timestamps sort oldest, so a row that has one always wins. */
function editedAt(row: SyncMeta): number {
  const t = Date.parse(row.updatedAt ?? '');
  return Number.isNaN(t) ? 0 : t;
}

function isDeleted(row: SyncMeta): boolean {
  return row.deletedAt != null && row.deletedAt !== '';
}

/**
 * Which version wins, and why.
 *
 * Deliberately NOT "a delete always wins". A tombstone is just a version of
 * the row; if a device later edited that same row with a newer client time,
 * the edit is the more recent statement of intent — treating delete as
 * absolute would make an accidental delete on an old device impossible to
 * undo from a new one.
 */
export function pickWinner<T extends Syncable>(local: T, remote: T): { winner: MergeSide; reason: MergeConflict<T>['reason'] } {
  const lt = editedAt(local);
  const rt = editedAt(remote);
  if (lt !== rt) return { winner: lt > rt ? 'local' : 'remote', reason: 'client-time' };

  const ld = local.deviceId ?? '';
  const rd = remote.deviceId ?? '';
  if (ld !== rd) return { winner: ld > rd ? 'local' : 'remote', reason: 'tie-device' };

  return { winner: 'equal', reason: 'tie-id' };
}

/** True when the two versions are indistinguishable for sync purposes. */
function sameVersion(a: Syncable, b: Syncable): boolean {
  return editedAt(a) === editedAt(b) && isDeleted(a) === isDeleted(b) && (a.deviceId ?? '') === (b.deviceId ?? '');
}

export function mergeById<T extends Syncable>(local: T[], remote: T[]): MergeResult<T> {
  const localById = new Map<string, T>();
  for (const row of local) if (row && typeof row.id === 'string') localById.set(row.id, row);

  const remoteById = new Map<string, T>();
  for (const row of remote) if (row && typeof row.id === 'string') remoteById.set(row.id, row);

  const merged: T[] = [];
  const toPush: T[] = [];
  const conflicts: Array<MergeConflict<T>> = [];
  const stats = { localOnly: 0, remoteOnly: 0, bothAgreed: 0, bothConflicted: 0, tombstones: 0 };

  const allIds = new Set<string>([...localById.keys(), ...remoteById.keys()]);
  for (const id of allIds) {
    const l = localById.get(id);
    const r = remoteById.get(id);

    if (l && !r) {
      // The cloud has never seen this row. This is the guest-login case: the
      // whole point is that it survives and gets uploaded.
      merged.push(l);
      toPush.push(l);
      stats.localOnly++;
    } else if (!l && r) {
      merged.push(r);
      stats.remoteOnly++;
    } else if (l && r) {
      if (sameVersion(l, r)) {
        merged.push(r);
        stats.bothAgreed++;
      } else {
        const { winner, reason } = pickWinner(l, r);
        const chosen = winner === 'local' ? l : r;
        merged.push(chosen);
        if (winner === 'local') toPush.push(l);
        conflicts.push({ id, local: l, remote: r, winner, reason });
        stats.bothConflicted++;
      }
    }
    const final = merged[merged.length - 1];
    if (final && isDeleted(final)) stats.tombstones++;
  }

  // Stable order so a merge is reproducible and diffable in tests.
  merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  toPush.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  conflicts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { merged, toPush, conflicts, stats };
}

/** Rows a reader should see: everything that is not a tombstone. */
export function withoutTombstones<T extends Syncable>(rows: T[]): T[] {
  return rows.filter(r => !isDeleted(r));
}

/**
 * Mark a row deleted instead of removing it.
 *
 * Dropping the row from the array would make the deletion invisible to every
 * other device, and the next pull would hand it straight back.
 */
export function tombstone<T extends Syncable>(row: T, at: string, deviceId?: string): T {
  return { ...row, deletedAt: at, updatedAt: at, ...(deviceId ? { deviceId } : {}) };
}
