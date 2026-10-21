import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../core/commands.ts';
import { balanceSheet, trialBalance } from '../core/reports.ts';
import { openInvoices } from '../core/subledger.ts';
import { bakery } from '../core/test/golden/bakery.ts';
import { studio } from '../core/test/golden/studio.ts';
import { fromText, toText } from './serialize.ts';

test('a company survives saving and loading: same books, same reports, still frozen, still usable', () => {
  for (const c of [bakery(), studio().c]) {
    const loaded = fromText(toText(c));
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.error.message);
    const back = loaded.value;
    assert.deepEqual(trialBalance(back, '2026-12-31'), trialBalance(c, '2026-12-31'));
    assert.deepEqual(balanceSheet(back, '2026-03-31'), balanceSheet(c, '2026-03-31'));
    assert.deepEqual(openInvoices(back, '2026-12-31'), openInvoices(c, '2026-12-31'));
    assert.ok(Object.isFrozen(back.entries[0]) && Object.isFrozen(back.entries[0]!.lines[0]));
    assert.equal(toText(back).replace(/"savedAt":"[^"]+"/, ''), toText(c).replace(/"savedAt":"[^"]+"/, ''));
    const r = execute(back, 'customer.create', { name: 'After reload' });
    assert.ok(r.ok, 'counters carried over, new records get fresh ids');
  }
});

test('a damaged or hostile file is refused, never half-loaded', () => {
  const good = JSON.parse(toText(studio().c));
  const mutate = (f: (d: any) => void) => {
    const d = structuredClone(good);
    f(d);
    return fromText(JSON.stringify(d));
  };
  const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);
  assert.equal(code(fromText('not json')), 'file.invalid');
  assert.equal(code(fromText(JSON.stringify({ format: 'other' }))), 'file.invalid');
  assert.equal(code(mutate((d) => (d.version = 99))), 'file.version');
  assert.equal(code(mutate((d) => (d.company.entries[0].lines[0].debit += 1))), 'file.invalid', 'unbalanced entry');
  assert.equal(code(mutate((d) => (d.company.entries[0].lines[0].accountId = 'ghost'))), 'file.invalid');
  assert.equal(code(mutate((d) => (d.company.entries[0].lines[0].debit = 1.5))), 'file.invalid');
  assert.equal(code(mutate((d) => (d.company.counters.nextEntryId = 1))), 'file.invalid', 'counter behind data would reuse ids');
  assert.equal(code(mutate((d) => (d.company.applications[0].targetId = 9999))), 'file.invalid');
  assert.equal(code(mutate((d) => d.company.accounts.find((a: any) => a.role === 'retained_earnings').role = null)), 'file.invalid');
  assert.equal(code(mutate((d) => {
    const e = d.company.entries.find((x: any) => x.lines.some((l: any) => l.partyId));
    e.source = null;
  })), 'file.invalid', 'a receivable line without its document');
  assert.equal(code(mutate(() => {})), 'ok');
});
