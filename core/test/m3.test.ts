// M3: bank reconciliation, aging, cash flows, memorized transactions.
// Expected figures were computed by hand from the golden books before the code ran.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cashFlow } from '../cashflow.ts';
import { execute } from '../commands.ts';
import { createCompany, findAccount, type Company } from '../company.ts';
import { formatAmount } from '../money.ts';
import { trialBalance } from '../reports.ts';
import { aging } from '../subledger.ts';
import { bakery } from './golden/bakery.ts';
import { studio } from './golden/studio.ts';

type R = { ok: boolean; value?: unknown; error?: { code: string; details?: Record<string, unknown> } };
const code = (r: R) => (r.ok ? 'ok' : r.error?.code);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

// ---------------------------------------------------------------- aging

test('A/R aging of the studio: 31 Mar and 30 Apr', () => {
  const { c } = studio();
  const f = (m: number) => formatAmount(m, c.currency);
  const mar = must(aging(c, 'customer', '2026-03-31'));
  assert.deepEqual(mar.labels, ['Current', '1 - 30', '31 - 60', '61 - 90', '> 90']);
  // Nour's invoice 2 was due 25 Mar (6 days late); Atlas's invoice 4 is due 25 Apr.
  assert.deepEqual(mar.rows.map((r) => [r.name, r.buckets.map(f), f(r.total)]), [
    ['Atlas Hotel', ['88.31', '0.00', '0.00', '0.00', '0.00'], '88.31'],
    ['Nour Clinic', ['0.00', '787.50', '0.00', '0.00', '0.00'], '787.50'],
  ]);
  assert.equal(f(mar.total), '875.81');
  const apr = must(aging(c, 'customer', '2026-04-30'));
  // 30 Apr: invoice 2 is 36 days late, invoice 4 is 5 days late.
  assert.deepEqual(apr.items.map((i) => [i.number, i.daysPastDue, i.bucket, f(i.open)]), [
    ['4', 5, 1, '88.31'],
    ['2', 36, 2, '787.50'],
  ]);
  assert.deepEqual(apr.totals.map(f), ['0.00', '88.31', '787.50', '0.00', '0.00']);
  const ap = must(aging(c, 'vendor', '2026-03-31'));
  assert.deepEqual(ap.rows.map((r) => [r.name, f(r.buckets[0]!), f(r.total)]), [['PrintCo', '445.00', '445.00']]);
  const weekly = must(aging(c, 'customer', '2026-04-30', 7, 3));
  assert.deepEqual(weekly.labels, ['Current', '1 - 7', '8 - 14', '15 - 21', '> 21']);
  assert.deepEqual(weekly.totals.map(f), ['0.00', '88.31', '0.00', '0.00', '787.50']);
  assert.equal(code(aging(c, 'customer', '2026-04-30', 0)), 'aging.interval');
});

test('aging counts an unapplied payment against the customer, so the total equals A/R', () => {
  const made = createCompany({ name: 'Aging Co', currency: 'USD' });
  assert.ok(made.ok);
  const c = made.value;
  const acct = (n: string) => findAccount(c, n)!.id;
  const cust = (execute(c, 'customer.create', { name: 'Huda', termsDays: 30 }) as { value: { id: string } }).value.id;
  execute(c, 'invoice.create', { customerId: cust, date: '2026-01-01', lines: [{ accountId: acct('4000'), amount: 50000 }] });
  execute(c, 'payment.receive', { customerId: cust, date: '2026-03-01', amount: 20000, depositToId: acct('1010') });
  const a = must(aging(c, 'customer', '2026-03-15'));
  // invoice due 31 Jan, 43 days late → 31-60; payment of 1 Mar, 14 days old → 1-30, negative
  assert.deepEqual(a.totals, [0, -20000, 50000, 0, 0]);
  assert.equal(a.total, 30000);
  const tb = must(trialBalance(c, '2026-03-15'));
  assert.equal(tb.rows.find((r) => r.number === '1200')!.debit, a.total);
});

