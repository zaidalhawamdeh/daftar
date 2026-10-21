// IIF import and export. The golden file below is written the way QuickBooks Desktop exports one;
// every expected figure was computed by hand before the importer ran.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createCompany, type Company } from '../company.ts';
import { exportIif, iifDate, importIif, readIif } from '../import/iif.ts';
import { checkIntegrity } from '../integrity.ts';
import { formatAmount } from '../money.ts';
import { profitAndLoss, trialBalance } from '../reports.ts';
import { openInvoices, partyBalances } from '../subledger.ts';
import { studio } from './golden/studio.ts';

const T = (...cells: string[]) => cells.join('\t');
const GOLDEN = [
  T('!ACCNT', 'NAME', 'ACCNTTYPE', 'DESC', 'ACCNUM'),
  T('ACCNT', 'Checking', 'BANK', '', '1010'),
  T('ACCNT', 'Petty Cash', 'BANK', '', '1020'),
  T('ACCNT', 'Undeposited Funds', 'OCASSET', '', '1499'),
  T('ACCNT', 'Accounts Receivable', 'AR', '', '1200'),
  T('ACCNT', 'Accounts Payable', 'AP', '', '2000'),
  T('ACCNT', 'Owner Equity', 'EQUITY', '', '3000'),
  T('ACCNT', 'Retained Earnings', 'EQUITY', '', ''),
  T('ACCNT', 'Consulting Income', 'INC', '', '4100'),
  T('ACCNT', 'Sales', 'INC', '', '4000'),
  T('ACCNT', 'Utilities', 'EXP', '', '6200'),
  T('ACCNT', 'Utilities:Electric', 'EXP', '', '6210'),
  T('ACCNT', 'Rent', 'EXP', '', '6000'),
  T('ACCNT', 'Bad Debt', 'EXP', '', '6900'),
  T('ACCNT', 'Estimates', 'NONPOSTING', '', ''),
  T('!CUST', 'NAME', 'BADDR1', 'BADDR2', 'PHONE1', 'EMAIL', 'TERMS'),
  T('CUST', 'Acme Co', '12 Main St', 'Amman', '0790000001', 'ap@acme.example', 'Net 30'),
  T('CUST', 'Bayt Cafe', '', '', '', '', ''),
  T('!VEND', 'NAME', 'ADDR1', 'PHONE1', 'TERMS'),
  T('VEND', 'City Power', 'Utility Rd', '065000000', 'Net 15'),
  T('VEND', 'Landlord LLC', '', '', ''),
  T('!INVITEM', 'NAME', 'INVITEMTYPE', 'DESC', 'PRICE', 'ACCNT'),
  T('INVITEM', 'Consulting', 'SERV', 'Hourly consulting', '100.00', 'Consulting Income'),
  T('INVITEM', 'Gift Set', 'GRP', '', '', ''),
  T('!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO'),
  T('!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'INVITEM', 'QNTY', 'PRICE'),
  T('!ENDTRNS'),
  T('TRNS', '', 'GENERAL JOURNAL', '01/05/2026', 'Checking', '', '5000.00', '', 'Owner investment'),
  T('SPL', '', 'GENERAL JOURNAL', '01/05/2026', 'Owner Equity', '', '-5000.00', '', ''),
  'ENDTRNS',
  T('TRNS', '', 'INVOICE', '01/10/2026', 'Accounts Receivable', 'Acme Co', '1500.00', '101', ''),
  T('SPL', '', 'INVOICE', '01/10/2026', 'Consulting Income', '', '-1500.00', '101', 'Strategy work', 'Consulting', '-15', '100.00'),
  'ENDTRNS',
  T('TRNS', '', 'INVOICE', '01/12/26', 'Accounts Receivable', 'Bayt Cafe', '250.75', '102', ''),
  T('SPL', '', 'INVOICE', '01/12/26', 'Sales', '', '-250.75', '102', 'Menu printing'),
  'ENDTRNS',
  T('TRNS', '', 'PAYMENT', '01/20/2026', 'Undeposited Funds', 'Acme Co', '1000.00', '', ''),
  T('SPL', '', 'PAYMENT', '01/20/2026', 'Accounts Receivable', 'Acme Co', '-1000.00', '', ''),
  'ENDTRNS',
  T('TRNS', '', 'DEPOSIT', '01/21/2026', 'Checking', '', '1000.00', '', 'Deposit'),
  T('SPL', '', 'DEPOSIT', '01/21/2026', 'Undeposited Funds', '', '-1000.00', '', ''),
  'ENDTRNS',
  T('TRNS', '', 'BILL', '01/25/2026', 'Accounts Payable', 'City Power', '-180.40', 'CP-1', ''),
  T('SPL', '', 'BILL', '01/25/2026', 'Utilities:Electric', '', '180.40', 'CP-1', 'January power'),
  'ENDTRNS',
  T('TRNS', '', 'BILL PMT -CHECK', '01/28/2026', 'Checking', 'City Power', '-180.40', '2001', ''),
  T('SPL', '', 'BILL PMT -CHECK', '01/28/2026', 'Accounts Payable', 'City Power', '180.40', '2001', ''),
  'ENDTRNS',
  T('TRNS', '', 'CHECK', '01/31/2026', 'Checking', 'Landlord LLC', '-900.00', '1001', 'January rent'),
  T('SPL', '', 'CHECK', '01/31/2026', 'Rent', '', '900.00', '1001', ''),
  'ENDTRNS',
  T('TRNS', '', 'GENERAL JOURNAL', '02/02/2026', 'Bad Debt', '', '50.75', '', 'Write off'),
  T('SPL', '', 'GENERAL JOURNAL', '02/02/2026', 'Accounts Receivable', 'Bayt Cafe', '-50.75', '', ''),
  'ENDTRNS',
  T('TRNS', '', 'CASH SALE', '02/05/2026', 'Undeposited Funds', 'Bayt Cafe', '80.00', '7', ''),
  T('SPL', '', 'CASH SALE', '02/05/2026', 'Sales', '', '-80.00', '7', 'Flyers'),
  'ENDTRNS',
  T('TRNS', '', 'TRANSFER', '02/06/2026', 'Petty Cash', '', '300.00', '', ''),
  T('SPL', '', 'TRANSFER', '02/06/2026', 'Checking', '', '-300.00', '', ''),
  'ENDTRNS',
  T('TRNS', '', 'CREDIT MEMO', '02/10/2026', 'Accounts Receivable', 'Acme Co', '-100.00', 'CM1', ''),
  T('SPL', '', 'CREDIT MEMO', '02/10/2026', 'Consulting Income', '', '100.00', 'CM1', 'Discount'),
  'ENDTRNS',
].join('\r\n');

function empty(currency = 'USD'): Company {
  const r = createCompany({ name: 'Imported Co', currency, template: 'none' });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const must = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

test('IIF reading: headers, quoted cells, dates', () => {
  const rows = must(readIif('!CUST\tNAME\tNOTE\r\nCUST\t"Quote ""Co"""\tx\r\n'));
  assert.equal(rows[0]!.f.NAME, 'Quote "Co"');
  assert.equal(readIif('CUST\tLost\n').ok, false, 'a row before its header');
  assert.deepEqual(['1/2/2026', '01/02/26', '12/31/99', '2026-03-04', '2/30/2026', 'x'].map(iifDate), ['2026-01-02', '2026-01-02', '1999-12-31', '2026-03-04', null, null]);
});

test('golden IIF: lists, every transaction kind, balances to the cent', () => {
  const c = empty();
  const s = must(importIif(c, GOLDEN));
  const f = (m: number) => formatAmount(m, c.currency);
  assert.equal(s.accounts, 12, 'Retained Earnings maps onto the existing one; non-posting is skipped');
  assert.deepEqual([s.customers, s.vendors, s.items, s.transactions], [2, 2, 1, 12]);
  assert.deepEqual(s.documents, { invoice: 2, payment: 1, bill: 1, bill_payment: 1, expense: 1, credit_memo: 2, sales_receipt: 1, transfer: 1 });
  assert.deepEqual([s.journalEntries, s.throughClearing, s.applied], [3, 1, 4], 'payment, two credit memos and the bill payment');
  assert.ok(s.warnings.some((w) => w.includes('Gift Set')), 'unsupported item types are reported, not hidden');

  const tb = must(trialBalance(c, '2026-02-28'));
  assert.deepEqual(tb.rows.map((r) => [r.name, r.debit ? f(r.debit) : '', r.credit ? f(r.credit) : '']), [
    ['Checking', '4,619.60', ''],
    ['Petty Cash', '300.00', ''],
    ['Accounts Receivable', '600.00', ''],
    ['Undeposited Funds', '80.00', ''],
    ['Owner Equity', '', '5,000.00'],
    ['Sales', '', '330.75'],
    ['Consulting Income', '', '1,400.00'],
    ['Rent', '900.00', ''],
    ['Electric', '180.40', ''],
    ['Bad Debt', '50.75', ''],
  ]);
  assert.equal(f(tb.totalDebit), '6,730.75');
  const pl = must(profitAndLoss(c, '2026-01-01', '2026-02-28'));
  assert.equal(f(pl.netIncome), '599.60');
  // Payments and credits were applied oldest first.
  assert.deepEqual(must(openInvoices(c, '2026-02-28')).rows.map((r) => [r.name, r.number, f(r.open)]), [['Acme Co', '101', '400.00'], ['Bayt Cafe', '102', '200.00']]);
  assert.deepEqual(must(partyBalances(c, 'customer', '2026-02-28')).rows.map((r) => [r.name, f(r.balance)]), [['Acme Co', '400.00'], ['Bayt Cafe', '200.00']]);
  assert.equal([...c.parties.values()].find((p) => p.name === 'Acme Co')!.termsDays, 30);
  assert.equal([...c.accounts.values()].find((a) => a.name === 'Electric')!.parentId, [...c.accounts.values()].find((a) => a.name === 'Utilities')!.id);
  assert.deepEqual(checkIntegrity(c), { ok: true, value: true });
});

test('a bad file changes nothing: the whole import is refused', () => {
  const c = empty();
  const before = structuredClone(c);
  const broken = GOLDEN.replace('-180.40\tCP-1\t\r\n', '-180.41\tCP-1\t\r\n');
  const r = execute(c, 'import.iif', { text: broken });
  assert.equal(r.ok, false);
  assert.deepEqual(c, before);
  for (const junk of ['', 'garbage', '!TRNS\tDATE\nTRNS\tnot-a-date\nENDTRNS', '\u0000\u0001', '!ACCNT\tNAME\tACCNTTYPE\nACCNT\t\tBANK']) {
    const x = execute(c, 'import.iif', { text: junk });
    assert.equal(x.ok, false, JSON.stringify(junk));
    assert.deepEqual(c, before);
  }
});

test('round trip: export a company to IIF, import it into an empty one, the books match', () => {
  const { c: original } = studio();
  const text = exportIif(original);
  const copy = empty();
  const s = must(importIif(copy, text));
  assert.equal(s.warnings.length, 0, s.warnings.join('; '));
  const byName = (c: Company) => {
    const tb = must(trialBalance(c, '2026-12-31'));
    return Object.fromEntries(tb.rows.filter((r) => r.name !== 'Import clearing').map((r) => [r.name, r.debit - r.credit]));
  };
  assert.deepEqual(byName(copy), byName(original));
  const parties = (c: Company) => must(partyBalances(c, 'customer', '2026-12-31')).rows.map((r) => [r.name, r.balance]);
  assert.deepEqual(parties(copy), parties(original));
  assert.equal(must(openInvoices(copy, '2026-12-31')).total, must(openInvoices(original, '2026-12-31')).total);
  assert.deepEqual(checkIntegrity(copy), { ok: true, value: true });
});

test('round trip holds for random companies too', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const c = randomCompany(seed);
    const copy = empty();
    const s = importIif(copy, exportIif(c));
    assert.ok(s.ok, `seed ${seed}: ${s.ok ? '' : s.error.message}`);
    for (const d of ['2026-03-31', '2026-06-30']) {
      const a = must(trialBalance(c, d));
      const b = must(trialBalance(copy, d));
      const m = (tb: typeof a) => Object.fromEntries(tb.rows.filter((r) => r.name !== 'Import clearing').map((r) => [r.name, r.debit - r.credit]));
      assert.deepEqual(m(b), m(a), `seed ${seed} ${d}`);
      assert.deepEqual(must(partyBalances(copy, 'vendor', d)).rows.map((r) => [r.name, r.balance]), must(partyBalances(c, 'vendor', d)).rows.map((r) => [r.name, r.balance]), `seed ${seed}`);
    }
    assert.deepEqual(checkIntegrity(copy), { ok: true, value: true }, `seed ${seed}`);
  }
});

