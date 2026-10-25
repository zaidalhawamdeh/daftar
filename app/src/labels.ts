// Display names for document kinds and account types, run through t() at render time.

import type { AccountType } from '../../core/accounts.ts';
import type { DocKind } from '../../core/documents.ts';
import { lang, t } from './i18n.ts';
import { ACCOUNT_TYPES } from '../../core/accounts.ts';
import { EMIRATE_LABEL, TAX_CODE_LABEL, type Emirate, type TaxCode } from '../../core/vat.ts';

export const DOC_SINGULAR: Record<DocKind, string> = {
  estimate: 'Estimate',
  invoice: 'Invoice',
  sales_receipt: 'Sales receipt',
  credit_memo: 'Credit memo',
  payment: 'Payment',
  purchase_order: 'Purchase order',
  bill: 'Bill',
  vendor_credit: 'Vendor credit',
  bill_payment: 'Bill payment',
  expense: 'Expense',
  transfer: 'Transfer',
};

export const DOC_PLURAL: Record<DocKind, string> = {
  estimate: 'Estimates',
  invoice: 'Invoices',
  sales_receipt: 'Sales receipts',
  credit_memo: 'Credit memos',
  payment: 'Payments',
  purchase_order: 'Purchase orders',
  bill: 'Bills',
  vendor_credit: 'Vendor credits',
  bill_payment: 'Pay bills',
  expense: 'Expenses and checks',
  transfer: 'Transfers',
};

export const docName = (k: DocKind) => t(DOC_SINGULAR[k]);
export const docsName = (k: DocKind) => t(DOC_PLURAL[k]);
export const typeName = (k: AccountType) => ACCOUNT_TYPES[k].label[lang()];
export const taxCodeName = (k: TaxCode) => TAX_CODE_LABEL[k][lang()];
export const emirateName = (k: Emirate) => EMIRATE_LABEL[k][lang()];

export const REPORT_NAMES: Record<string, { en: string; ar: string }> = {
  profitAndLoss: { en: 'Profit & Loss', ar: 'الأرباح والخسائر' },
  balanceSheet: { en: 'Balance Sheet', ar: 'الميزانية العمومية' },
  cashFlow: { en: 'Statement of Cash Flows', ar: 'قائمة التدفقات النقدية' },
  trialBalance: { en: 'Trial Balance', ar: 'ميزان المراجعة' },
  generalLedger: { en: 'General Ledger', ar: 'دفتر الأستاذ العام' },
  arAging: { en: 'A/R Aging', ar: 'أعمار الذمم المدينة' },
  apAging: { en: 'A/P Aging', ar: 'أعمار الذمم الدائنة' },
  customerBalances: { en: 'Customer Balances', ar: 'أرصدة الزبائن' },
  vendorBalances: { en: 'Vendor Balances', ar: 'أرصدة الموردين' },
  openInvoices: { en: 'Open Invoices', ar: 'الفواتير المفتوحة' },
  unpaidBills: { en: 'Unpaid Bills', ar: 'فواتير الشراء غير المدفوعة' },
  vatReturn: { en: 'VAT Return (VAT 201)', ar: 'الإقرار الضريبي (VAT 201)' },
};

export const reportName = (id: string) => REPORT_NAMES[id]?.[lang()] ?? id;
