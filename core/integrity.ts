// Everything the core assumes about a company, checked in one place. A company built only through
// commands always passes; a company read from a file must pass before the core will touch it. Tests
// also run this after every random sequence of commands.
//
// The checks read hostile data, so every field is type-checked before it is used.

import { ACCOUNT_TYPES, MAX_DEPTH, classOf, isAccountType, type AccountType } from './accounts.ts';
import type { Company } from './company.ts';
import { isIsoDate } from './dates.ts';
import type { DocKind } from './documents.ts';
import { MAX_LINES } from './journal.ts';
import { MEMORIZABLE } from './memorized.ts';
import { isMinor } from './money.ts';
import { lineAmount } from './quantity.ts';
import { err, ok, type Result } from './result.ts';

const LIMIT = 1_000_000_000_000; // counters and ids stay far below 2^53
const isStr = (v: unknown, max: number, allowEmpty = true): v is string => typeof v === 'string' && v.length <= max && (allowEmpty || v.trim().length > 0);
const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= LIMIT;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/;
const isName = (v: unknown, max: number) => isStr(v, max, false) && !INVISIBLE.test(v) && v === v.trim().replace(/\s+/g, ' ');

const DOC_KINDS: readonly DocKind[] = ['estimate', 'invoice', 'sales_receipt', 'credit_memo', 'payment', 'purchase_order', 'bill', 'vendor_credit', 'bill_payment', 'expense', 'transfer'];
const PARTY: Record<DocKind, { kind: 'customer' | 'vendor' | null; required: boolean }> = {
  estimate: { kind: 'customer', required: true },
  invoice: { kind: 'customer', required: true },
  sales_receipt: { kind: 'customer', required: false },
  credit_memo: { kind: 'customer', required: true },
  payment: { kind: 'customer', required: true },
  purchase_order: { kind: 'vendor', required: true },
  bill: { kind: 'vendor', required: true },
  vendor_credit: { kind: 'vendor', required: true },
  bill_payment: { kind: 'vendor', required: true },
  expense: { kind: 'vendor', required: false },
  transfer: { kind: null, required: false },
};
const CONTROL: Partial<Record<DocKind, AccountType>> = {
  invoice: 'accounts_receivable',
  credit_memo: 'accounts_receivable',
  payment: 'accounts_receivable',
  bill: 'accounts_payable',
  vendor_credit: 'accounts_payable',
  bill_payment: 'accounts_payable',
};
const MONEY: Partial<Record<DocKind, AccountType[]>> = {
  sales_receipt: ['bank', 'other_current_asset'],
  payment: ['bank', 'other_current_asset'],
  bill_payment: ['bank', 'credit_card'],
  expense: ['bank', 'credit_card'],
  transfer: ['bank', 'credit_card', 'other_current_asset'],
};
const WITH_LINES = new Set<DocKind>(['estimate', 'invoice', 'sales_receipt', 'credit_memo', 'purchase_order', 'bill', 'vendor_credit', 'expense']);
const TARGET_OF: Partial<Record<DocKind, DocKind>> = { payment: 'invoice', credit_memo: 'invoice', bill_payment: 'bill', vendor_credit: 'bill' };
const NOT_ON_LINES = new Set<AccountType>(['accounts_receivable', 'accounts_payable']);
const SELF_NUMBERED = new Set<DocKind>(['estimate', 'invoice', 'sales_receipt', 'credit_memo', 'purchase_order']);