// ---------------------------------------------------------------- cash flows

test('cash flows of the studio, March 2026', () => {
  const { c } = studio();
  const f = (m: number) => formatAmount(m, c.currency);
  const cf = must(cashFlow(c, '2026-03-01', '2026-03-31'));
  assert.equal(f(cf.netIncome), '1,859.96');
  assert.deepEqual(cf.operating.rows.map((r) => [r.number, f(r.amount)]), [['1200', '-875.81'], ['2000', '445.00'], ['2100', '1,120.84']]);
  assert.equal(f(cf.netOperating), '2,549.99');
  assert.deepEqual(cf.investing.rows.map((r) => [r.number, f(r.amount)]), [['1500', '-899.99']]);
  assert.equal(cf.financing.rows.length, 0);
  assert.deepEqual([f(cf.netChange), f(cf.cashAtBeginning), f(cf.cashAtEnd)], ['1,650.00', '0.00', '1,650.00']);
});

test('cash flows of the bakery, January 2026 (prior-year balances carried in)', () => {
  const c = bakery();
  const f = (m: number) => formatAmount(m, c.currency);
  const cf = must(cashFlow(c, '2026-01-01', '2026-01-31'));
  assert.equal(f(cf.netIncome), '1,730.648');
  assert.deepEqual(cf.operating.rows.map((r) => [r.number, f(r.amount)]), [['1200', '-1,125.125'], ['2000', '294.625']]);
  assert.equal(f(cf.netOperating), '900.148');
  assert.deepEqual(cf.investing.rows.map((r) => [r.number, f(r.amount)]), [['1510', '141.667']]);
  assert.deepEqual(cf.financing.rows.map((r) => [r.number, f(r.amount)]), [['2500', '5,000.000']]);
  assert.deepEqual([f(cf.netChange), f(cf.cashAtBeginning), f(cf.cashAtEnd)], ['6,041.815', '13,190.750', '19,232.565']);
});

// ---------------------------------------------------------------- reconciliation

