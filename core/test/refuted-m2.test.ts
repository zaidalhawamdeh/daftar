// Regressions for defects found by the adversarial review of M2 (21 Oct 2026). Each failed before its fix.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createCompany, findAccount } from '../company.ts';
import { openInvoices, partyBalances } from '../subledger.ts';
import { trialBalance } from '../reports.ts';

type R = { ok: boolean; value?: unknown; error?: { code: string } };
const code = (r: R) => (r.ok ? 'ok' : r.error?.code);

function setup() {
  const made = createCompany({ name: 'Refuted M2', currency: 'USD' });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const run = (id: string, p: Record<string, unknown>) => {
    const r = execute(c, id, p);
    if (!r.ok) throw new Error(`${id}: ${r.error.code} ${r.error.message}`);
    return r.value as { id: number | string; entryId: number; number: string };
  };
  const acct = (n: string) => findAccount(c, n)!.id;
  const cust = run('customer.create', { name: 'Huda' }).id as string;
  return { c, run, acct, cust };
}

test('#1 a document’s own entry cannot be reversed by hand; void still works', () => {
  const { c, run, acct, cust } = setup();
  const inv = run('invoice.create', { customerId: cust, date: '2026-01-05', lines: [{ accountId: acct('4000'), amount: 10000 }] });
  assert.equal(code(execute(c, 'journal.reverse', { entryId: inv.entryId, date: '2026-01-06' }) as R), 'entry.has_document');
  assert.equal(code(execute(c, 'document.void', { docId: inv.id }) as R), 'ok');
  const tb = trialBalance(c, '2026-12-31');
  const open = openInvoices(c, '2026-12-31');
  assert.ok(tb.ok && tb.value.rows.length === 0 && open.ok && open.value.total === 0);
});

test('#2 a plain journal entry cannot touch receivables or payables', () => {
  const { c, acct, cust } = setup();
  const r = execute(c, 'journal.post', { date: '2026-01-05', lines: [{ accountId: acct('1200'), debit: 500, partyId: cust }, { accountId: acct('4000'), credit: 500 }] }) as R;
  assert.equal(code(r), 'line.control_needs_document');
  assert.equal(c.entries.length, 0);
});

test('#3 credits cannot be applied inside a closed period', () => {
  const { c, run, acct, cust } = setup();
  const inv = run('invoice.create', { customerId: cust, date: '2026-01-05', lines: [{ accountId: acct('4000'), amount: 10000 }] });
  const pay = run('payment.receive', { customerId: cust, date: '2026-01-10', amount: 10000, depositToId: acct('1010') });
  execute(c, 'company.setClosingDate', { date: '2026-01-31' });
  assert.equal(code(execute(c, 'ar.apply', { sourceId: pay.id, applications: [{ docId: inv.id, amount: 10000 }] }) as R), 'date.closed');
  assert.equal(code(execute(c, 'ar.apply', { sourceId: pay.id, date: '2026-02-01', applications: [{ docId: inv.id, amount: 10000 }] }) as R), 'ok');
  const jan = openInvoices(c, '2026-01-31');
  assert.ok(jan.ok && jan.value.total === 10000, 'January stays as it was closed');
});

test('#4 receivable report totals beyond exact range are refused, not rounded', () => {
  const { c, run, acct } = setup();
  const big = Number.MAX_SAFE_INTEGER;
  for (const [name, amount] of [['A', big], ['B', 1], ['C', 1]] as const) {
    const id = run('customer.create', { name }).id;
    run('invoice.create', { customerId: id, date: '2026-01-05', lines: [{ accountId: acct('4000'), amount }] });
  }
  assert.equal(code(partyBalances(c, 'customer', '2026-12-31')), 'amount.too_large');
  assert.equal(code(openInvoices(c, '2026-12-31')), 'amount.too_large');
});

test('#5 automatic numbers never repeat, even after a huge manual number', () => {
  const { run, acct, cust } = setup();
  const inv = (number?: string) => run('invoice.create', { customerId: cust, date: '2026-01-05', number, lines: [{ accountId: acct('4000'), amount: 100 }] }).number;
  inv('999999999999999');
  const a = inv();
  const b = inv();
  assert.notEqual(a, b);
  assert.deepEqual([a, b], ['1000000000000000', '1000000000000001']);
});

test('#6 a 500-line document posts and converts', () => {
  const { c, run, acct, cust } = setup();
  const lines = Array.from({ length: 500 }, () => ({ accountId: acct('4000'), amount: 1 }));
  assert.equal(code(execute(c, 'invoice.create', { customerId: cust, date: '2026-01-05', lines }) as R), 'ok');
  const est = run('estimate.create', { customerId: cust, date: '2026-01-05', lines });
  assert.equal(code(execute(c, 'estimate.toInvoice', { docId: est.id }) as R), 'ok');
});