export function checkIntegrity(c: Company): Result<true> {
  const no = (what: string) => err<true>('integrity', `The company data is inconsistent: ${what}.`, { what });
  try {
    // ---------------------------------------------------------------- company
    if (!isName(c.name, 120)) return no('company name');
    if (!isInt(c.fiscalYearStartMonth, 1) || c.fiscalYearStartMonth > 12) return no('fiscal year');
    if (c.closingDate !== null && !isIsoDate(c.closingDate)) return no('closing date');
    if (!Array.isArray(c.closingDateLog) || !c.closingDateLog.every((l) => isObj(l) && (l.from === null || isIsoDate(l.from)) && (l.to === null || isIsoDate(l.to)))) return no('closing date log');

    // ---------------------------------------------------------------- accounts
    const acc = c.accounts;
    const numbers = new Set<string>();
    const siblings = new Set<string>();
    let retained = 0;
    for (const [id, a] of acc) {
      if (!isObj(a) || a.id !== id || !/^acc-\d{1,12}$/.test(id)) return no(`account ${String(id)}`);
      if (!isName(a.name, 100) || !isStr(a.number, 20) || !isAccountType(a.type) || typeof a.active !== 'boolean') return no(`account ${id}`);
      if (a.role !== null && a.role !== 'retained_earnings') return no(`account ${id} role`);
      if (a.role) {
        retained++;
        if (a.type !== 'equity' || !a.active) return no('retained earnings account');
      }
      if (a.number) {
        if (numbers.has(a.number)) return no(`account number ${a.number} used twice`);
        numbers.add(a.number);
      }
      const sib = `${a.parentId ?? ''}\u0000${a.name.toLowerCase()}`;
      if (siblings.has(sib)) return no(`account name ${a.name} used twice`);
      siblings.add(sib);
      if (a.parentId !== null) {
        const p = typeof a.parentId === 'string' ? acc.get(a.parentId) : undefined;
        if (!p || classOf(p.type) !== classOf(a.type)) return no(`account ${id} parent`);
      }
    }
    if (retained !== 1) return no('retained earnings account');
    for (const a of acc.values()) {
      let depth = 1;
      for (let p = a.parentId; p !== null; p = acc.get(p)!.parentId) {
        if (++depth > MAX_DEPTH) return no(`account ${a.id} nests too deep or in a circle`);
      }
    }

    // ---------------------------------------------------------------- parties and items
    const names = new Set<string>();
    for (const [id, p] of c.parties) {
      if (!isObj(p) || p.id !== id || !/^p-\d{1,12}$/.test(id) || (p.kind !== 'customer' && p.kind !== 'vendor')) return no(`name ${String(id)}`);
      if (!isName(p.name, 100) || names.has(p.name.toLowerCase())) return no(`name ${id}`);
      names.add(p.name.toLowerCase());
      if (![p.companyName, p.email, p.phone].every((s) => isStr(s, 200)) || !isStr(p.address, 500) || !isStr(p.notes, 2000)) return no(`name ${id} details`);
      if (!isInt(p.termsDays) || p.termsDays > 3650 || typeof p.active !== 'boolean') return no(`name ${id} terms`);
    }
    const itemNames = new Set<string>();
    for (const [id, i] of c.items) {
      if (!isObj(i) || i.id !== id || !/^i-\d{1,12}$/.test(id) || !['service', 'non_inventory', 'other_charge'].includes(i.type)) return no(`item ${String(id)}`);
      if (!isName(i.name, 100) || itemNames.has(i.name.toLowerCase()) || !isStr(i.description, 1000)) return no(`item ${id}`);
      itemNames.add(i.name.toLowerCase());
      if (!isMinor(i.price) || i.price < 0 || !isMinor(i.cost) || i.cost < 0 || typeof i.active !== 'boolean') return no(`item ${id} rates`);
      const s = i.salesAccountId === null ? null : acc.get(i.salesAccountId);
      const pu = i.purchaseAccountId === null ? null : acc.get(i.purchaseAccountId);
      if (s === undefined || pu === undefined || (!s && !pu)) return no(`item ${id} accounts`);
      if (s && (NOT_ON_LINES.has(s.type) || classOf(s.type) !== 'income')) return no(`item ${id} sales account`);
      if (pu && NOT_ON_LINES.has(pu.type)) return no(`item ${id} purchase account`);
    }

    // ---------------------------------------------------------------- entries
    const entries = new Map<number, (typeof c.entries)[number]>();
    const reversed = new Set<number>();
    let lastId = 0;
    for (const e of c.entries) {
      if (!isObj(e) || !isInt(e.id, 1) || e.id <= lastId || !isIsoDate(e.date) || !isStr(e.memo, 1000)) return no(`entry ${String(e?.id)}`);
      lastId = e.id;
      if (!Array.isArray(e.lines) || e.lines.length < 2 || e.lines.length > MAX_LINES) return no(`entry ${e.id} lines`);
      let dr = 0;
      let cr = 0;
      for (const l of e.lines) {
        const a = isObj(l) && typeof l.accountId === 'string' ? acc.get(l.accountId) : undefined;
        if (!a || !isMinor(l.debit) || !isMinor(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit > 0) === (l.credit > 0) || !isStr(l.memo, 1000)) return no(`entry ${e.id} line`);
        const party = l.partyId === null ? null : c.parties.get(l.partyId);
        if (party === undefined) return no(`entry ${e.id} name`);
        if (a.type === 'accounts_receivable' && (party?.kind !== 'customer' || !e.source)) return no(`entry ${e.id} receivable line`);
        if (a.type === 'accounts_payable' && (party?.kind !== 'vendor' || !e.source)) return no(`entry ${e.id} payable line`);
        dr += l.debit;
        cr += l.credit;
      }
      if (dr !== cr || !Number.isSafeInteger(dr)) return no(`entry ${e.id} does not balance`);
      if (e.reverses !== null) {
        const o = entries.get(e.reverses);
        if (!o || o.reverses !== null || reversed.has(o.id) || e.date < o.date || e.lines.length !== o.lines.length) return no(`entry ${e.id} reversal`);
        if (!e.lines.every((l, i) => l.accountId === o.lines[i]!.accountId && l.debit === o.lines[i]!.credit && l.credit === o.lines[i]!.debit)) return no(`entry ${e.id} does not mirror ${o.id}`);
        reversed.add(o.id);
      }
      if (e.source !== null && (!isObj(e.source) || !isStr(e.source.kind, 30) || !isInt(e.source.id, 1))) return no(`entry ${e.id} source`);
      entries.set(e.id, e);
    }

    // ---------------------------------------------------------------- documents
    const docOfEntry = new Map<number, number>();
    const docNumbers = new Set<string>();
    for (const [id, d] of c.documents) {
      const what = `document ${String(id)}`;
      if (!isObj(d) || d.id !== id || !isInt(id, 1) || !DOC_KINDS.includes(d.kind)) return no(what);
      if (!isStr(d.number, 30) || !isIsoDate(d.date) || (d.dueDate !== null && !isIsoDate(d.dueDate)) || !isStr(d.memo, 1000) || typeof d.voided !== 'boolean') return no(what);
      // Numbers are unique per kind (bills and vendor credits: per vendor), as the core assigns them.
      const numberKey = SELF_NUMBERED.has(d.kind) ? `${d.kind}:${d.number}` : (d.kind === 'bill' || d.kind === 'vendor_credit') && d.number ? `${d.kind}:${String(d.partyId)}:${d.number}` : null;
      if (numberKey !== null) {
        if (docNumbers.has(numberKey)) return no(`${what} number ${d.number} used twice`);
        docNumbers.add(numberKey);
      }
      const rule = PARTY[d.kind];
      const party = d.partyId === null ? null : c.parties.get(d.partyId);
      if (party === undefined || (rule.required && !party) || (party && party.kind !== rule.kind)) return no(`${what} name`);
      if (!isMinor(d.total) || d.total <= 0) return no(`${what} total`);
      if (!Array.isArray(d.lines)) return no(`${what} lines`);
      if (WITH_LINES.has(d.kind)) {
        if (d.lines.length < 1 || d.lines.length > 500) return no(`${what} lines`);
        let sum = 0;
        for (const l of d.lines) {
          const a = isObj(l) && typeof l.accountId === 'string' ? acc.get(l.accountId) : undefined;
          if (!a || NOT_ON_LINES.has(a.type) || (l.itemId !== null && !c.items.has(l.itemId)) || !isStr(l.description, 1000)) return no(`${what} line`);
          if (!isInt(l.quantity, 1) || !isMinor(l.rate) || l.rate < 0) return no(`${what} line amount`);
          const amount = lineAmount(l.quantity, l.rate);
          if (!amount.ok || amount.value !== l.amount) return no(`${what} line amount`);
          sum += l.amount;
        }
        if (sum !== d.total) return no(`${what} total`);
      } else if (d.lines.length) return no(`${what} lines`);
      const control = CONTROL[d.kind];
      if (control ? acc.get(d.accountId ?? '')?.type !== control : d.accountId !== null) return no(`${what} account`);
      const money = MONEY[d.kind];
      if (money ? !money.includes(acc.get(d.bankAccountId ?? '')?.type as AccountType) : d.bankAccountId !== null) return no(`${what} money account`);
      if (d.kind === 'transfer' ? !money!.includes(acc.get(d.toAccountId ?? '')?.type as AccountType) || d.toAccountId === d.bankAccountId : d.toAccountId !== null) return no(`${what} transfer`);
      const convertible = d.kind === 'estimate' || d.kind === 'purchase_order';
      if (convertible ? d.status !== 'open' && d.status !== 'closed' : d.status !== null) return no(`${what} status`);
      if (d.linkedId !== null) {
        const other = c.documents.get(d.linkedId);
        const pair = convertible ? (d.kind === 'estimate' ? 'invoice' : 'bill') : d.kind === 'invoice' ? 'estimate' : d.kind === 'bill' ? 'purchase_order' : null;
        if (!other || other.kind !== pair) return no(`${what} link`);
        if (convertible && (d.status !== 'closed' || other.linkedId !== d.id)) return no(`${what} link`);
      } else if (convertible && d.status === 'closed') return no(`${what} link`);
      if (convertible) {
        if (d.entryId !== null) return no(`${what} entry`);
      } else {
        const e = d.entryId === null ? undefined : entries.get(d.entryId);
        if (!e || e.source?.kind !== d.kind || e.source.id !== d.id || e.date !== d.date || docOfEntry.has(e.id)) return no(`${what} entry`);
        if (e.lines.reduce((s, l) => s + l.debit, 0) !== d.total) return no(`${what} total does not match its entry`);
        if (d.voided !== reversed.has(e.id)) return no(`${what} void`);
        docOfEntry.set(e.id, d.id);
      }
    }
    for (const e of entries.values()) {
      if (!e.source) continue;
      const owner = e.reverses === null ? e.id : e.reverses;
      if (docOfEntry.get(owner) !== e.source.id) return no(`entry ${e.id} source`);
    }

    // ---------------------------------------------------------------- applications
    const appIds = new Set<number>();
    const toTarget = new Map<number, number>();
    const fromSource = new Map<number, number>();
    for (const a of c.applications) {
      if (!isObj(a) || !isInt(a.id, 1) || appIds.has(a.id) || !isIsoDate(a.date) || !isMinor(a.amount) || a.amount <= 0 || typeof a.voided !== 'boolean') return no('application');
      appIds.add(a.id);
      const s = c.documents.get(a.sourceId);
      const tg = c.documents.get(a.targetId);
      if (!s || !tg || TARGET_OF[s.kind] !== tg.kind || s.partyId !== tg.partyId || s.accountId !== tg.accountId) return no(`application ${a.id}`);
      if (a.date < s.date || a.date < tg.date) return no(`application ${a.id} date`);
      if (s.voided && !a.voided) return no(`application ${a.id} from a void document`);
      if (a.voided) continue;
      if (tg.voided) return no(`application ${a.id} to a void document`);
      toTarget.set(tg.id, (toTarget.get(tg.id) ?? 0) + a.amount);
      fromSource.set(s.id, (fromSource.get(s.id) ?? 0) + a.amount);
    }
    for (const [id, used] of toTarget) if (used > c.documents.get(id)!.total) return no(`document ${id} is over-applied`);
    for (const [id, used] of fromSource) if (used > c.documents.get(id)!.total) return no(`document ${id} applies more than it holds`);

    // ---------------------------------------------------------------- reconciliations
    const expectCleared = new Map<string, number>();
    const lastByAccount = new Map<string, { date: string; ending: number }>();
    let lastRec = 0;
    for (const r of c.reconciliations) {
      if (!isObj(r) || !isInt(r.id, 1) || r.id <= lastRec || !isIsoDate(r.statementDate) || !isMinor(r.beginningBalance) || !isMinor(r.endingBalance) || typeof r.undone !== 'boolean' || !Array.isArray(r.lineKeys)) return no('reconciliation');
      lastRec = r.id;
      const a = acc.get(r.accountId);
      if (!a || (a.type !== 'bank' && a.type !== 'credit_card')) return no(`reconciliation ${r.id} account`);
      const sign = a.type === 'credit_card' ? -1 : 1;
      let sum = 0;
      for (const k of r.lineKeys) {
        const m = typeof k === 'string' ? /^([1-9]\d*):(0|[1-9]\d*)$/.exec(k) : null;
        const e = m ? entries.get(Number(m[1])) : undefined;
        const l = m && e ? e.lines[Number(m[2])] : undefined;
        if (!l || l.accountId !== r.accountId || e!.date > r.statementDate) return no(`reconciliation ${r.id} line ${String(k)}`);
        if (!r.undone) {
          if (expectCleared.has(k as string)) return no(`line ${String(k)} reconciled twice`);
          expectCleared.set(k as string, r.id);
        }
        sum += sign * (l.debit - l.credit);
      }
      if (r.undone) continue;
      const prev = lastByAccount.get(r.accountId);
      if ((prev && r.statementDate <= prev.date) || r.beginningBalance !== (prev?.ending ?? 0) || r.endingBalance !== r.beginningBalance + sum) return no(`reconciliation ${r.id} does not add up`);
      lastByAccount.set(r.accountId, { date: r.statementDate, ending: r.endingBalance });
    }
    if (c.cleared.size !== expectCleared.size || [...expectCleared].some(([k, id]) => c.cleared.get(k) !== id)) return no('cleared lines');

    // ---------------------------------------------------------------- memorized
    const memoNames = new Set<string>();
    for (const [id, m] of c.memorized) {
      if (!isObj(m) || m.id !== id || !/^m-\d{1,12}$/.test(id) || !isStr(m.name, 100, false) || memoNames.has(m.name.toLowerCase())) return no(`memorized ${String(id)}`);
      memoNames.add(m.name.toLowerCase());
      if (typeof m.command !== 'string' || !MEMORIZABLE.has(m.command) || !isObj(m.params) || 'date' in m.params || 'number' in m.params || 'dueDate' in m.params) return no(`memorized ${id} command`);
      if (m.frequency !== null && !['weekly', 'monthly', 'quarterly', 'yearly'].includes(m.frequency)) return no(`memorized ${id} frequency`);
      if ((m.nextDate !== null && !isIsoDate(m.nextDate)) || (m.endDate !== null && !isIsoDate(m.endDate)) || typeof m.active !== 'boolean') return no(`memorized ${id} dates`);
      if (m.anchorDay !== null && (!isInt(m.anchorDay, 1) || m.anchorDay > 31)) return no(`memorized ${id} day`);
    }

    // ---------------------------------------------------------------- counters: never reuse an id
    const maxSuffix = (ids: Iterable<string>) => {
      let m = 0;
      for (const id of ids) m = Math.max(m, Number(id.slice(id.indexOf('-') + 1)));
      return m;
    };
    const maxOf = (ns: Iterable<number>) => {
      let m = 0;
      for (const n of ns) m = Math.max(m, n);
      return m;
    };
    const counters: [number, number][] = [
      [c.nextAccountId, maxSuffix(acc.keys())],
      [c.nextPartyId, maxSuffix(c.parties.keys())],
      [c.nextItemId, maxSuffix(c.items.keys())],
      [c.nextMemorizedId, maxSuffix(c.memorized.keys())],
      [c.nextEntryId, lastId],
      [c.nextDocId, maxOf(c.documents.keys())],
      [c.nextApplicationId, maxOf(appIds)],
      [c.nextReconciliationId, lastRec],
    ];
    for (const [next, max] of counters) if (!isInt(next, 1) || next <= max) return no('id counters');
    return ok(true);
  } catch (e) {
    return no(`unreadable (${String(e).slice(0, 80)})`);
  }
}

export const ACCOUNT_TYPE_LIST = Object.keys(ACCOUNT_TYPES) as AccountType[];
