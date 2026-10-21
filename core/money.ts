// Money is an integer count of the currency's smallest unit (fils, cents).
// Floats never touch an amount: parsing and formatting work on digit strings.

import { err, ok, type Result } from './result.ts';

export type Minor = number;

export interface Currency {
  code: string;
  digits: number;
}

// ISO 4217 minor units for the currencies we expect first.
const DIGITS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, INR: 2, TRY: 2,
  AED: 2, SAR: 2, QAR: 2, EGP: 2, MAD: 2, LBP: 2, SYP: 2, ILS: 2,
  JOD: 3, KWD: 3, BHD: 3, OMR: 3, IQD: 3, TND: 3, LYD: 3,
  JPY: 0, KRW: 0,
};

export function currency(code: unknown): Result<Currency> {
  if (typeof code !== 'string') return err('currency.invalid', 'Currency code must be text.');
  const c = code.trim().toUpperCase();
  const digits = DIGITS[c];
  if (digits === undefined) return err('currency.unknown', `Unknown currency "${code}".`, { code });
  return ok({ code: c, digits });
}

export function isMinor(n: unknown): n is Minor {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

export function add(a: Minor, b: Minor): Result<Minor> {
  const s = a + b;
  if (!Number.isSafeInteger(s)) return err('amount.too_large', 'Amount is too large.');
  return ok(s);
}

export function sum(values: readonly Minor[]): Result<Minor> {
  let total = 0;
  for (const v of values) {
    if (!isMinor(v)) return err('amount.invalid', 'Amount must be a whole number of minor units.');
    total += v;
    if (!Number.isSafeInteger(total)) return err('amount.too_large', 'Total is too large.');
  }
  return ok(total);
}

const LOCAL_DIGITS = ['٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹'];

function westernDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    let mapped = ch;
    for (const set of LOCAL_DIGITS) {
      const i = set.indexOf(ch);
      if (i >= 0) mapped = String(i);
    }
    out += mapped;
  }
  return out;
}

// Accepts "1,234.567", "-12.5", "(12.50)", Arabic-Indic digits and the Arabic separators ٫ ٬.
// Never rounds: more decimals than the currency has is an error, not a guess.
export function parseAmount(text: unknown, cur: Currency): Result<Minor> {
  if (typeof text !== 'string') return err('amount.invalid', 'Amount must be text.');
  let s = westernDigits(text.trim()).replace(/٫/g, '.').replace(/[٬,\s  ]/g, '');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) {
    return err('amount.invalid', `"${text}" is not an amount.`, { text });
  }
  const [intPart = '', fracPart = ''] = s.split('.');
  if (fracPart.length > cur.digits) {
    return err('amount.too_precise', `${cur.code} has ${cur.digits} decimal places.`, { text, digits: cur.digits });
  }
  const digits = ((intPart || '0') + fracPart.padEnd(cur.digits, '0')).replace(/^0+(?=\d)/, '');
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return err('amount.too_large', 'Amount is too large.', { text });
  return ok(negative && n !== 0 ? -n : n);
}

export function formatAmount(m: Minor, cur: Currency, opts: { grouping?: boolean } = {}): string {
  const grouping = opts.grouping ?? true;
  const negative = m < 0;
  const raw = String(Math.abs(m)).padStart(cur.digits + 1, '0');
  let intPart = cur.digits > 0 ? raw.slice(0, -cur.digits) : raw;
  const fracPart = cur.digits > 0 ? raw.slice(-cur.digits) : '';
  if (grouping) intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + intPart + (fracPart ? '.' + fracPart : '');
}
