// UAE Value Added Tax, from Federal Decree-Law No. 8 of 2017 and its Executive Regulation (Cabinet
// Decision No. 52 of 2017 and its amendments), as published by the Federal Tax Authority.
//
// - Tax is worked out per line and rounded to the nearest fils on a mathematical basis (Executive
//   Regulation Article 61; FTA public clarification VATP006: "on a line item basis to the nearest
//   Fils"). That is the second and only other place a money amount is ever rounded.
// - Standard-rated supplies go in the return under the emirate of the business's own establishment,
//   not the customer's (FTA VAT returns user guide, Box 1). A company here has one establishment.
// - Reverse charge: the business accounts for the VAT on services (or goods outside customs) bought
//   from abroad. It is both output tax (Box 3) and, when recoverable, input tax (Box 10).
//
// What this does not model yet, and the return says so: imports through UAE customs (Boxes 6 and 7,
// which the FTA pre-fills from customs data), tourist refunds (Box 2), partial recovery of input tax,
// blocked input tax, the profit margin scheme and designated zones.

import type { AccountType } from './accounts.ts';
import { cleanName, isObject, type Company } from './company.ts';
import { isIsoDate } from './dates.ts';
import type { Doc, DocKind } from './documents.ts';
import type { Minor } from './money.ts';
import { err, ok, type Result } from './result.ts';

export type TaxCode = 'SR' | 'ZR' | 'EX' | 'OS' | 'RC';
export const TAX_CODES: readonly TaxCode[] = ['SR', 'ZR', 'EX', 'OS', 'RC'];
export const ITEM_TAX_CODES: readonly TaxCode[] = ['SR', 'ZR', 'EX', 'OS'];
export const TAX_CODE_LABEL: Record<TaxCode, { en: string; ar: string }> = {
  SR: { en: 'Standard 5%', ar: 'أساسي ٥٪' },
  ZR: { en: 'Zero-rated', ar: 'نسبة صفر' },
  EX: { en: 'Exempt', ar: 'معفى' },
  OS: { en: 'Out of scope', ar: 'خارج النطاق' },
  RC: { en: 'Reverse charge 5%', ar: 'احتساب عكسي ٥٪' },
};
export const isTaxCode = (v: unknown): v is TaxCode => typeof v === 'string' && (TAX_CODES as readonly string[]).includes(v);

export const VAT_PERCENT = 5;

export type Emirate = 'AZ' | 'DU' | 'SH' | 'AJ' | 'UQ' | 'RK' | 'FU';
// In the order of the return's Boxes 1a to 1g.
export const EMIRATES: readonly Emirate[] = ['AZ', 'DU', 'SH', 'AJ', 'UQ', 'RK', 'FU'];
export const EMIRATE_LABEL: Record<Emirate, { en: string; ar: string }> = {
  AZ: { en: 'Abu Dhabi', ar: 'أبوظبي' },
  DU: { en: 'Dubai', ar: 'دبي' },
  SH: { en: 'Sharjah', ar: 'الشارقة' },
  AJ: { en: 'Ajman', ar: 'عجمان' },
  UQ: { en: 'Umm Al Quwain', ar: 'أم القيوين' },
  RK: { en: 'Ras Al Khaimah', ar: 'رأس الخيمة' },
  FU: { en: 'Fujairah', ar: 'الفجيرة' },
};
const isEmirate = (v: unknown): v is Emirate => typeof v === 'string' && (EMIRATES as readonly string[]).includes(v);

export interface VatSettings {
  trn: string; // the Tax Registration Number: 15 digits
  emirate: Emirate;
  address: string; // printed on tax invoices
}

export const isTrn = (v: unknown): v is string => typeof v === 'string' && /^\d{15}$/.test(v);

export const SALES_KINDS = new Set<DocKind>(['estimate', 'invoice', 'sales_receipt', 'credit_memo']);
export const PURCHASE_KINDS = new Set<DocKind>(['purchase_order', 'bill', 'vendor_credit', 'expense']);

// ---------------------------------------------------------------- the arithmetic

// n / d rounded half away from zero, exactly.
function roundDiv(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  if ((a % d) * 2n >= d) q += 1n;
  return neg ? -q : q;
}

export interface LineTax {
  net: Minor; // value of the supply, excluding VAT
  tax: Minor; // VAT on the line
  payable: Minor; // what the line adds to the document total: net plus VAT the supplier charges
}

