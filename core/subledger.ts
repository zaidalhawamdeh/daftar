// Who owes us, and whom we owe. Balances come from the journal (every receivable and payable line
// names someone), so customer balances always add up to the receivables account. Open invoices and
// bills come from the documents and their applications.

import type { Company } from './company.ts';
import { isIsoDate } from './dates.ts';
import { openBalance, unapplied, type Doc } from './documents.ts';
import { sum, type Minor } from './money.ts';
import type { PartyKind } from './parties.ts';
import { err, ok, type Result } from './result.ts';

const CONTROL = { customer: 'accounts_receivable', vendor: 'accounts_payable' } as const;

export interface PartyLine {
  entryId: number;
  date: string;
  kind: string; // document kind, or "journal"
  number: string;
  memo: string;
  amount: Minor; // positive raises what is owed
  balance: Minor;
}

export interface PartyBalance {
  partyId: string;
  name: string;
  balance: Minor; // customers: what they owe us; vendors: what we owe them
  lines?: PartyLine[];
}

export interface PartyBalances {
  asOf: string;
  rows: PartyBalance[];
  total: Minor;
}

export function partyBalances(c: Company, kind: PartyKind, asOf: unknown, detail: unknown = false): Result<PartyBalances> {
  if (!isIsoDate(asOf)) return err('date.invalid', 'Report date must be a real date (YYYY-MM-DD).');
  const control = CONTROL[kind];
  const sign = kind === 'customer' ? 1 : -1;
  const map = new Map<string, PartyBalance>();
  const entries = c.entries.filter((e) => e.date <= asOf).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id));
  for (const e of entries) {
    const doc = e.source ? c.documents.get(e.source.id) : undefined;
    for (const l of e.lines) {
      if (!l.partyId || c.accounts.get(l.accountId)?.type !== control) continue;
      const party = c.parties.get(l.partyId);
      if (!party) continue;
      const row = map.get(party.id) ?? { partyId: party.id, name: party.name, balance: 0, ...(detail === true ? { lines: [] } : {}) };
      const amount = sign * (l.debit - l.credit);
      row.balance += amount;
      if (!Number.isSafeInteger(row.balance)) return err('amount.too_large', 'A balance is too large to report.');
      row.lines?.push({
        entryId: e.id,
        date: e.date,
        kind: e.reverses !== null ? 'void' : (doc?.kind ?? 'journal'),
        number: doc?.number ?? '',
        memo: l.memo || e.memo,
        amount,
        balance: row.balance,
      });
      map.set(party.id, row);
    }
  }
  const rows = [...map.values()].filter((r) => r.balance !== 0 || detail === true).sort((a, b) => a.name.localeCompare(b.name));
  for (const r of rows) if (Object.is(r.balance, -0)) r.balance = 0;
  const total = sum(rows.map((r) => r.balance));
  if (!total.ok) return total;
  return ok({ asOf, rows, total: total.value });
}

export interface OpenDoc {
  docId: number;
  number: string;
  partyId: string;
  name: string;
  date: string;
  dueDate: string;
  total: Minor;
  open: Minor;
}

export interface OpenDocs {
  asOf: string;
  rows: OpenDoc[];
  total: Minor;
}

function openDocs(c: Company, kind: 'invoice' | 'bill', asOf: unknown): Result<OpenDocs> {
  if (!isIsoDate(asOf)) return err('date.invalid', 'Report date must be a real date (YYYY-MM-DD).');
  const rows: OpenDoc[] = [];
  for (const d of c.documents.values()) {
    if (d.kind !== kind) continue;
    const open = openBalance(c, d, asOf);
    if (open === 0) continue;
    rows.push({ docId: d.id, number: d.number, partyId: d.partyId!, name: c.parties.get(d.partyId!)?.name ?? '', date: d.date, dueDate: d.dueDate ?? d.date, total: d.total, open });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.docId - b.docId));
  const total = sum(rows.map((r) => r.open));
  if (!total.ok) return total;
  return ok({ asOf, rows, total: total.value });
}

export const openInvoices = (c: Company, asOf: unknown) => openDocs(c, 'invoice', asOf);
export const unpaidBills = (c: Company, asOf: unknown) => openDocs(c, 'bill', asOf);

// Payments and credits not yet applied to anything.
export function unappliedCredits(c: Company, side: 'customer' | 'vendor', asOf: string): { doc: Doc; left: Minor }[] {
  const kinds = side === 'customer' ? ['payment', 'credit_memo'] : ['bill_payment', 'vendor_credit'];
  const out: { doc: Doc; left: Minor }[] = [];
  for (const d of c.documents.values()) {
    if (!kinds.includes(d.kind)) continue;
    const left = unapplied(c, d, asOf);
    if (left !== 0) out.push({ doc: d, left });
  }
  return out;
}
