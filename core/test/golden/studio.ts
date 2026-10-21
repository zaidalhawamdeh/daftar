// Golden book 2: a design studio, books in US dollars, March 2026. Built only from documents:
// estimates, invoices, a sales receipt, payments (one overpaid, one voided), a credit memo, a
// purchase order received as a bill, bills, bill payments, a vendor credit, expenses, a transfer and
// a voided invoice. Every expected figure was computed by hand before the code ran.

import { execute } from '../../commands.ts';
import { createCompany, findAccount, type Company } from '../../company.ts';
import type { Doc } from '../../documents.ts';

export interface Studio {
  c: Company;
  doc: Record<string, Doc>;
}

export function studio(): Studio {
  const made = createCompany({ name: 'Cedar Design Studio', currency: 'USD' });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const run = <T>(id: string, p: Record<string, unknown>): T => {
    const r = execute(c, id, p);
    if (!r.ok) throw new Error(`${id}: ${r.error.message}`);
    return r.value as T;
  };
  const acct = (n: string) => findAccount(c, n)!.id;
  const live = (id: number) => c.documents.get(id)!;

  const atlas = run<{ id: string }>('customer.create', { name: 'Atlas Hotel', termsDays: 30 }).id;
  const nour = run<{ id: string }>('customer.create', { name: 'Nour Clinic', termsDays: 15 }).id;
  const printco = run<{ id: string }>('vendor.create', { name: 'PrintCo', termsDays: 30 }).id;
  const officeMart = run<{ id: string }>('vendor.create', { name: 'Office Mart' }).id;
  const hour = run<{ id: string }>('item.create', { name: 'Design hour', type: 'service', price: 8500, salesAccountId: acct('4100') }).id;
  const logo = run<{ id: string }>('item.create', { name: 'Logo package', type: 'service', price: 120000, salesAccountId: acct('4100') }).id;
  const brochure = run<{ id: string }>('item.create', {
    name: 'Printed brochures',
    type: 'non_inventory',
    price: 250,
    cost: 110,
    salesAccountId: acct('4000'),
    purchaseAccountId: acct('5000'),
  }).id;

  const doc: Record<string, Doc> = {};
  const keep = (name: string, d: Doc) => (doc[name] = live(d.id));

  // ---- sales
  const e1 = keep('E1', run('estimate.create', { customerId: atlas, date: '2026-03-01', lines: [{ itemId: logo }, { itemId: hour, quantity: '10' }] }));
  keep('INV1', run('estimate.toInvoice', { docId: e1.id, date: '2026-03-05' }));
  keep('INV2', run('invoice.create', { customerId: nour, date: '2026-03-10', lines: [{ itemId: hour, quantity: '7.5' }, { itemId: brochure, quantity: 500 }] }));
  keep('INV3', run('invoice.create', { customerId: atlas, date: '2026-03-12', lines: [{ itemId: hour, quantity: '2.333' }] }));
  keep('SR1', run('salesReceipt.create', { date: '2026-03-15', depositToId: acct('1000'), lines: [{ itemId: brochure, quantity: 100 }] }));
  keep('PAY1', run('payment.receive', {
    customerId: atlas,
    date: '2026-03-20',
    amount: 250000,
    depositToId: acct('1010'),
    applications: [{ docId: doc.INV1!.id, amount: 205000 }, { docId: doc.INV3!.id, amount: 19831 }],
  }));
  keep('PAY2', run('payment.receive', { customerId: nour, date: '2026-03-22', amount: 100000, depositToId: acct('1010'), applications: [{ docId: doc.INV2!.id, amount: 100000 }] }));
  keep('CM1', run('creditMemo.create', { customerId: nour, date: '2026-03-25', lines: [{ itemId: brochure, quantity: 40, description: 'Damaged in delivery' }] }));
  run('ar.apply', { sourceId: doc.CM1!.id, date: '2026-03-25', applications: [{ docId: doc.INV2!.id, amount: 10000 }] });
  keep('INV4', run('invoice.create', { customerId: atlas, date: '2026-03-26', lines: [{ itemId: hour, quantity: 4 }] }));
  run('ar.apply', { sourceId: doc.PAY1!.id, date: '2026-03-26', applications: [{ docId: doc.INV4!.id, amount: 25169 }] });
  keep('E2', run('estimate.create', { customerId: nour, date: '2026-03-27', lines: [{ itemId: hour, quantity: 3 }] }));
  keep('PAY3', run('payment.receive', { customerId: nour, date: '2026-03-30', amount: 5000, depositToId: acct('1010'), applications: [{ docId: doc.INV2!.id, amount: 5000 }] }));
  run('document.void', { docId: doc.PAY3!.id });
  keep('INV5', run('invoice.create', { customerId: nour, date: '2026-03-31', lines: [{ itemId: logo }] }));
  run('document.void', { docId: doc.INV5!.id });

  // ---- purchases
  const po = keep('PO1', run('purchaseOrder.create', { vendorId: printco, date: '2026-03-02', lines: [{ itemId: brochure, quantity: 1000 }] }));
  keep('BILL1', run('purchaseOrder.toBill', { docId: po.id, date: '2026-03-08', number: 'PC-881' }));
  keep('BILL2', run('bill.create', {
    vendorId: officeMart,
    date: '2026-03-09',
    number: 'OM-17',
    lines: [{ accountId: acct('6400'), amount: 14560, description: 'Paper and ink' }, { accountId: acct('1500'), amount: 89999, description: 'Large-format printer' }],
  }));
  keep('BP1', run('bill.pay', { vendorId: printco, date: '2026-03-18', amount: 60000, payFromId: acct('1010'), applications: [{ docId: doc.BILL1!.id, amount: 60000 }] }));
  keep('BP2', run('bill.pay', { vendorId: officeMart, date: '2026-03-19', amount: 104559, payFromId: acct('2100'), applications: [{ docId: doc.BILL2!.id, amount: 104559 }] }));
  keep('VC1', run('vendorCredit.create', { vendorId: printco, date: '2026-03-21', number: 'PC-CR1', lines: [{ itemId: brochure, quantity: 50 }] }));
  run('ap.apply', { sourceId: doc.VC1!.id, date: '2026-03-21', applications: [{ docId: doc.BILL1!.id, amount: 5500 }] });
  keep('EXP1', run('expense.create', { date: '2026-03-28', payFromId: acct('1010'), number: '1043', lines: [{ accountId: acct('6000'), amount: 150000, description: 'March rent' }] }));
  keep('EXP2', run('expense.create', { vendorId: officeMart, date: '2026-03-29', payFromId: acct('2100'), lines: [{ accountId: acct('6500'), amount: 7525 }] }));
  keep('TR1', run('transfer.create', { date: '2026-03-30', fromId: acct('1010'), toId: acct('1000'), amount: 30000 }));

  for (const k of Object.keys(doc)) doc[k] = live(doc[k]!.id);
  return { c, doc };
}