// `amount` is quantity × rate. With prices that include VAT, a standard-rated amount already holds
// the tax: tax = amount × 5/105. Reverse-charge tax is never on the supplier's invoice, so it is
// always worked out on top of the amount and never added to what is paid.
export function lineTax(amount: Minor, code: TaxCode | null, inclusive: boolean): LineTax {
  if (code !== 'SR' && code !== 'RC') return { net: amount, tax: 0, payable: amount };
  const p = BigInt(VAT_PERCENT);
  if (code === 'SR' && inclusive) {
    const tax = Number(roundDiv(BigInt(amount) * p, 100n + p));
    return { net: amount - tax, tax, payable: amount };
  }
  const tax = Number(roundDiv(BigInt(amount) * p, 100n));
  return { net: amount, tax, payable: code === 'SR' ? amount + tax : amount };
}

export interface DocTax {
  net: Minor; // sum of line values excluding VAT
  vat: Minor; // VAT the document charges (standard-rated lines)
  reverseCharge: Minor; // VAT the business accounts for itself (reverse-charge lines)
}

export function docTax(d: Pick<Doc, 'lines' | 'taxInclusive'>): DocTax {
  let net = 0;
  let vat = 0;
  let reverseCharge = 0;
  for (const l of d.lines) {
    net += lineNet(d, l);
    if (l.taxCode === 'SR') vat += l.tax;
    if (l.taxCode === 'RC') reverseCharge += l.tax;
  }
  return { net, vat, reverseCharge };
}

// ---------------------------------------------------------------- settings and accounts

export interface VatAccounts {
  output: string; // VAT payable: output tax on sales and reverse charge
  input: string; // VAT recoverable: input tax on purchases and reverse charge
}

export function vatAccounts(c: Company): VatAccounts | null {
  let output: string | null = null;
  let input: string | null = null;
  for (const a of c.accounts.values()) {
    if (a.role === 'vat_output') output = a.id;
    if (a.role === 'vat_input') input = a.id;
  }
  return output && input ? { output, input } : null;
}

const VAT_ACCOUNT: Record<'vat_output' | 'vat_input', { number: string; type: AccountType; name: { en: string; ar: string } }> = {
  vat_output: { number: '2210', type: 'other_current_liability', name: { en: 'VAT Payable (Output)', ar: 'ضريبة القيمة المضافة المستحقة (المخرجات)' } },
  vat_input: { number: '1410', type: 'other_current_asset', name: { en: 'VAT Recoverable (Input)', ar: 'ضريبة القيمة المضافة القابلة للاسترداد (المدخلات)' } },
};

// Registers the company for VAT, or changes its details. The two VAT accounts are created the first
// time and are then managed by the system, like Retained Earnings.
export function setupVat(c: Company, input: unknown): Result<VatSettings> {
  if (!isObject(input)) return err('vat.invalid', 'VAT details are missing.');
  if (c.currency.code !== 'AED') return err('vat.currency', 'UAE VAT needs a company kept in UAE dirhams (AED).');
  const trn = typeof input.trn === 'string' ? input.trn.replace(/[\s-]/g, '') : input.trn;
  if (!isTrn(trn)) return err('vat.trn_invalid', 'The Tax Registration Number is 15 digits.');
  if (!isEmirate(input.emirate)) return err('vat.emirate_invalid', 'Choose the emirate where the business is established.');
  const address = cleanName(input.address, 500, 'address');
  if (!address.ok) return err('vat.address_missing', 'The business address is required on tax invoices.');
  const roles = ['vat_output', 'vat_input'] as const;
  const missing = roles.filter((r) => ![...c.accounts.values()].some((a) => a.role === r));
  for (const r of missing) {
    const name = VAT_ACCOUNT[r].name[c.language];
    if ([...c.accounts.values()].some((a) => a.parentId === null && a.name.toLowerCase() === name.toLowerCase())) {
      return err('vat.account_name_taken', `An account named "${name}" already exists; rename it first.`);
    }
  }
  for (const r of missing) {
    const t = VAT_ACCOUNT[r];
    const taken = [...c.accounts.values()].some((a) => a.number === t.number);
    const id = `acc-${c.nextAccountId++}`;
    c.accounts.set(id, { id, number: taken ? '' : t.number, name: t.name[c.language], type: t.type, parentId: null, active: true, role: r });
  }
  c.vat = { trn, emirate: input.emirate, address: address.value };
  return ok(c.vat);
}