test('reconciling the studio’s checking account: March leaves a check outstanding, April clears it', () => {
  const { c, doc } = studio();
  const f = (m: number) => formatAmount(m, c.currency);
  const checking = findAccount(c, '1010')!.id;
  const cand = execute(c, 'bank.candidates', { accountId: checking, statementDate: '2026-03-31' }) as R & { value: { beginningBalance: number; lines: { key: string; entryId: number; amount: number; kind: string; number: string }[] } };
  assert.equal(cand.value.beginningBalance, 0);
  assert.deepEqual(cand.value.lines.map((l) => [l.kind, f(l.amount)]), [
    ['bill_payment', '-600.00'],
    ['payment', '2,500.00'],
    ['payment', '1,000.00'],
    ['expense', '-1,500.00'],
    ['payment', '50.00'],
    ['void', '-50.00'],
    ['transfer', '-300.00'],
  ]);
  const key = (entryId: number | null) => cand.value.lines.find((l) => l.entryId === entryId)!.key;
  const onStatement = [doc.BP1!.entryId, doc.PAY1!.entryId, doc.PAY2!.entryId, doc.TR1!.entryId].map(key);
  // The bank says 2,600.00; one cent off is refused with the difference.
  const off = execute(c, 'bank.reconcile', { accountId: checking, statementDate: '2026-03-31', endingBalance: 260001, lineKeys: onStatement }) as R;
  assert.equal(code(off), 'reconcile.difference');
  assert.equal(off.error!.details!.difference, 1);
  const mar = execute(c, 'bank.reconcile', { accountId: checking, statementDate: '2026-03-31', endingBalance: 260000, lineKeys: onStatement }) as R & { value: { id: number } };
  assert.equal(code(mar), 'ok');
  const rep = execute(c, 'report.reconciliation', { id: mar.value.id }) as R & { value: { clearedIn: number; clearedOut: number; registerBalance: number; uncleared: { amount: number }[] } };
  assert.deepEqual([f(rep.value.clearedIn), f(rep.value.clearedOut), f(rep.value.registerBalance)], ['3,500.00', '900.00', '1,100.00']);
  assert.deepEqual(rep.value.uncleared.map((l) => f(l.amount)), ['-1,500.00', '50.00', '-50.00']);
  // register = statement ending balance + uncleared lines
  assert.equal(rep.value.registerBalance, 260000 + rep.value.uncleared.reduce((t, l) => t + l.amount, 0));

  // A reconciled document cannot be voided; undoing the reconciliation frees it.
  assert.equal(code(execute(c, 'document.void', { docId: doc.TR1!.id }) as R), 'doc.reconciled');
  assert.equal(code(execute(c, 'bank.reconcile', { accountId: checking, statementDate: '2026-03-15', endingBalance: 0, lineKeys: [] }) as R), 'reconcile.date_order');
  assert.equal(code(execute(c, 'bank.reconcile', { accountId: checking, statementDate: '2026-04-30', endingBalance: 260000, lineKeys: [onStatement[0]] }) as R), 'reconcile.line_cleared');

  const rest = [doc.EXP1!.entryId, doc.PAY3!.entryId].map(key).concat(cand.value.lines.filter((l) => l.kind === 'void').map((l) => l.key));
  const apr = execute(c, 'bank.reconcile', { accountId: checking, statementDate: '2026-04-30', endingBalance: 110000, lineKeys: rest }) as R & { value: { beginningBalance: number } };
  assert.equal(code(apr), 'ok');
  assert.equal(apr.value.beginningBalance, 260000);
  const after = execute(c, 'bank.candidates', { accountId: checking, statementDate: '2026-04-30' }) as R & { value: { lines: unknown[] } };
  assert.equal(after.value.lines.length, 0);

  assert.equal(code(execute(c, 'bank.undoReconciliation', { accountId: checking }) as R), 'ok');
  assert.equal(code(execute(c, 'bank.undoReconciliation', { accountId: checking }) as R), 'ok');
  assert.equal(code(execute(c, 'bank.undoReconciliation', { accountId: checking }) as R), 'reconcile.none');
  assert.equal(code(execute(c, 'document.void', { docId: doc.TR1!.id }) as R), 'ok');
});

test('only bank and credit card accounts reconcile; a credit card statement shows what is owed', () => {
  const { c } = studio();
  assert.equal(code(execute(c, 'bank.reconcile', { accountId: findAccount(c, '6000')!.id, statementDate: '2026-03-31', endingBalance: 0, lineKeys: [] }) as R), 'reconcile.account_type');
  const card = findAccount(c, '2100')!.id;
  const cand = execute(c, 'bank.candidates', { accountId: card, statementDate: '2026-03-31' }) as R & { value: { lines: { key: string; amount: number }[] } };
  assert.deepEqual(cand.value.lines.map((l) => l.amount), [104559, 7525]);
  const r = execute(c, 'bank.reconcile', { accountId: card, statementDate: '2026-03-31', endingBalance: 112084, lineKeys: cand.value.lines.map((l) => l.key) }) as R;
  assert.equal(code(r), 'ok');
});

// ---------------------------------------------------------------- memorized transactions

function shop(): { c: Company; acct: (n: string) => string; cust: string } {
  const made = createCompany({ name: 'Memo Co', currency: 'USD' });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const acct = (n: string) => findAccount(c, n)!.id;
  const cust = (execute(c, 'customer.create', { name: 'Retainer Client', termsDays: 15 }) as { value: { id: string } }).value.id;
  return { c, acct, cust };
}

