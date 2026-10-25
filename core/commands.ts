// Every user action is a named command. Buttons, menus, the CLI, tests and agents all go through
// `execute`, so anything a person can click, a script can do too.

import type { Account } from './accounts.ts';
import {
  createAccount,
  setAccountActive,
  setClosingDate,
  setFiscalYearStart,
  updateAccount,
  type Company,
  type Entry,
} from './company.ts';
import { reconcile, reconcileCandidates, reconciliationReport, undoReconciliation } from './banking.ts';
import { cashFlow } from './cashflow.ts';
import { createMemorized, deleteMemorized, runDue, runMemorized, setMemorizedActive, type Memorized, type Runner } from './memorized.ts';
import { applyCredit, convertDoc, createPurchaseDoc, createSalesDoc, createSettlement, createTransfer, voidDoc, type Doc } from './documents.ts';
import { createItem, setItemActive, updateItem, type Item } from './items.ts';
import { postEntry, reverseEntry } from './journal.ts';
import { createParty, setPartyActive, updateParty, type Party, type PartyKind } from './parties.ts';
import { err, type Result, ok } from './result.ts';
import { balanceSheet, generalLedger, profitAndLoss, trialBalance } from './reports.ts';
import { aging, openInvoices, partyBalances, unpaidBills } from './subledger.ts';
import { exportIif, importIif } from './import/iif.ts';
import { importList, importOpeningBalances } from './import/opening.ts';
import { setupVat, vatReturn } from './vat.ts';
import { checkIntegrity } from './integrity.ts';

export interface CommandSpec {
  id: string;
  label: { en: string; ar: string };
  mutates: boolean;
  run(c: Company, params: Record<string, unknown>): Result<unknown>;
}

const commands: CommandSpec[] = [
  {
    id: 'account.create',
    label: { en: 'New Account', ar: 'حساب جديد' },
    mutates: true,
    run: (c, p) => createAccount(c, { name: p.name, number: p.number, type: p.type, parentId: p.parentId }),
  },
  {
    id: 'account.update',
    label: { en: 'Edit Account', ar: 'تعديل الحساب' },
    mutates: true,
    run: (c, p) => updateAccount(c, p.id, { name: p.name, number: p.number, type: p.type, parentId: p.parentId }),
  },
  {
    id: 'account.setActive',
    label: { en: 'Make Account Active / Inactive', ar: 'تفعيل الحساب أو إيقافه' },
    mutates: true,
    run: (c, p) => setAccountActive(c, p.id, p.active),
  },
  {
    id: 'account.list',
    label: { en: 'Chart of Accounts', ar: 'دليل الحسابات' },
    mutates: false,
    run: (c, p): Result<Account[]> => ok([...c.accounts.values()].filter((a) => p.includeInactive === true || a.active)),
  },
  {
    id: 'journal.post',
    label: { en: 'Make General Journal Entry', ar: 'قيد يومية' },
    mutates: true,
    run: (c, p) => postEntry(c, { date: p.date, memo: p.memo, lines: p.lines }),
  },
  {
    id: 'journal.reverse',
    label: { en: 'Reverse Journal Entry', ar: 'عكس القيد' },
    mutates: true,
    run: (c, p) => reverseEntry(c, { entryId: p.entryId, date: p.date, memo: p.memo }),
  },
  {
    id: 'journal.list',
    label: { en: 'Journal', ar: 'دفتر اليومية' },
    mutates: false,
    run: (c): Result<Entry[]> => ok(c.entries),
  },
  {
    id: 'company.setClosingDate',
    label: { en: 'Set Closing Date', ar: 'تاريخ إقفال الدفاتر' },
    mutates: true,
    run: (c, p) => setClosingDate(c, p.date, p.reopen),
  },
  {
    id: 'company.setFiscalYearStart',
    label: { en: 'Fiscal Year Start', ar: 'بداية السنة المالية' },
    mutates: true,
    run: (c, p) => setFiscalYearStart(c, p.month),
  },
  {
    id: 'report.trialBalance',
    label: { en: 'Trial Balance', ar: 'ميزان المراجعة' },
    mutates: false,
    run: (c, p) => trialBalance(c, p.asOf),
  },
  {
    id: 'report.profitAndLoss',
    label: { en: 'Profit & Loss', ar: 'الأرباح والخسائر' },
    mutates: false,
    run: (c, p) => profitAndLoss(c, p.from, p.to),
  },
  {
    id: 'report.balanceSheet',
    label: { en: 'Balance Sheet', ar: 'الميزانية العمومية' },
    mutates: false,
    run: (c, p) => balanceSheet(c, p.asOf),
  },
  {
    id: 'report.generalLedger',
    label: { en: 'General Ledger', ar: 'دفتر الأستاذ العام' },
    mutates: false,
    run: (c, p) => generalLedger(c, p.from, p.to, p.accountId),
  },
];

