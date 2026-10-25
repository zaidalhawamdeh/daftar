// Customers and vendors. Names are unique across both lists, so a name on a line is never ambiguous.

import { cleanName, isObject, type Company } from './company.ts';
import { err, ok, type Result } from './result.ts';

export type PartyKind = 'customer' | 'vendor';

export interface Party {
  id: string;
  kind: PartyKind;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  address: string;
  trn: string; // Tax Registration Number, '' when not registered; printed on tax invoices
  termsDays: number; // days until an invoice or bill is due
  active: boolean;
  notes: string;
}

export interface PartyInput {
  name?: unknown;
  companyName?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  trn?: unknown;
  termsDays?: unknown;
  notes?: unknown;
}

function text(v: unknown, max: number, what: string): Result<string> {
  if (v === undefined || v === null) return ok('');
  if (typeof v !== 'string') return err(`${what}.invalid`, `${what} must be text.`);
  if (v.length > max) return err(`${what}.too_long`, `${what} is longer than ${max} characters.`);
  return ok(v.trim());
}

function trnOf(v: unknown): Result<string> {
  if (v === undefined || v === null || v === '') return ok('');
  const s = typeof v === 'string' ? v.replace(/[\s-]/g, '') : '';
  if (!/^\d{15}$/.test(s)) return err('trn.invalid', 'The Tax Registration Number is 15 digits.');
  return ok(s);
}

function terms(v: unknown): Result<number> {
  if (v === undefined || v === null) return ok(0);
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 3650) return err('terms.invalid', 'Terms are whole days from 0 to 3650.');
  return ok(v);
}

function uniqueName(c: Company, name: string, selfId: string | null): Result<string> {
  const k = name.toLowerCase();
  for (const p of c.parties.values()) {
    if (p.id !== selfId && p.name.toLowerCase() === k) return err('party.name_taken', `"${p.name}" is already a ${p.kind}.`);
  }
  return ok(name);
}

export function createParty(c: Company, kind: PartyKind, input: PartyInput): Result<Party> {
  if (!isObject(input)) return err('party.invalid', `${kind} details are missing.`);
  const name = cleanName(input.name, 100, `${kind} name`);
  if (!name.ok) return name;
  const unique = uniqueName(c, name.value, null);
  if (!unique.ok) return unique;
  const fields = [text(input.companyName, 100, 'company'), text(input.email, 200, 'email'), text(input.phone, 50, 'phone'), text(input.address, 500, 'address'), text(input.notes, 2000, 'notes')];
  for (const f of fields) if (!f.ok) return f;
  const t = terms(input.termsDays);
  if (!t.ok) return t;
  const trn = trnOf(input.trn);
  if (!trn.ok) return trn;
  const [companyName, email, phone, address, notes] = fields.map((f) => (f.ok ? f.value : '')) as [string, string, string, string, string];
  const party: Party = { id: `p-${c.nextPartyId++}`, kind, name: name.value, companyName, email, phone, address, trn: trn.value, termsDays: t.value, active: true, notes };
  c.parties.set(party.id, party);
  return ok(party);
}

export function updateParty(c: Company, kind: PartyKind, id: unknown, input: PartyInput): Result<Party> {
  const p = typeof id === 'string' ? c.parties.get(id) : undefined;
  if (!p || p.kind !== kind) return err('party.missing', `${kind} does not exist.`);
  if (!isObject(input)) return err('party.invalid', `${kind} details are missing.`);
  const name = input.name === undefined ? ok(p.name) : cleanName(input.name, 100, `${kind} name`);
  if (!name.ok) return name;
  const unique = uniqueName(c, name.value, p.id);
  if (!unique.ok) return unique;
  const pick = (v: unknown, cur: string, max: number, what: string) => (v === undefined ? ok(cur) : text(v, max, what));
  const fields = [pick(input.companyName, p.companyName, 100, 'company'), pick(input.email, p.email, 200, 'email'), pick(input.phone, p.phone, 50, 'phone'), pick(input.address, p.address, 500, 'address'), pick(input.notes, p.notes, 2000, 'notes')];
  for (const f of fields) if (!f.ok) return f;
  const t = input.termsDays === undefined ? ok(p.termsDays) : terms(input.termsDays);
  if (!t.ok) return t;
  const trn = input.trn === undefined ? ok(p.trn) : trnOf(input.trn);
  if (!trn.ok) return trn;
  p.trn = trn.value;
  [p.companyName, p.email, p.phone, p.address, p.notes] = fields.map((f) => (f.ok ? f.value : '')) as [string, string, string, string, string];
  p.name = name.value;
  p.termsDays = t.value;
  return ok(p);
}

export function setPartyActive(c: Company, kind: PartyKind, id: unknown, active: unknown): Result<Party> {
  const p = typeof id === 'string' ? c.parties.get(id) : undefined;
  if (!p || p.kind !== kind) return err('party.missing', `${kind} does not exist.`);
  if (typeof active !== 'boolean') return err('party.active_invalid', 'Active must be true or false.');
  p.active = active;
  return ok(p);
}

export function findParty(c: Company, kind: PartyKind, key: unknown): Party | undefined {
  if (typeof key !== 'string') return undefined;
  const byId = c.parties.get(key);
  if (byId) return byId.kind === kind ? byId : undefined;
  const k = key.trim().toLowerCase();
  for (const p of c.parties.values()) if (p.kind === kind && p.name.toLowerCase() === k) return p;
  return undefined;
}
