import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAmount } from '../money.ts';
import { balanceSheet, profitAndLoss, trialBalance } from '../reports.ts';
import { openInvoices, partyBalances, unappliedCredits, unpaidBills } from '../subledger.ts';
import { EXPECTED, studio } from './golden/studio.ts';

const { c, doc } = studio();
const f = (m: number) => formatAmount(m, c.currency);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

test('golden studio: quantity × rate rounds half away from zero (2.333 h × 85.00 = 198.31)', () => {
  assert.equal(f(doc.INV3!.total), EXPECTED.invoice3);
});

test('golden studio: trial balance on 31 Mar 2026 matches the hand computation', () => {
  const tb = must(trialBalance(c, '2026-03-31'));
  assert.deepEqual(tb.rows.map((r) => [r.number, r.debit ? f(r.debit) : '', r.credit ? f(r.credit) : '']), EXPECTED.trialBalance.rows);
  assert.equal(f(tb.totalDebit), EXPECTED.trialBalance.total);
  assert.equal(f(tb.totalCredit), EXPECTED.trialBalance.total);
});

test('golden studio: profit and loss and balance sheet', () => {
  const pl = must(profitAndLoss(c, '2026-03-01', '2026-03-31'));
  assert.deepEqual(
    { income: f(pl.income.total), costOfGoodsSold: f(pl.costOfGoodsSold.total), grossProfit: f(pl.grossProfit), expenses: f(pl.expenses.total), netIncome: f(pl.netIncome) },
    EXPECTED.profitAndLoss,
  );
  const bs = must(balanceSheet(c, '2026-03-31'));
  assert.deepEqual(
    { assets: f(bs.assets.total), liabilities: f(bs.liabilities.total), netIncome: f(bs.equity.extra.netIncome), liabilitiesAndEquity: f(bs.totalLiabilitiesAndEquity) },
    EXPECTED.balanceSheet,
  );
});

test('golden studio: who owes what — customers, vendors, open invoices, unpaid bills', () => {
  const cust = must(partyBalances(c, 'customer', '2026-03-31'));
  assert.deepEqual(cust.rows.map((r) => [r.name, f(r.balance)]), EXPECTED.customers);
  const vend = must(partyBalances(c, 'vendor', '2026-03-31'));
  assert.deepEqual(vend.rows.map((r) => [r.name, f(r.balance)]), EXPECTED.vendors);
  const open = must(openInvoices(c, '2026-03-31'));
  assert.deepEqual(open.rows.map((r) => [r.name, r.number, f(r.total), f(r.open)]), EXPECTED.openInvoices);
  const early = must(openInvoices(c, '2026-03-21'));
  assert.deepEqual(early.rows.map((r) => [r.name, r.number, f(r.total), f(r.open)]), EXPECTED.openInvoicesOn0321);
  const bills = must(unpaidBills(c, '2026-03-31'));
  assert.deepEqual(bills.rows.map((r) => [r.name, r.number, f(r.total), f(r.open)]), EXPECTED.unpaidBills);
  assert.deepEqual(unappliedCredits(c, 'customer', '2026-03-31'), []);
});

test('golden studio: receivables and payables tie to the ledger', () => {
  const tb = must(trialBalance(c, '2026-03-31'));
  const ar = tb.rows.find((r) => r.number === '1200')!;
  const ap = tb.rows.find((r) => r.number === '2000')!;
  assert.equal(must(partyBalances(c, 'customer', '2026-03-31')).total, ar.debit);
  assert.equal(must(openInvoices(c, '2026-03-31')).total, ar.debit);
  assert.equal(must(partyBalances(c, 'vendor', '2026-03-31')).total, ap.credit);
  assert.equal(must(unpaidBills(c, '2026-03-31')).total, ap.credit);
});

test('golden studio: document states after conversion and voids', () => {
  assert.equal(doc.E1!.status, 'closed');
  assert.equal(doc.E1!.linkedId, doc.INV1!.id);
  assert.equal(doc.INV1!.linkedId, doc.E1!.id);
  assert.equal(doc.E2!.status, 'open');
  assert.equal(doc.PO1!.status, 'closed');
  assert.equal(doc.BILL1!.dueDate, '2026-04-07', 'PrintCo terms are 30 days');
  assert.equal(doc.INV2!.dueDate, '2026-03-25', 'Nour terms are 15 days');
  assert.equal(doc.BILL2!.dueDate, '2026-03-09', 'Office Mart has no terms');
  assert.ok(doc.PAY3!.voided && doc.INV5!.voided);
  assert.ok(c.applications.filter((a) => a.sourceId === doc.PAY3!.id).every((a) => a.voided));
  assert.equal(doc.E1!.entryId, null, 'estimates post nothing');
});

test('golden studio: customer balance detail runs line by line', () => {
  const r = must(partyBalances(c, 'customer', '2026-03-31', true));
  const atlas = r.rows.find((x) => x.name === 'Atlas Hotel')!;
  assert.deepEqual(atlas.lines!.map((l) => [l.kind, l.number, f(l.amount), f(l.balance)]), [
    ['invoice', '1', '2,050.00', '2,050.00'],
    ['invoice', '3', '198.31', '2,248.31'],
    ['payment', '', '-2,500.00', '-251.69'],
    ['invoice', '4', '340.00', '88.31'],
  ]);
});