const LABELS: Record<PartyKind, { en: string; ar: string; plural: { en: string; ar: string } }> = {
  customer: { en: 'Customer', ar: 'زبون', plural: { en: 'Customers', ar: 'الزبائن' } },
  vendor: { en: 'Vendor', ar: 'مورّد', plural: { en: 'Vendors', ar: 'الموردون' } },
};

for (const kind of ['customer', 'vendor'] as const) {
  const L = LABELS[kind];
  commands.push(
    { id: `${kind}.create`, label: { en: `New ${L.en}`, ar: `${L.ar} جديد` }, mutates: true, run: (c, p) => createParty(c, kind, p) },
    { id: `${kind}.update`, label: { en: `Edit ${L.en}`, ar: `تعديل ${L.ar}` }, mutates: true, run: (c, p) => updateParty(c, kind, p.id, p) },
    { id: `${kind}.setActive`, label: { en: `Make ${L.en} Active / Inactive`, ar: `تفعيل ${L.ar} أو إيقافه` }, mutates: true, run: (c, p) => setPartyActive(c, kind, p.id, p.active) },
    {
      id: `${kind}.list`,
      label: L.plural,
      mutates: false,
      run: (c, p): Result<Party[]> => ok([...c.parties.values()].filter((x) => x.kind === kind && (p.includeInactive === true || x.active))),
    },
  );
}

const docList = (c: Company, p: Record<string, unknown>): Result<Doc[]> =>
  ok([...c.documents.values()].filter((d) => (p.kind === undefined || d.kind === p.kind) && (p.partyId === undefined || d.partyId === p.partyId)));

commands.push(
  { id: 'item.create', label: { en: 'New Item', ar: 'صنف جديد' }, mutates: true, run: (c, p) => createItem(c, p) },
  { id: 'item.update', label: { en: 'Edit Item', ar: 'تعديل الصنف' }, mutates: true, run: (c, p) => updateItem(c, p.id, p) },
  { id: 'item.setActive', label: { en: 'Make Item Active / Inactive', ar: 'تفعيل الصنف أو إيقافه' }, mutates: true, run: (c, p) => setItemActive(c, p.id, p.active) },
  { id: 'item.list', label: { en: 'Item List', ar: 'قائمة الأصناف' }, mutates: false, run: (c, p): Result<Item[]> => ok([...c.items.values()].filter((i) => p.includeInactive === true || i.active)) },
  { id: 'estimate.create', label: { en: 'Create Estimate', ar: 'عرض سعر' }, mutates: true, run: (c, p) => createSalesDoc(c, 'estimate', p) },
  { id: 'estimate.toInvoice', label: { en: 'Convert Estimate to Invoice', ar: 'تحويل عرض السعر إلى فاتورة' }, mutates: true, run: (c, p) => convertDoc(c, 'estimate', p) },
  { id: 'invoice.create', label: { en: 'Create Invoice', ar: 'فاتورة بيع' }, mutates: true, run: (c, p) => createSalesDoc(c, 'invoice', p) },
  { id: 'salesReceipt.create', label: { en: 'Create Sales Receipt', ar: 'إيصال بيع نقدي' }, mutates: true, run: (c, p) => createSalesDoc(c, 'sales_receipt', p) },
  { id: 'creditMemo.create', label: { en: 'Create Credit Memo', ar: 'إشعار دائن' }, mutates: true, run: (c, p) => createSalesDoc(c, 'credit_memo', p) },
  { id: 'payment.receive', label: { en: 'Receive Payment', ar: 'استلام دفعة' }, mutates: true, run: (c, p) => createSettlement(c, 'payment', p) },
  { id: 'ar.apply', label: { en: 'Apply Customer Credit', ar: 'تطبيق رصيد الزبون' }, mutates: true, run: (c, p) => (isCustomerSide(c, p) ? applyCredit(c, p) : err('apply.side', 'That is not a customer payment or credit.')) },
  { id: 'purchaseOrder.create', label: { en: 'Create Purchase Order', ar: 'أمر شراء' }, mutates: true, run: (c, p) => createPurchaseDoc(c, 'purchase_order', p) },
  { id: 'purchaseOrder.toBill', label: { en: 'Receive Purchase Order as Bill', ar: 'استلام أمر الشراء كفاتورة' }, mutates: true, run: (c, p) => convertDoc(c, 'purchase_order', p) },
  { id: 'bill.create', label: { en: 'Enter Bill', ar: 'فاتورة شراء' }, mutates: true, run: (c, p) => createPurchaseDoc(c, 'bill', p) },
  { id: 'vendorCredit.create', label: { en: 'Enter Vendor Credit', ar: 'إشعار دائن من مورّد' }, mutates: true, run: (c, p) => createPurchaseDoc(c, 'vendor_credit', p) },
  { id: 'bill.pay', label: { en: 'Pay Bills', ar: 'دفع الفواتير' }, mutates: true, run: (c, p) => createSettlement(c, 'bill_payment', p) },
  { id: 'ap.apply', label: { en: 'Apply Vendor Credit', ar: 'تطبيق رصيد المورّد' }, mutates: true, run: (c, p) => (isCustomerSide(c, p) ? err('apply.side', 'That is not a vendor payment or credit.') : applyCredit(c, p)) },
  { id: 'expense.create', label: { en: 'Write Check / Expense', ar: 'مصروف أو شيك' }, mutates: true, run: (c, p) => createPurchaseDoc(c, 'expense', p) },
  { id: 'transfer.create', label: { en: 'Transfer Funds', ar: 'تحويل بين الحسابات' }, mutates: true, run: (c, p) => createTransfer(c, p) },
  { id: 'document.void', label: { en: 'Void', ar: 'إلغاء' }, mutates: true, run: (c, p) => voidDoc(c, p) },
  { id: 'document.list', label: { en: 'Transactions', ar: 'المعاملات' }, mutates: false, run: docList },
  { id: 'report.customerBalances', label: { en: 'Customer Balance', ar: 'أرصدة الزبائن' }, mutates: false, run: (c, p) => partyBalances(c, 'customer', p.asOf, p.detail) },
  { id: 'report.vendorBalances', label: { en: 'Vendor Balance', ar: 'أرصدة الموردين' }, mutates: false, run: (c, p) => partyBalances(c, 'vendor', p.asOf, p.detail) },
  { id: 'report.openInvoices', label: { en: 'Open Invoices', ar: 'الفواتير المفتوحة' }, mutates: false, run: (c, p) => openInvoices(c, p.asOf) },
  { id: 'report.unpaidBills', label: { en: 'Unpaid Bills', ar: 'فواتير الشراء غير المدفوعة' }, mutates: false, run: (c, p) => unpaidBills(c, p.asOf) },
);

