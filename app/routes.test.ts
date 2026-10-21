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

test('every command is actually called by the interface, not only mapped to a screen', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('./src/', import.meta.url);
  const files = [...readdirSync(dir), ...readdirSync(new URL('screens/', dir)).map((f) => `screens/${f}`)].filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
  const code = files.map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  // List commands return what the screens already read straight from the company (read-only).
  const READ_DIRECTLY = new Set(['account.list', 'journal.list', 'customer.list', 'vendor.list', 'item.list', 'document.list', 'memorized.list']);
  const called = (id: string) => {
    if (code.includes(`'${id}'`)) return true;
    const [noun, verb] = id.split('.');
    return (noun === 'customer' || noun === 'vendor') && code.includes('`${kind}.' + verb + '`');
  };
  const missing = [...COMMANDS.keys()].filter((id) => !READ_DIRECTLY.has(id) && !called(id));
  assert.deepEqual(missing, []);
});
