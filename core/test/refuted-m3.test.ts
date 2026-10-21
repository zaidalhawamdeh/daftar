// Regressions for the adversarial review of M3 (21 Oct 2026). Each failed before its fix.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createCompany, findAccount } from '../company.ts';

type R = { ok: boolean; value?: any; error?: { code: string } };
const code = (r: R) => (r.ok ? 'ok' : r.error?.code);

function setup() {
  const made = createCompany({ name: 'Refuted M3', currency: 'USD' });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const ex = (id: string, p: unknown) => execute(c, id, p) as R;
  const acct = (n: string) => findAccount(c, n)!.id;
  const cust = ex('customer.create', { name: 'Huda' }).value.id as string;
  return { c, ex, acct, cust };
}

test('D1 a closed period no longer hides a broken template', () => {
  const { ex, acct } = setup();
  ex('company.setClosingDate', { date: '2025-12-31' });
  assert.equal(code(ex('memorized.create', { name: 'b', command: 'invoice.create', params: { customerId: 'nobody', lines: [] } })), 'memorized.template');
  assert.equal(code(ex('memorized.create', { name: 'e', command: 'expense.create', params: { payFromId: 'zzz', lines: [{ accountId: acct('6000'), amount: 5 }] } })), 'memorized.template');
  assert.equal(code(ex('memorized.create', { name: 'j', command: 'journal.post', params: { lines: [{ accountId: acct('6000'), debit: 5 }] } })), 'memorized.template');
  assert.equal(code(ex('memorized.create', { name: 'late', command: 'expense.create', params: { payFromId: acct('1010'), lines: [{ accountId: acct('6000'), amount: 5 }] }, frequency: 'monthly', nextDate: '2025-06-30' })), 'date.closed');
  assert.equal(code(ex('memorized.create', { name: 'good', command: 'expense.create', params: { payFromId: acct('1010'), lines: [{ accountId: acct('6000'), amount: 5 }] } })), 'ok');
});

test('D2 templates cannot carry a fixed number or due date, which would block every later run', () => {
  const { ex, acct, cust } = setup();
  const base = { command: 'invoice.create', frequency: 'monthly', nextDate: '2026-01-15' };
  assert.equal(code(ex('memorized.create', { ...base, name: 'n', params: { customerId: cust, number: 'INV-1', lines: [{ accountId: acct('4000'), amount: 5 }] } })), 'memorized.fixed_number');
  assert.equal(code(ex('memorized.create', { ...base, name: 'd', params: { customerId: cust, dueDate: '2026-02-20', lines: [{ accountId: acct('4000'), amount: 5 }] } })), 'memorized.fixed_due_date');
  assert.equal(code(ex('memorized.create', { ...base, name: 't', params: { customerId: cust, termsDays: 10, lines: [{ accountId: acct('4000'), amount: 5 }] } })), 'ok');
  assert.equal(ex('memorized.runDue', { asOf: '2026-04-30' }).value.length, 4);
});

test('P1 a reconciled journal entry cannot be reversed, as a reconciled document cannot be voided', () => {
  const { ex, acct } = setup();
  const e = ex('journal.post', { date: '2025-01-10', lines: [{ accountId: acct('1010'), debit: 1000 }, { accountId: acct('3000'), credit: 1000 }] });
  const cand = ex('bank.candidates', { accountId: acct('1010'), statementDate: '2025-01-31' });
  assert.equal(code(ex('bank.reconcile', { accountId: acct('1010'), statementDate: '2025-01-31', endingBalance: 1000, lineKeys: cand.value.lines.map((l: any) => l.key) })), 'ok');
  assert.equal(code(ex('journal.reverse', { entryId: e.value.id, date: '2025-01-10' })), 'entry.reconciled');
  ex('bank.undoReconciliation', { accountId: acct('1010') });
  assert.equal(code(ex('journal.reverse', { entryId: e.value.id, date: '2025-01-11' })), 'ok');
});

test('small items: undone reconciliation reports refused; non-finite numbers refused; schedules stop at year 9999; reconciled accounts keep their type', () => {
  const { ex, acct } = setup();
  const bank = ex('account.create', { name: 'Spare bank', type: 'bank' }).value.id;
  const r = ex('bank.reconcile', { accountId: bank, statementDate: '2025-01-31', endingBalance: 0, lineKeys: [] });
  assert.equal(code(ex('account.update', { id: bank, type: 'expense' })), 'account.type_locked');
  ex('bank.undoReconciliation', { accountId: bank });
  assert.equal(code(ex('report.reconciliation', { id: r.value.id })), 'reconcile.undone');
  assert.equal(code(ex('memorized.create', { name: 'nan', command: 'expense.create', params: { payFromId: acct('1010'), lines: [{ accountId: acct('6000'), amount: NaN }] } })), 'memorized.params');
  const m = ex('memorized.create', { name: 'end of time', command: 'expense.create', params: { payFromId: acct('1010'), lines: [{ accountId: acct('6000'), amount: 5 }] }, frequency: 'yearly', nextDate: '9999-06-30' });
  assert.equal(code(m), 'ok');
  assert.equal(ex('memorized.runDue', { asOf: '9999-12-31' }).value.length, 1);
  assert.equal(ex('memorized.list', {}).value.find((x: any) => x.id === m.value.id).nextDate, null);
});
