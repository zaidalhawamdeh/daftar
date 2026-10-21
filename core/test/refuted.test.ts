// Regressions for defects found by the adversarial review of 21 Oct 2026. Each test failed before its fix.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createAccount, createCompany, findAccount, setClosingDate, setFiscalYearStart, type Company } from '../company.ts';
import { postEntry } from '../journal.ts';
import { parseAmount } from '../money.ts';
import { balanceSheet, generalLedger, profitAndLoss, trialBalance } from '../reports.ts';

function fresh(fy = 1): Company {
  const r = createCompany({ name: 'Refuted Co', currency: 'USD', fiscalYearStartMonth: fy });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const id = (c: Company, k: string) => findAccount(c, k)!.id;
const sale = (c: Company, date: string, amount: number) =>
  postEntry(c, { date, lines: [{ accountId: id(c, '1000'), debit: amount }, { accountId: id(c, '4000'), credit: amount }] });
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error?.code);

test('#1 an income ledger spanning a year end restarts at zero and agrees with the trial balance', () => {
  const c = fresh();
  sale(c, '2024-12-10', 1000);
  sale(c, '2025-02-10', 400);
  const r = generalLedger(c, '2024-12-01', '2025-03-31', id(c, '4000'));
  assert.ok(r.ok);
  const [gl] = r.value;
  assert.deepEqual(gl!.lines.map((l) => l.balance), [1000, 400]);
  assert.equal(gl!.closing, 400);
  const tb = trialBalance(c, '2025-03-31');
  assert.ok(tb.ok);
  assert.equal(tb.value.rows.find((x) => x.number === '4000')!.credit, 400);
});

test('#2 the retained earnings ledger includes earlier years’ profit, as the trial balance does', () => {
  const c = fresh();
  sale(c, '2024-12-10', 1000);
  sale(c, '2025-02-10', 400);
  postEntry(c, { date: '2025-02-15', lines: [{ accountId: id(c, '3900'), debit: 50 }, { accountId: id(c, '1000'), credit: 50 }] });
  const inside = generalLedger(c, '2025-01-01', '2025-03-31', id(c, '3900'));
  assert.ok(inside.ok);
  assert.equal(inside.value[0]!.opening, 1000);
  assert.equal(inside.value[0]!.closing, 950);
  const across = generalLedger(c, '2024-12-01', '2025-03-31', id(c, '3900'));
  assert.ok(across.ok);
  const re = across.value[0]!;
  assert.equal(re.opening, 0);
  assert.deepEqual(re.lines.map((l) => [l.entryId, l.date, l.credit, l.debit, l.balance]), [
    [null, '2025-01-01', 1000, 0, 1000],
    [3, '2025-02-15', 0, 50, 950],
  ]);
  const tb = trialBalance(c, '2025-03-31');
  assert.ok(tb.ok);
  assert.equal(tb.value.rows.find((x) => x.number === '3900')!.credit, re.closing);
});

test('#3 report totals beyond exact integer range are refused, not rounded', () => {
  const c = fresh();
  const big = Number.MAX_SAFE_INTEGER;
  const inc = ['4000', '4100', '4900'];
  const cash = ['1000', '1010', '1200'];
  const amounts = [big, big, 1];
  amounts.forEach((m, i) => postEntry(c, { date: '2026-01-05', lines: [{ accountId: id(c, cash[i]!), debit: m }, { accountId: id(c, inc[i]!), credit: m }] }));
  assert.equal(code(profitAndLoss(c, '2026-01-01', '2026-12-31')), 'amount.too_large');
  assert.equal(code(balanceSheet(c, '2026-12-31')), 'amount.too_large');
  assert.equal(code(trialBalance(c, '2026-12-31')), 'amount.too_large');
});

test('#4 the fiscal year cannot change once closed periods hold entries', () => {
  const c = fresh();
  sale(c, '2024-03-10', 100);
  sale(c, '2024-10-10', 200);
  setClosingDate(c, '2024-12-31');
  assert.equal(code(execute(c, 'company.setFiscalYearStart', { month: 7 })), 'fiscal_year.closed');
  assert.equal(c.fiscalYearStartMonth, 1);
  const open = fresh();
  sale(open, '2024-03-10', 100);
  assert.equal(code(setFiscalYearStart(open, 7)), 'ok', 'with nothing closed, the owner may still change it');
});