// Memorized transactions run other commands: for real inside the running command's snapshot, or on
// a throwaway copy to check a template.
const runner = (c: Company): Runner => ({
  run: (id, p) => COMMANDS.get(id)?.run(c, p) ?? err('command.unknown', `Unknown command "${id}".`),
  // The check runs with the books open, so a closed period cannot hide a broken template.
  dryRun: (id, p) => COMMANDS.get(id)?.run({ ...structuredClone(c), closingDate: null }, p) ?? err('command.unknown', `Unknown command "${id}".`),
});

commands.push(
  { id: 'bank.candidates', label: { en: 'Begin Reconciliation', ar: 'بدء المطابقة' }, mutates: false, run: (c, p) => reconcileCandidates(c, p.accountId, p.statementDate) },
  { id: 'bank.reconcile', label: { en: 'Reconcile', ar: 'مطابقة الحساب مع الكشف' }, mutates: true, run: (c, p) => reconcile(c, p) },
  { id: 'bank.undoReconciliation', label: { en: 'Undo Last Reconciliation', ar: 'التراجع عن آخر مطابقة' }, mutates: true, run: (c, p) => undoReconciliation(c, p) },
  { id: 'report.reconciliation', label: { en: 'Reconciliation Report', ar: 'تقرير المطابقة' }, mutates: false, run: (c, p) => reconciliationReport(c, p.id) },
  { id: 'report.arAging', label: { en: 'A/R Aging', ar: 'أعمار الذمم المدينة' }, mutates: false, run: (c, p) => aging(c, 'customer', p.asOf, p.interval ?? 30, p.periods ?? 3) },
  { id: 'report.apAging', label: { en: 'A/P Aging', ar: 'أعمار الذمم الدائنة' }, mutates: false, run: (c, p) => aging(c, 'vendor', p.asOf, p.interval ?? 30, p.periods ?? 3) },
  { id: 'vat.setup', label: { en: 'VAT Registration', ar: 'التسجيل في ضريبة القيمة المضافة' }, mutates: true, run: (c, p) => setupVat(c, p) },
  { id: 'report.vatReturn', label: { en: 'VAT Return (VAT 201)', ar: 'الإقرار الضريبي (VAT 201)' }, mutates: false, run: (c, p) => vatReturn(c, p) },
  { id: 'report.cashFlow', label: { en: 'Statement of Cash Flows', ar: 'قائمة التدفقات النقدية' }, mutates: false, run: (c, p) => cashFlow(c, p.from, p.to) },
  { id: 'memorized.create', label: { en: 'Memorize Transaction', ar: 'حفظ معاملة متكررة' }, mutates: true, run: (c, p) => createMemorized(c, runner(c), p) },
  { id: 'memorized.list', label: { en: 'Memorized Transactions', ar: 'المعاملات المحفوظة' }, mutates: false, run: (c): Result<Memorized[]> => ok([...c.memorized.values()]) },
  { id: 'memorized.run', label: { en: 'Enter Memorized Transaction', ar: 'إدخال معاملة محفوظة' }, mutates: true, run: (c, p) => runMemorized(c, runner(c), p) },
  { id: 'memorized.runDue', label: { en: 'Enter Scheduled Transactions', ar: 'إدخال المعاملات المستحقة' }, mutates: true, run: (c, p) => runDue(c, runner(c), p) },
  { id: 'memorized.setActive', label: { en: 'Pause / Resume Schedule', ar: 'إيقاف الجدولة أو استئنافها' }, mutates: true, run: (c, p) => setMemorizedActive(c, p) },
  { id: 'memorized.delete', label: { en: 'Delete Memorized Transaction', ar: 'حذف المعاملة المحفوظة' }, mutates: true, run: (c, p) => deleteMemorized(c, p) },
);

