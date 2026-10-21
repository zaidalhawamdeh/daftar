// Golden book 1: a small bakery in Amman, books in Jordanian dinars (3 decimals).
// Every expected figure below was computed by hand, line by line, before the reports existed.
// If a report disagrees with this file, the report is wrong until proven otherwise.

import { createCompany, createAccount, findAccount, type Company } from '../../company.ts';
import { postEntry, reverseEntry } from '../../journal.ts';
import { parseAmount } from '../../money.ts';
import { createParty } from '../../parties.ts';

export function bakery(): Company {
  const made = createCompany({ name: 'Golden Bakery', currency: 'JOD', template: 'none' });
  if (!made.ok) throw new Error(made.error.message);
  const c = made.value;
  const accounts: [string, string, Parameters<typeof createAccount>[1]['type']][] = [
    ['1000', 'Cash', 'bank'],
    ['1100', 'Arab Bank', 'bank'],
    ['1200', 'Accounts Receivable', 'accounts_receivable'],
    ['1500', 'Equipment', 'fixed_asset'],
    ['1510', 'Accumulated Depreciation', 'fixed_asset'],
    ['2000', 'Accounts Payable', 'accounts_payable'],
    ['2500', 'Bank Loan', 'long_term_liability'],
    ['3000', "Owner's Capital", 'equity'],
    ['4000', 'Sales', 'income'],
    ['5000', 'Cost of Goods Sold', 'cost_of_goods_sold'],
    ['6000', 'Rent', 'expense'],
    ['6100', 'Utilities', 'expense'],
    ['6200', 'Salaries', 'expense'],
    ['6300', 'Depreciation', 'expense'],
    ['7000', 'Interest Income', 'other_income'],
    ['8000', 'Bank Charges', 'other_expense'],
  ];
  for (const [number, name, type] of accounts) {
    const r = createAccount(c, { number, name, type });
    if (!r.ok) throw new Error(r.error.message);
  }

  const hotel = createParty(c, 'customer', { name: 'Grand Hotel', termsDays: 30 });
  const mill = createParty(c, 'vendor', { name: 'Flour Mill', termsDays: 15 });
  if (!hotel.ok || !mill.ok) throw new Error('parties');
  const partyFor: Record<string, string> = { '1200': hotel.value.id, '2000': mill.value.id };

  const money = (s: string) => {
    const r = parseAmount(s, c.currency);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const id = (n: string) => {
    const a = findAccount(c, n);
    if (!a) throw new Error(`no account ${n}`);
    return a.id;
  };
  const post = (date: string, memo: string, lines: [string, 'Dr' | 'Cr', string][]) => {
    const r = postEntry(c, {
      date,
      memo,
      lines: lines.map(([n, side, amt]) => ({ accountId: id(n), debit: side === 'Dr' ? money(amt) : 0, credit: side === 'Cr' ? money(amt) : 0, partyId: partyFor[n] ?? null })),
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  // ---- fiscal year 2025
  post('2025-12-01', 'Owner invests', [['1100', 'Dr', '20,000.000'], ['3000', 'Cr', '20,000.000']]);
  post('2025-12-05', 'Oven and mixer', [['1500', 'Dr', '8,500.000'], ['1100', 'Cr', '8,500.000']]);
  post('2025-12-15', 'Cash sales', [['1000', 'Dr', '2,340.750'], ['4000', 'Cr', '2,340.750']]);
  post('2025-12-20', 'Flour on credit', [['5000', 'Dr', '910.250'], ['2000', 'Cr', '910.250']]);
  post('2025-12-31', 'December rent', [['6000', 'Dr', '650.000'], ['1100', 'Cr', '650.000']]);
  // ---- fiscal year 2026
  post('2026-01-03', 'Loan received', [['1100', 'Dr', '5,000.000'], ['2500', 'Cr', '5,000.000']]);
  post('2026-01-10', 'Hotel order on credit', [['1200', 'Dr', '3,125.125'], ['4000', 'Cr', '3,125.125']]);
  post('2026-01-12', 'Cash sales', [['1000', 'Dr', '1,480.500'], ['4000', 'Cr', '1,480.500']]);
  post('2026-01-15', 'Pay flour supplier', [['2000', 'Dr', '910.250'], ['1100', 'Cr', '910.250']]);
  post('2026-01-18', 'Flour on credit', [['5000', 'Dr', '1,204.875'], ['2000', 'Cr', '1,204.875']]);
  post('2026-01-20', 'Hotel pays part', [['1100', 'Dr', '2,000.000'], ['1200', 'Cr', '2,000.000']]);
  const wrong = post('2026-01-22', 'Rent typed twice by mistake', [['6000', 'Dr', '999.000'], ['1000', 'Cr', '999.000']]);
  const rev = reverseEntry(c, { entryId: wrong.id, date: '2026-01-23' });
  if (!rev.ok) throw new Error(rev.error.message);
  post('2026-01-25', 'January salaries', [['6200', 'Dr', '1,350.000'], ['1100', 'Cr', '1,350.000']]);
  post('2026-01-28', 'Electricity and water, split', [['6100', 'Dr', '187.335'], ['1000', 'Cr', '87.335'], ['1100', 'Cr', '100.000']]);
  post('2026-01-31', 'January depreciation', [['6300', 'Dr', '141.667'], ['1510', 'Cr', '141.667']]);
  post('2026-01-31', 'Bank interest', [['1100', 'Dr', '12.400'], ['7000', 'Cr', '12.400']]);
  post('2026-01-31', 'Bank charges', [['8000', 'Dr', '3.500'], ['1100', 'Cr', '3.500']]);
  return c;
}

// Hand computation (dinars).
// Cash      = 2,340.750 + 1,480.500 − 999.000 + 999.000 − 87.335                     = 3,733.915
// Arab Bank = 20,000 − 8,500 − 650 + 5,000 − 910.250 + 2,000 − 1,350 − 100 + 12.400 − 3.500 = 15,498.650
// A/R       = 3,125.125 − 2,000.000                                                  = 1,125.125
// A/P       = 910.250 − 910.250 + 1,204.875 (credit)                                 = 1,204.875
// FY2025 net income = 2,340.750 − 910.250 − 650.000                                  =   780.500
// FY2026 (to 31 Jan): sales 3,125.125 + 1,480.500 = 4,605.625; COGS 1,204.875; gross 3,400.750;
//   expenses 1,350 + 187.335 + 141.667 = 1,679.002 (rent nets to zero after the reversal);
//   operating 1,721.748; other 12.400 − 3.500 = 8.900; net income 1,730.648.
export const EXPECTED = {
  trialBalance_2026_01_31: {
    rows: [
      ['1000', 'Cash', '3,733.915', ''],
      ['1100', 'Arab Bank', '15,498.650', ''],
      ['1200', 'Accounts Receivable', '1,125.125', ''],
      ['1500', 'Equipment', '8,500.000', ''],
      ['1510', 'Accumulated Depreciation', '', '141.667'],
      ['2000', 'Accounts Payable', '', '1,204.875'],
      ['2500', 'Bank Loan', '', '5,000.000'],
      ['3000', "Owner's Capital", '', '20,000.000'],
      ['3900', 'Retained Earnings', '', '780.500'],
      ['4000', 'Sales', '', '4,605.625'],
      ['5000', 'Cost of Goods Sold', '1,204.875', ''],
      ['6100', 'Utilities', '187.335', ''],
      ['6200', 'Salaries', '1,350.000', ''],
      ['6300', 'Depreciation', '141.667', ''],
      ['7000', 'Interest Income', '', '12.400'],
      ['8000', 'Bank Charges', '3.500', ''],
    ],
    total: '31,745.067',
  },
  profitAndLoss_2026_01: {
    income: '4,605.625',
    costOfGoodsSold: '1,204.875',
    grossProfit: '3,400.750',
    expenses: '1,679.002',
    netOperatingIncome: '1,721.748',
    otherIncome: '12.400',
    otherExpenses: '3.500',
    netOtherIncome: '8.900',
    netIncome: '1,730.648',
  },
  profitAndLoss_2025_12: { income: '2,340.750', costOfGoodsSold: '910.250', grossProfit: '1,430.500', expenses: '650.000', netIncome: '780.500' },
  balanceSheet_2026_01_31: {
    bank: '19,232.565',
    receivable: '1,125.125',
    fixed: '8,358.333',
    assets: '28,716.023',
    payable: '1,204.875',
    longTerm: '5,000.000',
    liabilities: '6,204.875',
    capital: '20,000.000',
    retainedEarnings: '780.500',
    netIncome: '1,730.648',
    equity: '22,511.148',
    liabilitiesAndEquity: '28,716.023',
  },
  balanceSheet_2025_12_31: { assets: '21,690.750', liabilities: '910.250', retainedEarnings: '0.000', netIncome: '780.500', equity: '20,780.500' },
  ledger_cash_2026_01: {
    opening: '2,340.750',
    balances: ['3,821.250', '2,822.250', '3,821.250', '3,733.915'],
    closing: '3,733.915',
  },
};
