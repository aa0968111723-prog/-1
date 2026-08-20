import { describe, it, expect } from 'vitest';
import { mergeById, pickWinner, tombstone, withoutTombstones, Syncable } from '../merge';

interface Row extends Syncable {
  amount?: number;
  note?: string;
}

const row = (id: string, updatedAt?: string, extra: Partial<Row> = {}): Row => ({ id, updatedAt, ...extra });

describe('union by id — nothing disappears', () => {
  it('local A,B + cloud B,C = A,B,C with B exactly once', () => {
    // The case from requirement §69, stated literally.
    const result = mergeById(
      [row('A', '2026-08-20T01:00:00Z'), row('B', '2026-08-20T01:00:00Z')],
      [row('B', '2026-08-20T01:00:00Z'), row('C', '2026-08-20T01:00:00Z')],
    );
    expect(result.merged.map(r => r.id)).toEqual(['A', 'B', 'C']);
    expect(result.merged.filter(r => r.id === 'B')).toHaveLength(1);
  });

  it('guest with 200 rows logging into an account with 100 keeps all 300', () => {
    // The scenario the whole design exists for (§12, §73).
    const local = Array.from({ length: 200 }, (_, i) => row(`local-${i}`, '2026-08-20T01:00:00Z'));
    const remote = Array.from({ length: 100 }, (_, i) => row(`cloud-${i}`, '2026-08-19T01:00:00Z'));

    const result = mergeById(local, remote);

    expect(result.merged).toHaveLength(300);
    expect(result.stats.localOnly).toBe(200);
    expect(result.stats.remoteOnly).toBe(100);
    // Every purely-local row has to be uploaded or the account silently
    // ends up missing 200 entries.
    expect(result.toPush).toHaveLength(200);
  });

  it('an overlapping guest login does not duplicate the shared rows', () => {
    const shared = row('shared', '2026-08-20T01:00:00Z');
    const result = mergeById([shared, row('only-local', '2026-08-20T01:00:00Z')], [shared, row('only-cloud', '2026-08-20T01:00:00Z')]);
    expect(result.merged.map(r => r.id)).toEqual(['only-cloud', 'only-local', 'shared']);
    expect(result.stats.bothAgreed).toBe(1);
  });

  it('ignores malformed rows instead of throwing', () => {
    const result = mergeById(
      [row('A', '2026-08-20T01:00:00Z'), null as unknown as Row, { } as Row],
      [row('B', '2026-08-20T01:00:00Z')],
    );
    expect(result.merged.map(r => r.id)).toEqual(['A', 'B']);
  });
});

describe('conflicts resolve on client edit time', () => {
  it('the later CLIENT edit wins, even if it was pushed much later', () => {
    // Requirement §70: local edited 10:10, cloud edited 10:12 -> cloud wins.
    const local = row('B', '2026-08-20T10:10:00Z', { note: 'local' });
    const remote = row('B', '2026-08-20T10:12:00Z', { note: 'cloud' });
    const result = mergeById([local], [remote]);

    expect(result.merged[0].note).toBe('cloud');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].winner).toBe('remote');
    expect(result.conflicts[0].reason).toBe('client-time');
  });

  it('an offline edit made earlier does not beat a newer online edit', () => {
    // The reason client_updated_at exists at all: this row was pushed at 18:00
    // but EDITED at 09:00, so it must lose to a 17:00 edit.
    const offlineEdit = row('B', '2026-08-20T09:00:00Z', { note: 'offline, pushed late' });
    const onlineEdit = row('B', '2026-08-20T17:00:00Z', { note: 'online' });
    expect(mergeById([offlineEdit], [onlineEdit]).merged[0].note).toBe('online');
  });

  it('a local edit newer than the cloud wins and is queued for upload', () => {
    const result = mergeById(
      [row('B', '2026-08-20T12:00:00Z', { note: 'local newer' })],
      [row('B', '2026-08-20T10:00:00Z', { note: 'cloud older' })],
    );
    expect(result.merged[0].note).toBe('local newer');
    expect(result.toPush.map(r => r.id)).toEqual(['B']);
  });

  it('a row with a timestamp beats a row without one', () => {
    const result = mergeById([row('B')], [row('B', '2026-08-20T10:00:00Z', { note: 'has time' })]);
    expect(result.merged[0].note).toBe('has time');
  });

  it('identical timestamps break on deviceId, deterministically in both directions', () => {
    const t = '2026-08-20T10:00:00Z';
    const a = row('B', t, { deviceId: 'aaa', note: 'from-a' });
    const b = row('B', t, { deviceId: 'bbb', note: 'from-b' });

    // Same inputs, opposite sides: both devices must reach the SAME answer,
    // or they push conflicting versions at each other forever.
    expect(mergeById([a], [b]).merged[0].note).toBe('from-b');
    expect(mergeById([b], [a]).merged[0].note).toBe('from-b');
  });

  it('fully identical versions are not reported as a conflict', () => {
    const t = '2026-08-20T10:00:00Z';
    const result = mergeById([row('B', t, { deviceId: 'x' })], [row('B', t, { deviceId: 'x' })]);
    expect(result.conflicts).toHaveLength(0);
    expect(result.stats.bothAgreed).toBe(1);
  });
});

