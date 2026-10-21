import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalog, loadFloor, parity } from './parity.ts';

test('every command the catalog names exists', () => {
  assert.deepEqual(parity().unknownCommands, []);
});

test('catalog ids are unique', () => {
  const ids = loadCatalog().map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('parity never falls below the recorded floor', () => {
  const p = parity();
  assert.ok(p.live >= loadFloor(), `parity ${p.live} is below the floor ${loadFloor()}`);
});