test('#5 results handed out by commands cannot reach the books', () => {
  const c = fresh();
  const posted = execute(c, 'journal.post', { date: '2026-01-05', lines: [{ accountId: id(c, '1000'), debit: 300 }, { accountId: id(c, '4000'), credit: 300 }] });
  assert.ok(posted.ok);
  (posted.value as { lines: { debit: number }[] }).lines[0]!.debit = 999;
  const list = execute(c, 'journal.list');
  assert.ok(list.ok);
  (list.value as unknown[]).pop();
  const accounts = execute(c, 'account.list');
  assert.ok(accounts.ok);
  (accounts.value as { name: string }[])[0]!.name = 'hacked';
  assert.equal(c.entries.length, 1);
  assert.equal(c.entries[0]!.lines[0]!.debit, 300);
  assert.notEqual([...c.accounts.values()][0]!.name, 'hacked');
  assert.throws(() => {
    (c.entries[0]!.lines[0] as { debit: number }).debit = 1;
  }, 'posted entries are frozen even inside the core');
  const tb = trialBalance(c, '2026-12-31');
  assert.ok(tb.ok && tb.value.totalDebit === 300 && tb.value.totalCredit === 300);
});

test('#6 reopening closed periods must be confirmed, and is logged', () => {
  const c = fresh();
  assert.equal(code(setClosingDate(c, '2024-12-31')), 'ok');
  assert.equal(code(setClosingDate(c, '2025-06-30')), 'ok', 'moving the lock later needs no confirmation');
  assert.equal(code(setClosingDate(c, null)), 'closing.reopen');
  assert.equal(code(setClosingDate(c, '2025-01-31')), 'closing.reopen');
  assert.equal(c.closingDate, '2025-06-30');
  assert.equal(code(execute(c, 'company.setClosingDate', { date: '2025-01-31', reopen: true })), 'ok');
  assert.deepEqual(c.closingDateLog, [
    { from: null, to: '2024-12-31' },
    { from: '2024-12-31', to: '2025-06-30' },
    { from: '2025-06-30', to: '2025-01-31' },
  ]);
});

test('#7 ambiguous amounts are refused instead of misread', () => {
  const USD = { code: 'USD', digits: 2 };
  for (const bad of ['(-5)', '-(5)', '12,50', '1,5', '1,23,456', '1 2', '1,2345.00', ',123']) {
    assert.equal(parseAmount(bad, USD).ok, false, bad);
  }
  for (const [good, minor] of [['1,234', 123400], ['12,345,678.90', 1234567890], ['(1,234.50)', -123450], ['1 234.50', 123450]] as const) {
    const r = parseAmount(good, USD);
    assert.ok(r.ok, good);
    assert.equal(r.value, minor, good);
  }
});

test('#8 core functions given junk return problems instead of throwing', () => {
  const c = fresh();
  assert.equal(code(createCompany(null as never)), 'company.invalid');
  assert.equal(code(createAccount(c, null as never)), 'account.invalid');
  assert.equal(code(execute(c, 'account.update', { id: id(c, '6000') })), 'ok');
  assert.equal(findAccount(c, 5), undefined);
});

test('#9 no negative zero in ledger openings; invisible characters do not dodge unique names', () => {
  const c = fresh();
  sale(c, '2026-01-05', 100);
  postEntry(c, { date: '2026-01-06', lines: [{ accountId: id(c, '4000'), debit: 100 }, { accountId: id(c, '1000'), credit: 100 }] });
  const gl = generalLedger(c, '2026-02-01', '2026-02-28');
  assert.ok(gl.ok);
  for (const a of gl.value) assert.ok(!Object.is(a.opening, -0), a.name);
  const sales = generalLedger(c, '2026-01-01', '2026-01-31', id(c, '4000'));
  assert.ok(sales.ok && !Object.is(sales.value[0]!.closing, -0));
  assert.equal(code(createAccount(c, { name: 'Rent​', type: 'expense' })), 'account.name_taken');
});
