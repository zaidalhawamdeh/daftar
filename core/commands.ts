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
import { postEntry, reverseEntry } from './journal.ts';
import { err, type Result, ok } from './result.ts';
import { balanceSheet, generalLedger, profitAndLoss, trialBalance } from './reports.ts';

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

export const COMMANDS: ReadonlyMap<string, CommandSpec> = new Map(commands.map((c) => [c.id, c]));

// Posted entries are frozen and only ever appended, so a snapshot copies the entry list, not the entries.
function snapshot(c: Company): Company {
  return {
    ...c,
    closingDateLog: [...c.closingDateLog],
    accounts: new Map([...c.accounts].map(([id, a]) => [id, { ...a }])),
    entries: [...c.entries],
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
    // Callers get a copy: nothing they do to a result can reach the books.
    return r.ok ? { ok: true, value: structuredClone(r.value) } : r;
  } catch (e) {
    if (before) Object.assign(c, before);
    return err('internal', 'Something went wrong; nothing was changed.', { command: id, cause: String(e) });
  }
}