test('a monthly schedule keeps to its day and clamps to short months; it stops at its end date', () => {
  const { c, acct } = shop();
  const m = execute(c, 'memorized.create', {
    name: 'Office rent',
    command: 'expense.create',
    params: { payFromId: acct('1010'), lines: [{ accountId: acct('6000'), amount: 120000 }], date: '1999-01-01' },
    frequency: 'monthly',
    nextDate: '2026-01-31',
    endDate: '2026-05-31',
  }) as R & { value: { id: string } };
  assert.equal(code(m), 'ok');
  const run = execute(c, 'memorized.runDue', { asOf: '2026-04-15' }) as R & { value: { date: string }[] };
  assert.deepEqual(run.value.map((x) => x.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  const more = execute(c, 'memorized.runDue', { asOf: '2026-12-31' }) as R & { value: { date: string }[] };
  assert.deepEqual(more.value.map((x) => x.date), ['2026-04-30', '2026-05-31']);
  assert.equal(c.memorized.get(m.value.id)!.nextDate, null, 'finished after its end date');
  assert.equal([...c.documents.values()].filter((d) => d.kind === 'expense').length, 5);
  assert.equal(must(trialBalance(c, '2026-12-31')).rows.find((r) => r.number === '6000')!.debit, 600000);
});

test('running the schedule is all or nothing', () => {
  const { c, acct, cust } = shop();
  execute(c, 'memorized.create', { name: 'Retainer', command: 'invoice.create', params: { customerId: cust, lines: [{ accountId: acct('4100'), amount: 50000 }] }, frequency: 'quarterly', nextDate: '2026-01-15' });
  execute(c, 'memorized.create', { name: 'Hosting', command: 'expense.create', params: { payFromId: acct('1010'), lines: [{ accountId: acct('6300'), amount: 2000 }] }, frequency: 'weekly', nextDate: '2026-01-01' });
  execute(c, 'customer.setActive', { id: cust, active: false });
  const before = structuredClone(c);
  const r = execute(c, 'memorized.runDue', { asOf: '2026-03-31' }) as R;
  assert.equal(code(r), 'memorized.run_failed');
  assert.deepEqual(c, before, 'the weekly expenses entered before the failure were rolled back too');
  execute(c, 'customer.setActive', { id: cust, active: true });
  const ok = execute(c, 'memorized.runDue', { asOf: '2026-03-31' }) as R & { value: { memorizedId: string; date: string }[] };
  assert.equal(code(ok), 'ok');
  assert.equal([...c.documents.values()].filter((d) => d.kind === 'invoice').length, 1, 'one quarterly invoice by 31 Mar');
  assert.equal(ok.value.length, 1 + 13, 'one quarterly invoice and thirteen weekly expenses');
});

test('memorized templates are checked when saved, and can be entered by hand', () => {
  const { c, acct, cust } = shop();
  assert.equal(code(execute(c, 'memorized.create', { name: 'Bad', command: 'invoice.create', params: { customerId: 'nobody', lines: [] } }) as R), 'memorized.template');
  assert.equal(code(execute(c, 'memorized.create', { name: 'Nope', command: 'document.void', params: {} }) as R), 'memorized.command');
  const m = execute(c, 'memorized.create', { name: 'Standard job', command: 'invoice.create', params: { customerId: cust, lines: [{ accountId: acct('4100'), amount: 7500 }] } }) as R & { value: { id: string } };
  assert.equal(code(m), 'ok');
  assert.equal(code(execute(c, 'memorized.create', { name: 'standard JOB', command: 'invoice.create', params: { customerId: cust, lines: [{ accountId: acct('4100'), amount: 1 }] } }) as R), 'memorized.name_taken');
  const inv = execute(c, 'memorized.run', { id: m.value.id, date: '2026-02-10' }) as R & { value: { total: number; dueDate: string } };
  assert.equal(code(inv), 'ok');
  assert.deepEqual([inv.value.total, inv.value.dueDate], [7500, '2026-02-25']);
});
