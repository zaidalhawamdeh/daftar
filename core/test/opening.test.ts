import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../commands.ts';
import { createCompany, findAccount, type Company } from '../company.ts';
import { parseCsv } from '../import/csv.ts';
import { checkIntegrity } from '../integrity.ts';
import { formatAmount } from '../money.ts';
import { trialBalance } from '../reports.ts';
import { aging, openInvoices, unpaidBills } from '../subledger.ts';

type R = { ok: boolean; value?: any; error?: { code: string; message: string } };
const code = (r: R) => (r.ok ? 'ok' : r.error!.code);
const fresh = (): Company => {
  const r = createCompany({ name: 'Moving In', currency: 'USD' });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const TB = [
  'Account,Debit,Credit',
  '1010 · Checking Account,"12,500.00",',
  'Accounts Receivable,"3,200.00",',
  '1500,"8,000.00",',
  'Accounts Payable,,"1,450.50"',
  'Loans Payable,,"6,000.00"',
  "Owner's Capital,,\"10,000.00\"",
  'Retained Earnings,,"6,249.50"',
  'Total,"23,700.00","23,700.00"',
].join('\r\n');
const INVOICES = ['Customer,Num,Date,Due Date,Open Balance', 'Atlas Hotel,1001,11/15/2025,12/15/2025,"2,000.00"', 'Nour Clinic,1002,12/20/2025,01/19/2026,"1,200.00"'].join('\n');
const BILLS = ['Vendor,Num,Date,Due Date,Amount', 'PrintCo,B-9,12/28/2025,01/27/2026,1450.50'].join('\n');

test('CSV: quotes, embedded commas and quotes, semicolons, BOM, CRLF', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, ""y""",2\r\n'), { headers: ['a', 'b'], rows: [['x, "y"', '2']] });
  assert.deepEqual(parseCsv('a;b\n1;2\n').rows, [['1', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2').rows, [['1', '2']]);
});

test('opening balances: trial balance, open invoices and unpaid bills come in exactly', () => {
  const c = fresh();
  const f = (m: number) => formatAmount(m, c.currency);
  const r = execute(c, 'import.openingBalances', { date: '12/31/2025', trialBalance: TB, openInvoices: INVOICES, unpaidBills: BILLS }) as R;
  assert.equal(code(r), 'ok', r.error?.message);
  assert.deepEqual([r.value.invoices, r.value.bills, r.value.newCustomers, r.value.newVendors, r.value.difference], [2, 1, 2, 1, 0]);
  const tb = trialBalance(c, '2025-12-31');
  assert.ok(tb.ok);
  assert.deepEqual(tb.value.rows.map((x) => [x.number, x.debit ? f(x.debit) : '', x.credit ? f(x.credit) : '']), [
    ['1010', '12,500.00', ''],
    ['1200', '3,200.00', ''],
    ['1500', '8,000.00', ''],
    ['2000', '', '1,450.50'],
    ['2700', '', '6,000.00'],
    ['3000', '', '10,000.00'],
    ['3900', '', '6,249.50'],
  ]);
  const ag = aging(c, 'customer', '2026-01-31');
  assert.ok(ag.ok);
  assert.deepEqual(ag.value.totals.map(f), ['0.00', '1,200.00', '2,000.00', '0.00', '0.00'], 'Atlas 47 days late, Nour 12');
  assert.ok(openInvoices(c, '2026-01-31').ok && unpaidBills(c, '2026-01-31').ok);
  assert.equal((unpaidBills(c, '2026-01-31') as { value: { rows: { number: string }[] } }).value.rows[0]!.number, 'B-9');
  assert.deepEqual(checkIntegrity(c), { ok: true, value: true });
});

test('opening balances refuse what does not add up, and change nothing when they do', () => {
  const c = fresh();
  const before = structuredClone(c);
  const attempt = (p: Record<string, unknown>) => code(execute(c, 'import.openingBalances', { date: '2025-12-31', trialBalance: TB, openInvoices: INVOICES, unpaidBills: BILLS, ...p }) as R);
  assert.equal(attempt({ openInvoices: INVOICES.split('\n').slice(0, 2).join('\n') }), 'opening.docs_mismatch');
  assert.equal(attempt({ unpaidBills: undefined }), 'opening.docs_missing');
  assert.equal(attempt({ trialBalance: TB.replace('Loans Payable', 'Mystery Account') }), 'opening.accounts_missing');
  assert.equal(attempt({ trialBalance: 'Foo,Bar\n1,2' }), 'opening.tb_columns');
  assert.equal(attempt({ date: 'soon' }), 'date.invalid');
  assert.equal(attempt({ openInvoices: INVOICES.replace('"2,000.00"', 'lots') }), 'opening.amount');
  assert.deepEqual(c, before);
  // A trial balance that is out is accepted, the difference parked in Opening Balance Equity and reported.
  const out = execute(c, 'import.openingBalances', { date: '2025-12-31', trialBalance: TB.replace('"6,249.50"', '"6,000.00"'), openInvoices: INVOICES, unpaidBills: BILLS }) as R;
  assert.equal(code(out), 'ok');
  assert.equal(out.value.difference, 24950);
  assert.ok(out.value.warnings[0].includes('249.50'));
});

test('lists: accounts with QuickBooks type names and nesting, customers, items', () => {
  const c = fresh();
  const accts = execute(c, 'import.list', { kind: 'account', text: 'Account,Type,Number\nVehicles,Fixed Asset,1600\nVehicles:Van,Fixed Asset,1610\nMarketing:Online Ads,Expense,6510\nRent,Expense,\n' }) as R;
  assert.equal(code(accts), 'ok');
  assert.equal(accts.value.added, 4, 'Vehicles, Van, Marketing (the parent of a path) and Online Ads');
  assert.deepEqual(accts.value.skipped, ['Rent']);
  assert.equal(findAccount(c, '1610')!.parentId, findAccount(c, '1600')!.id);
  assert.equal(code(execute(c, 'import.list', { kind: 'account', text: 'Account,Type\nX,Spaceship\n' }) as R), 'list.type');
  const cust = execute(c, 'import.list', { kind: 'customer', text: 'Name,Phone,Email,Terms\nHuda Store,0791111111,huda@example.com,Net 15\n"Al-Noor, LLC",,,\n' }) as R;
  assert.equal(cust.value.added, 2);
  assert.equal([...c.parties.values()].find((p) => p.name === 'Huda Store')!.termsDays, 15);
  const items = execute(c, 'import.list', { kind: 'item', text: 'Item,Type,Price,Income Account\nInstallation,Service,"1,250.00",4100\nCable,Non-inventory Part,2.5,Sales\n' }) as R;
  assert.equal(code(items), 'ok', items.error?.message);
  assert.deepEqual([...c.items.values()].map((i) => [i.name, i.type, i.price]), [['Installation', 'service', 125000], ['Cable', 'non_inventory', 250]]);
  assert.deepEqual(checkIntegrity(c), { ok: true, value: true });
});