commands.push(
  { id: 'import.iif', label: { en: 'Import QuickBooks IIF File', ar: 'استيراد ملف IIF من QuickBooks' }, mutates: true, run: (c, p) => importIif(c, p.text, { autoApply: p.autoApply !== false }) },
  { id: 'import.openingBalances', label: { en: 'Import Opening Balances (CSV)', ar: 'استيراد الأرصدة الافتتاحية (CSV)' }, mutates: true, run: (c, p) => importOpeningBalances(c, { date: p.date, trialBalance: p.trialBalance, openInvoices: p.openInvoices, unpaidBills: p.unpaidBills }) },
  { id: 'import.list', label: { en: 'Import List (CSV)', ar: 'استيراد قائمة (CSV)' }, mutates: true, run: (c, p) => importList(c, { kind: p.kind, text: p.text }) },
  { id: 'export.iif', label: { en: 'Export to IIF File', ar: 'تصدير إلى ملف IIF' }, mutates: false, run: (c): Result<string> => ok(exportIif(c)) },
);

function isCustomerSide(c: Company, p: Record<string, unknown>): boolean {
  const d = typeof p.sourceId === 'number' ? c.documents.get(p.sourceId) : undefined;
  return d?.kind === 'payment' || d?.kind === 'credit_memo';
}

export const COMMANDS: ReadonlyMap<string, CommandSpec> = new Map(commands.map((c) => [c.id, c]));

// Posted entries are frozen and only ever appended, so a snapshot copies the entry list, not the entries.
// Everything else that can change in place is copied one level deep.
function snapshot(c: Company): Company {
  return {
    ...c,
    closingDateLog: [...c.closingDateLog],
    accounts: new Map([...c.accounts].map(([id, a]) => [id, { ...a }])),
    entries: [...c.entries],
    parties: new Map([...c.parties].map(([id, x]) => [id, { ...x }])),
    items: new Map([...c.items].map(([id, x]) => [id, { ...x }])),
    documents: new Map([...c.documents].map(([id, x]) => [id, { ...x }])),
    applications: c.applications.map((a) => ({ ...a })),
    reconciliations: c.reconciliations.map((r) => ({ ...r })),
    cleared: new Map(c.cleared),
    memorized: new Map([...c.memorized].map(([id, m]) => [id, { ...m }])),
  };
}

// Runs a command. If anything throws, the company is restored, so a failed command never leaves a
// half-applied change behind.
export function execute(c: Company, id: string, params: unknown = {}): Result<unknown> {
  const spec = COMMANDS.get(id);
  if (!spec) return err('command.unknown', `Unknown command "${id}".`);
  const p = typeof params === 'object' && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : null;
  if (!p) return err('command.params', 'Command parameters must be an object.');
  const before = spec.mutates ? snapshot(c) : null;
  try {
    const r = spec.run(c, p);
    // A refused command leaves nothing behind, even one that did some work before refusing
    // (running a schedule enters several transactions and may fail on the last).
    if (!r.ok) {
      if (before) Object.assign(c, before);
      return r;
    }
    // The books are checked after every change: a state the company could not be opened from again is
    // never kept, whatever path led to it.
    if (before) {
      const sound = checkIntegrity(c);
      if (!sound.ok) {
        Object.assign(c, before);
        return err('internal.integrity', 'That change would leave the books inconsistent; nothing was changed.', { command: id, what: sound.error.details?.what });
      }
    }
    // Callers get a copy: nothing they do to a result can reach the books.
    return { ok: true, value: structuredClone(r.value) };
  } catch (e) {
    if (before) Object.assign(c, before);
    return err('internal', 'Something went wrong; nothing was changed.', { command: id, cause: String(e) });
  }
}
