import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS } from '../core/commands.ts';
import { COMMAND_SCREENS, NAV, SCREENS } from './src/routes.ts';

test('every command in the core can be reached from a screen', () => {
  const missing = [...COMMANDS.keys()].filter((id) => !COMMAND_SCREENS[id]);
  assert.deepEqual(missing, []);
});

test('the route map names only real commands and real screens', () => {
  for (const [id, target] of Object.entries(COMMAND_SCREENS)) {
    assert.ok(COMMANDS.has(id), `unknown command ${id}`);
    assert.ok(SCREENS.includes(target.screen), `unknown screen ${target.screen}`);
  }
  for (const g of NAV) for (const i of g.items) assert.ok(SCREENS.includes(i.target.screen));
});