// ---------------------------------------------------------------- the return (VAT 201)

export interface ReturnBox {
  amount: Minor;
  vat: Minor;
}

export interface VatReturn {
  from: string;
  to: string;
  emirate: Emirate;
  box1: Record<Emirate, ReturnBox>; // standard-rated supplies, by emirate
  box3: ReturnBox; // supplies subject to the reverse charge
  box4: Minor; // zero-rated supplies
  box5: Minor; // exempt supplies
  box8: ReturnBox; // total outputs
  box9: ReturnBox; // standard-rated expenses (VAT = recoverable)
  box10: ReturnBox; // reverse charge recovered
  box11: ReturnBox; // total inputs
  box12: Minor; // total due tax
  box13: Minor; // total recoverable tax
  box14: Minor; // payable tax; negative means recoverable
  documents: number[]; // what was counted, for the audit trail
}

const zero = (): ReturnBox => ({ amount: 0, vat: 0 });

// Documents count by their date (the date of supply is taken to be the document date). Void
// documents count nowhere. Credit memos and vendor credits reduce the boxes they correct.
export function vatReturn(c: Company, input: unknown): Result<VatReturn> {
  if (!c.vat) return err('vat.not_registered', 'Set up VAT for the company first.');
  if (!isObject(input) || !isIsoDate(input.from) || !isIsoDate(input.to)) return err('date.invalid', 'Choose the start and end of the tax period.');
  if (input.from > input.to) return err('date.order', 'The period starts after it ends.');
  const from = input.from;
  const to = input.to;
  const box1 = Object.fromEntries(EMIRATES.map((e) => [e, zero()])) as Record<Emirate, ReturnBox>;
  const r = { box3: zero(), box4: 0, box5: 0, box9: zero(), box10: zero() };
  const own = box1[c.vat.emirate];
  const documents: number[] = [];
  for (const d of c.documents.values()) {
    if (d.voided || d.date < from || d.date > to) continue;
    const sign = d.kind === 'invoice' || d.kind === 'sales_receipt' || d.kind === 'bill' || d.kind === 'expense' ? 1 : d.kind === 'credit_memo' || d.kind === 'vendor_credit' ? -1 : 0;
    if (!sign) continue;
    let counted = false;
    for (const l of d.lines) {
      const net = lineNet(d, l);
      const sales = SALES_KINDS.has(d.kind);
      if (sales && l.taxCode === 'SR') {
        own.amount += sign * net;
        own.vat += sign * l.tax;
      } else if (sales && l.taxCode === 'ZR') r.box4 += sign * net;
      else if (sales && l.taxCode === 'EX') r.box5 += sign * net;
      else if (!sales && l.taxCode === 'SR') {
        r.box9.amount += sign * net;
        r.box9.vat += sign * l.tax;
      } else if (!sales && l.taxCode === 'RC') {
        r.box3.amount += sign * net;
        r.box3.vat += sign * l.tax;
        r.box10.amount += sign * net;
        r.box10.vat += sign * l.tax;
      } else continue; // out of scope, and zero-rated or exempt purchases (FTA guide, Box 9 exclusions)
      counted = true;
    }
    if (counted) documents.push(d.id);
  }
  const salesAmount = EMIRATES.reduce((s, e) => s + box1[e].amount, 0);
  const salesVat = EMIRATES.reduce((s, e) => s + box1[e].vat, 0);
  const box8 = { amount: salesAmount + r.box3.amount + r.box4 + r.box5, vat: salesVat + r.box3.vat };
  const box11 = { amount: r.box9.amount + r.box10.amount, vat: r.box9.vat + r.box10.vat };
  return ok({ from, to, emirate: c.vat.emirate, box1, ...r, box8, box11, box12: box8.vat, box13: box11.vat, box14: box8.vat - box11.vat, documents: documents.sort((a, b) => a - b) });
}

// A standard-rated line's value excluding VAT, whether its price included VAT or not.
export function lineNet(d: Pick<Doc, 'taxInclusive'>, l: { amount: Minor; tax: Minor; taxCode: TaxCode | null }): Minor {
  return l.taxCode === 'SR' && d.taxInclusive ? l.amount - l.tax : l.amount;
}
