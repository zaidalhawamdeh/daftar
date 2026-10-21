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

test('the review’s hostile files are all refused (M4 adversarial review, 21 Oct 2026)', () => {
  const base = studio();
  execute(base.c, 'memorized.create', { name: 'Rent', command: 'expense.create', params: { payFromId: [...base.c.accounts.values()].find((a) => a.number === '1010')!.id, lines: [{ accountId: [...base.c.accounts.values()].find((a) => a.number === '6000')!.id, amount: 5 }] }, frequency: 'monthly', nextDate: '2026-11-01' });
  const good = JSON.parse(toText(base.c));
  const attempt = (label: string, f: (d: any) => void) => {
    const d = structuredClone(good);
    f(d.company);
    const r = fromText(JSON.stringify(d));
    assert.equal(r.ok, false, label);
  };
  const expense = (d: any) => d.accounts.filter((a: any) => a.type === 'expense');
  attempt('account counter that would overwrite retained earnings', (d) => (d.counters.nextAccountId = 1));
  attempt('party counter that would overwrite a customer', (d) => (d.counters.nextPartyId = 1));
  attempt('item counter that would overwrite an item', (d) => (d.counters.nextItemId = 1));
  attempt('memorized counter that would overwrite a schedule', (d) => (d.counters.nextMemorizedId = 1));
  attempt('entry counter beyond exact range', (d) => (d.counters.nextEntryId = 1e21));
  attempt('document counter at the edge of exact range', (d) => (d.counters.nextDocId = Number.MAX_SAFE_INTEGER));
  attempt('account parent cycle', (d) => { const [a, b] = expense(d); a.parentId = b.id; b.parentId = a.id; });
  attempt('account that is its own parent', (d) => { const [a] = expense(d); a.parentId = a.id; });
  attempt('null memorized record', (d) => d.memorized.push(null));
  attempt('schedule that runs a forbidden command', (d) => (d.memorized[0].command = 'account.setActive'));
  attempt('document total changed without its entry', (d) => (d.documents.find((x: any) => x.kind === 'invoice').total += 1));
  attempt('negative document total', (d) => (d.documents[0].total = -5));
  attempt('void flag flipped', (d) => (d.documents.find((x: any) => x.voided).voided = false));
  attempt('over-applied invoice', (d) => (d.applications[0].amount = 999999999));
  attempt('duplicated application', (d) => d.applications.push({ ...d.applications[0], id: 999 }));
  attempt('application from a payment to a bill', (d) => (d.applications[0].targetId = d.documents.find((x: any) => x.kind === 'bill').id));
  attempt('application without a date', (d) => delete d.applications[0].date);
  attempt('document kind invented', (d) => (d.documents[0].kind = 'gift'));
  attempt('document entry pointing at another document’s entry', (d) => (d.documents[1].entryId = d.documents.find((x: any) => x.entryId !== null && x.id !== d.documents[1].id).entryId));
  attempt('entry reversing itself', (d) => (d.entries[0].reverses = d.entries[0].id));
  attempt('item posting to a missing account', (d) => (d.items[0].salesAccountId = 'acc-999'));
  attempt('item price with a fraction', (d) => (d.items[0].price = 1.5));
  attempt('item price as text', (d) => (d.items[0].price = '5'));
  attempt('customer with a numeric name', (d) => (d.parties[0].name = 42));
  attempt('terms as text', (d) => (d.parties[0].termsDays = '30'));
  attempt('cleared line without a reconciliation', (d) => d.cleared.push(['1:0', 77]));
  attempt('junk reconciliation', (d) => d.reconciliations.push({ junk: true }));
  attempt('duplicate invoice number', (d) => { const inv = d.documents.filter((x: any) => x.kind === 'invoice'); inv[1].number = inv[0].number; });
  attempt('invisible characters in a name', (d) => (d.parties[0].name = 'Atlas​ Hotel'));
  attempt('retained earnings retyped', (d) => (d.accounts.find((a: any) => a.role === 'retained_earnings').type = 'expense'));
  assert.ok(fromText(JSON.stringify(good)).ok, 'and the untouched file still opens');
});