function randomCompany(seed: number): Company {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const made = createCompany({ name: `Random ${seed}`, currency: 'USD' });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const id = (n: string) => [...c.accounts.values()].find((a) => a.number === n)!.id;
  const run = (cmd: string, p: Record<string, unknown>) => execute(c, cmd, p);
  const cust = ['Ann', 'Basma'].map((name) => (run('customer.create', { name, termsDays: 30 }) as { value: { id: string } }).value.id);
  const vend = ['Omar', 'Zain'].map((name) => (run('vendor.create', { name }) as { value: { id: string } }).value.id);
  const day = () => `2026-0${int(1, 6)}-${String(int(1, 28)).padStart(2, '0')}`;
  for (let i = 0; i < 40; i++) {
    const r = rand();
    const amount = int(1, 500000);
    if (r < 0.25) run('invoice.create', { customerId: cust[int(0, 1)], date: day(), lines: [{ accountId: id('4100'), amount }, { accountId: id('4000'), amount: int(1, 9999) }] });
    else if (r < 0.4) run('bill.create', { vendorId: vend[int(0, 1)], date: day(), lines: [{ accountId: id('6400'), amount }] });
    else if (r < 0.55) run('payment.receive', { customerId: cust[int(0, 1)], date: day(), amount, depositToId: id('1010') });
    else if (r < 0.65) run('bill.pay', { vendorId: vend[int(0, 1)], date: day(), amount, payFromId: rand() < 0.5 ? id('1010') : id('2100') });
    else if (r < 0.72) run('vendorCredit.create', { vendorId: vend[int(0, 1)], date: day(), lines: [{ accountId: id('6400'), amount }] });
    else if (r < 0.8) run('expense.create', { date: day(), payFromId: id('1010'), lines: [{ accountId: id('6000'), amount }] });
    else if (r < 0.86) run('journal.post', { date: day(), lines: [{ accountId: id('1010'), debit: amount }, { accountId: id('3000'), credit: amount }] });
    else if (r < 0.92) run('transfer.create', { date: day(), fromId: id('1010'), toId: id('1000'), amount });
    else {
      const d = [...c.documents.values()][int(0, Math.max(0, c.documents.size - 1))];
      if (d) run('document.void', { docId: d.id });
    }
  }
  return c;
}
