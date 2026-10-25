// Where each command lives in the interface. A test checks that every command in the core has a
// screen, so nothing the books can do is unreachable by a person.

export type ScreenId =
  | 'home'
  | 'accounts'
  | 'customers'
  | 'vendors'
  | 'items'
  | 'docs'
  | 'sales-form'
  | 'purchase-form'
  | 'settle-form'
  | 'apply-credit'
  | 'transfer'
  | 'journal'
  | 'reconcile'
  | 'reports'
  | 'memorized'
  | 'settings'
  | 'import'
  | 'print';

export const SCREENS: readonly ScreenId[] = ['home', 'accounts', 'customers', 'vendors', 'items', 'docs', 'sales-form', 'purchase-form', 'settle-form', 'apply-credit', 'transfer', 'journal', 'reconcile', 'reports', 'memorized', 'settings', 'import', 'print'];

export interface Target {
  screen: ScreenId;
  params?: Record<string, unknown>;
}

const report = (r: string): Target => ({ screen: 'reports', params: { report: r } });

export const COMMAND_SCREENS: Record<string, Target> = {
  'account.create': { screen: 'accounts' },
  'account.update': { screen: 'accounts' },
  'account.setActive': { screen: 'accounts' },
  'account.list': { screen: 'accounts' },
  'journal.post': { screen: 'journal' },
  'journal.reverse': { screen: 'journal' },
  'journal.list': { screen: 'journal' },
  'company.setClosingDate': { screen: 'settings' },
  'company.setFiscalYearStart': { screen: 'settings' },
  'report.trialBalance': report('trialBalance'),
  'report.profitAndLoss': report('profitAndLoss'),
  'report.balanceSheet': report('balanceSheet'),
  'report.generalLedger': report('generalLedger'),
  'customer.create': { screen: 'customers' },
  'customer.update': { screen: 'customers' },
  'customer.setActive': { screen: 'customers' },
  'customer.list': { screen: 'customers' },
  'vendor.create': { screen: 'vendors' },
  'vendor.update': { screen: 'vendors' },
  'vendor.setActive': { screen: 'vendors' },
  'vendor.list': { screen: 'vendors' },
  'item.create': { screen: 'items' },
  'item.update': { screen: 'items' },
  'item.setActive': { screen: 'items' },
  'item.list': { screen: 'items' },
  'estimate.create': { screen: 'sales-form', params: { kind: 'estimate' } },
  'estimate.toInvoice': { screen: 'docs', params: { kind: 'estimate' } },
  'invoice.create': { screen: 'sales-form', params: { kind: 'invoice' } },
  'salesReceipt.create': { screen: 'sales-form', params: { kind: 'sales_receipt' } },
  'creditMemo.create': { screen: 'sales-form', params: { kind: 'credit_memo' } },
  'payment.receive': { screen: 'settle-form', params: { kind: 'payment' } },
  'ar.apply': { screen: 'apply-credit', params: { side: 'customer' } },
  'purchaseOrder.create': { screen: 'purchase-form', params: { kind: 'purchase_order' } },
  'purchaseOrder.toBill': { screen: 'docs', params: { kind: 'purchase_order' } },
  'bill.create': { screen: 'purchase-form', params: { kind: 'bill' } },
  'vendorCredit.create': { screen: 'purchase-form', params: { kind: 'vendor_credit' } },
  'bill.pay': { screen: 'settle-form', params: { kind: 'bill_payment' } },
  'ap.apply': { screen: 'apply-credit', params: { side: 'vendor' } },
  'expense.create': { screen: 'purchase-form', params: { kind: 'expense' } },
  'transfer.create': { screen: 'transfer' },
  'document.void': { screen: 'docs', params: { kind: 'invoice' } },
  'document.list': { screen: 'docs', params: { kind: 'invoice' } },
  'report.customerBalances': report('customerBalances'),
  'report.vendorBalances': report('vendorBalances'),
  'report.openInvoices': report('openInvoices'),
  'report.unpaidBills': report('unpaidBills'),
  'bank.candidates': { screen: 'reconcile' },
  'bank.reconcile': { screen: 'reconcile' },
  'bank.undoReconciliation': { screen: 'reconcile' },
  'report.reconciliation': { screen: 'reconcile' },
  'report.arAging': report('arAging'),
  'report.apAging': report('apAging'),
  'report.cashFlow': report('cashFlow'),
  'vat.setup': { screen: 'settings' },
  'report.vatReturn': report('vatReturn'),
  'memorized.create': { screen: 'memorized' },
  'memorized.list': { screen: 'memorized' },
  'memorized.run': { screen: 'memorized' },
  'memorized.runDue': { screen: 'memorized' },
  'memorized.setActive': { screen: 'memorized' },
  'memorized.delete': { screen: 'memorized' },
  'import.iif': { screen: 'import' },
  'import.openingBalances': { screen: 'import' },
  'import.list': { screen: 'import' },
  'export.iif': { screen: 'settings' },
};

export const REPORTS = [
  'profitAndLoss',
  'balanceSheet',
  'cashFlow',
  'trialBalance',
  'generalLedger',
  'arAging',
  'apAging',
  'customerBalances',
  'vendorBalances',
  'openInvoices',
  'unpaidBills',
  'vatReturn',
] as const;
export type ReportId = (typeof REPORTS)[number];

export interface NavItem {
  label: string;
  target: Target;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  { group: '', items: [{ label: 'Home', target: { screen: 'home' } }] },
  {
    group: 'Customers',
    items: [
      { label: 'Invoices', target: { screen: 'docs', params: { kind: 'invoice' } } },
      { label: 'Receive payments', target: { screen: 'settle-form', params: { kind: 'payment' } } },
      { label: 'Estimates', target: { screen: 'docs', params: { kind: 'estimate' } } },
      { label: 'Sales receipts', target: { screen: 'docs', params: { kind: 'sales_receipt' } } },
      { label: 'Credit memos', target: { screen: 'docs', params: { kind: 'credit_memo' } } },
      { label: 'Customer list', target: { screen: 'customers' } },
    ],
  },
  {
    group: 'Vendors',
    items: [
      { label: 'Bills', target: { screen: 'docs', params: { kind: 'bill' } } },
      { label: 'Pay bills', target: { screen: 'settle-form', params: { kind: 'bill_payment' } } },
      { label: 'Purchase orders', target: { screen: 'docs', params: { kind: 'purchase_order' } } },
      { label: 'Vendor credits', target: { screen: 'docs', params: { kind: 'vendor_credit' } } },
      { label: 'Vendor list', target: { screen: 'vendors' } },
    ],
  },
  {
    group: 'Banking',
    items: [
      { label: 'Expenses and checks', target: { screen: 'docs', params: { kind: 'expense' } } },
      { label: 'Transfers', target: { screen: 'transfer' } },
      { label: 'Reconcile', target: { screen: 'reconcile' } },
    ],
  },
  {
    group: 'Company',
    items: [
      { label: 'Chart of accounts', target: { screen: 'accounts' } },
      { label: 'Items', target: { screen: 'items' } },
      { label: 'Journal entries', target: { screen: 'journal' } },
      { label: 'Memorized transactions', target: { screen: 'memorized' } },
      { label: 'Import', target: { screen: 'import' } },
      { label: 'Settings', target: { screen: 'settings' } },
    ],
  },
  { group: 'Reports', items: [{ label: 'Reports', target: { screen: 'reports', params: { report: 'profitAndLoss' } } }] },
];
