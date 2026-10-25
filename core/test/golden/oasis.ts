// Golden book 3: a Dubai trading company registered for UAE VAT, books in dirhams, the quarter
// July to September 2026. Standard-rated, zero-rated (an export of services) and exempt sales; a
// sales receipt whose prices include VAT; a credit note against an invoice; a standard-rated bill and
// expense, a vendor credit, a foreign software subscription under the reverse charge, a zero-rated
// flight; a voided invoice inside the quarter and a bill just after it. Every expected figure was
// computed by hand before its test ran.

import { execute } from '../../commands.ts';
import { createCompany, findAccount, type Company } from '../../company.ts';
import type { Doc } from '../../documents.ts';

export interface Oasis {
  c: Company;
  doc: Record<string, Doc>;
}

export function oasis(): Oasis {
  const made = createCompany({ name: 'Oasis Trading LLC', currency: 'AED' });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const run = <T>(id: string, p: Record<string, unknown>): T => {
    const r = execute(c, id, p);
    if (!r.ok) throw new Error(`${id}: ${r.error.message}`);
    return r.value as T;
  };
  const acct = (n: string) => findAccount(c, n)!.id;
  const live = (id: number) => c.documents.get(id)!;

  run('vat.setup', { trn: '100123456700003', emirate: 'DU', address: 'Office 1204, Al Fahidi Street, Bur Dubai, Dubai', from: '2026-07-01' });
  run('journal.post', { date: '2026-07-01', memo: 'Capital', lines: [{ accountId: acct('1010'), debit: 1000000 }, { accountId: acct('3000'), credit: 1000000 }] });

  const noor = run<{ id: string }>('customer.create', { name: 'Al Noor Trading', trn: '100987654300003', address: 'Deira, Dubai', termsDays: 30 }).id;
  const northwind = run<{ id: string }>('customer.create', { name: 'Northwind Ltd', address: 'London, United Kingdom' }).id;
  const marina = run<{ id: string }>('vendor.create', { name: 'Marina Properties', trn: '100555444300003', termsDays: 30 }).id;
  const cloudsoft = run<{ id: string }>('vendor.create', { name: 'CloudSoft Inc' }).id;
  const enoc = run<{ id: string }>('vendor.create', { name: 'ENOC' }).id;
  const airline = run<{ id: string }>('vendor.create', { name: 'Emirates Airline' }).id;

  const doc: Record<string, Doc> = {};
  const keep = (name: string, d: Doc) => (doc[name] = live(d.id));

  // ---- sales
  keep('INV1', run('invoice.create', { customerId: noor, date: '2026-07-05', lines: [{ accountId: acct('4100'), quantity: '3', rate: 125000, taxCode: 'SR', description: 'Consulting day' }] }));
  keep('INV2', run('invoice.create', { customerId: northwind, date: '2026-07-18', lines: [{ accountId: acct('4100'), rate: 200000, taxCode: 'ZR', description: 'Market study, exported' }] }));
  keep('INV3', run('invoice.create', {
    customerId: noor,
    date: '2026-08-02',
    lines: [
      { accountId: acct('4000'), quantity: '7', rate: 3333, taxCode: 'SR', description: 'Cartons' },
      { accountId: acct('7000'), rate: 50000, taxCode: 'EX', description: 'Late payment interest' },
    ],
  }));
  keep('SR1', run('salesReceipt.create', {
    date: '2026-08-10',
    depositToId: acct('1010'),
    taxInclusive: true,
    lines: [
      { accountId: acct('4000'), rate: 10500, taxCode: 'SR', description: 'Counter sale' },
      { accountId: acct('4000'), rate: 9999, taxCode: 'SR', description: 'Counter sale' },
    ],
  }));
  keep('CM1', run('creditMemo.create', { customerId: noor, date: '2026-08-20', refId: doc.INV1!.id, memo: 'One consulting day not delivered', lines: [{ accountId: acct('4100'), rate: 125000, taxCode: 'SR' }] }));
  keep('INV4', run('invoice.create', { customerId: noor, date: '2026-09-10', lines: [{ accountId: acct('4100'), rate: 50000, taxCode: 'SR' }] }));
  run('document.void', { docId: doc.INV4!.id });
  keep('INV4', live(doc.INV4!.id));

  // ---- purchases
  keep('BILL1', run('bill.create', { vendorId: marina, date: '2026-07-08', number: 'MP-311', lines: [{ accountId: acct('6000'), rate: 600000, taxCode: 'SR', description: 'Office rent, Q3' }] }));
  keep('BILL2', run('bill.create', { vendorId: cloudsoft, date: '2026-07-15', number: 'CS-88120', lines: [{ accountId: acct('6300'), rate: 36725, taxCode: 'RC', description: 'Software subscription' }] }));
  keep('EXP1', run('expense.create', { vendorId: enoc, date: '2026-08-12', payFromId: acct('1010'), lines: [{ accountId: acct('6600'), rate: 4762, taxCode: 'SR', description: 'Fuel' }] }));
  keep('VC1', run('vendorCredit.create', { vendorId: marina, date: '2026-09-01', number: 'MP-CN-4', refId: doc.BILL1!.id, lines: [{ accountId: acct('6000'), rate: 20000, taxCode: 'SR', description: 'Rent rebate' }] }));
  keep('EXP2', run('expense.create', { vendorId: airline, date: '2026-09-05', payFromId: acct('1010'), lines: [{ accountId: acct('6600'), rate: 180000, taxCode: 'ZR', description: 'Flight to London' }] }));
  keep('BILL3', run('bill.create', { vendorId: marina, date: '2026-10-02', number: 'MP-340', lines: [{ accountId: acct('6000'), rate: 100000, taxCode: 'SR', description: 'Office rent, October' }] }));

  return { c, doc };
}