describe('deletes travel as tombstones', () => {
  it('a newer cloud delete removes the row from the visible ledger', () => {
    const result = mergeById(
      [row('B', '2026-08-20T10:00:00Z')],
      [row('B', '2026-08-20T11:00:00Z', { deletedAt: '2026-08-20T11:00:00Z' })],
    );
    // The tombstone stays in the merged set — it has to keep syncing — but a
    // reader does not see it.
    expect(result.merged).toHaveLength(1);
    expect(withoutTombstones(result.merged)).toHaveLength(0);
  });

  it('a delete does NOT override a later edit', () => {
    // Delete-always-wins would make an accidental delete on an old device
    // impossible to undo from a newer one.
    const result = mergeById(
      [row('B', '2026-08-20T12:00:00Z', { note: 'edited after the delete' })],
      [row('B', '2026-08-20T11:00:00Z', { deletedAt: '2026-08-20T11:00:00Z' })],
    );
    expect(withoutTombstones(result.merged)).toHaveLength(1);
    expect(result.merged[0].note).toBe('edited after the delete');
  });

  it('a local delete is pushed rather than silently dropped', () => {
    const deleted = tombstone(row('B', '2026-08-20T10:00:00Z'), '2026-08-20T12:00:00Z', 'phone');
    const result = mergeById([deleted], [row('B', '2026-08-20T10:00:00Z')]);
    expect(result.toPush.map(r => r.id)).toEqual(['B']);
    expect(result.toPush[0].deletedAt).toBe('2026-08-20T12:00:00Z');
  });

  it('tombstone() stamps both the deletion and the edit time', () => {
    const t = tombstone(row('X', '2026-08-01T00:00:00Z'), '2026-08-20T12:00:00Z', 'tablet');
    expect(t.deletedAt).toBe('2026-08-20T12:00:00Z');
    // Without bumping updatedAt the delete would lose to its own older edit.
    expect(t.updatedAt).toBe('2026-08-20T12:00:00Z');
    expect(t.deviceId).toBe('tablet');
  });

  it('a re-pulled tombstone does not resurrect the row', () => {
    const deleted = tombstone(row('B', '2026-08-20T10:00:00Z'), '2026-08-20T12:00:00Z', 'phone');
    const firstPass = mergeById([deleted], [row('B', '2026-08-20T10:00:00Z')]);
    // Second round: the cloud now has the tombstone too.
    const secondPass = mergeById(firstPass.merged, [deleted]);
    expect(withoutTombstones(secondPass.merged)).toHaveLength(0);
    expect(secondPass.conflicts).toHaveLength(0);
  });
});

describe('convergence', () => {
  it('merging is idempotent — a second identical sync changes nothing', () => {
    const local = [row('A', '2026-08-20T01:00:00Z'), row('B', '2026-08-20T02:00:00Z')];
    const remote = [row('B', '2026-08-20T03:00:00Z'), row('C', '2026-08-20T01:00:00Z')];

    const once = mergeById(local, remote);
    const twice = mergeById(once.merged, once.merged);

    expect(twice.merged).toEqual(once.merged);
    expect(twice.conflicts).toHaveLength(0);
    expect(twice.toPush).toHaveLength(0);
  });

  it('two devices merging the same pair reach the same ledger', () => {
    const deviceA = [row('A', '2026-08-20T01:00:00Z', { deviceId: 'a' }), row('S', '2026-08-20T05:00:00Z', { deviceId: 'a' })];
    const deviceB = [row('B', '2026-08-20T02:00:00Z', { deviceId: 'b' }), row('S', '2026-08-20T04:00:00Z', { deviceId: 'b' })];

    const fromA = mergeById(deviceA, deviceB).merged;
    const fromB = mergeById(deviceB, deviceA).merged;

    expect(fromA).toEqual(fromB);
    expect(fromA.find(r => r.id === 'S')!.deviceId).toBe('a'); // the 05:00 edit
  });
});

describe('pickWinner is directly testable', () => {
  it('reports why it chose', () => {
    expect(pickWinner(row('x', '2026-08-20T02:00:00Z'), row('x', '2026-08-20T01:00:00Z'))).toEqual({
      winner: 'local',
      reason: 'client-time',
    });
    expect(pickWinner(row('x', '2026-08-20T01:00:00Z', { deviceId: 'z' }), row('x', '2026-08-20T01:00:00Z', { deviceId: 'a' }))).toEqual({
      winner: 'local',
      reason: 'tie-device',
    });
    expect(pickWinner(row('x', '2026-08-20T01:00:00Z'), row('x', '2026-08-20T01:00:00Z'))).toEqual({
      winner: 'equal',
      reason: 'tie-id',
    });
  });
});