// Hand computation (dollars).
// Invoice 3: 2.333 h × 85.00 = 198.305 → 198.31 (half away from zero).
// Checking   = 2,500 + 1,000 − 600 − 1,500 − 300 (+50 − 50 voided)          = 1,100.00
// Cash       = 250 + 300                                                    =   550.00
// A/R        = 2,050 + 1,887.50 + 198.31 + 340 − 2,500 − 1,000 − 100 (inv 5 and pay 3 net to zero) = 875.81
//   Atlas 2,050 + 198.31 + 340 − 2,500 = 88.31; Nour 1,887.50 − 1,000 − 100 = 787.50
//   open: INV2 787.50, INV4 340 − 251.69 = 88.31; unapplied credits 0
// A/P        = 1,100 + 1,045.59 − 600 − 1,045.59 − 55                       =   445.00 (PrintCo)
// Credit card= 1,045.59 + 75.25                                             = 1,120.84
// Sales      = 1,250 + 250 − 100 = 1,400.00; Service income = 2,050 + 637.50 + 198.31 + 340 = 3,225.81
// COGS 1,100 − 55 = 1,045.00; Rent 1,500.00; Office supplies 145.60; Advertising 75.25
// P&L: income 4,625.81 − COGS 1,045.00 = gross 3,580.81 − expenses 1,720.85 = net 1,859.96
export const EXPECTED = {
  trialBalance: {
    rows: [
      ['1000', '550.00', ''],
      ['1010', '1,100.00', ''],
      ['1200', '875.81', ''],
      ['1500', '899.99', ''],
      ['2000', '', '445.00'],
      ['2100', '', '1,120.84'],
      ['4000', '', '1,400.00'],
      ['4100', '', '3,225.81'],
      ['5000', '1,045.00', ''],
      ['6000', '1,500.00', ''],
      ['6400', '145.60', ''],
      ['6500', '75.25', ''],
    ],
    total: '6,191.65',
  },
  profitAndLoss: { income: '4,625.81', costOfGoodsSold: '1,045.00', grossProfit: '3,580.81', expenses: '1,720.85', netIncome: '1,859.96' },
  balanceSheet: { assets: '3,425.80', liabilities: '1,565.84', netIncome: '1,859.96', liabilitiesAndEquity: '3,425.80' },
  customers: [['Atlas Hotel', '88.31'], ['Nour Clinic', '787.50']],
  vendors: [['PrintCo', '445.00']],
  openInvoices: [['Atlas Hotel', '4', '340.00', '88.31'], ['Nour Clinic', '2', '1,887.50', '787.50']],
  openInvoicesOn0321: [['Nour Clinic', '2', '1,887.50', '1,887.50']],
  unpaidBills: [['PrintCo', 'PC-881', '1,100.00', '445.00']],
  invoice3: '198.31',
};
