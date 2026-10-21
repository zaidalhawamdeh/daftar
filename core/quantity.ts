// Quantities have up to three decimals and are stored as thousandths ("1.5 hours" = 1500).
// A line amount is quantity × rate, rounded half away from zero to the currency's minor unit,
// computed with BigInt so no step is ever approximate.

import type { Minor } from './money.ts';
import { err, ok, type Result } from './result.ts';

export type Milli = number;
export const ONE: Milli = 1000;
const MAX_QTY: Milli = 1_000_000_000_000; // a billion units

export function parseQuantity(v: unknown): Result<Milli> {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : typeof v === 'string' ? v.trim() : '';
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return err('quantity.invalid', 'Quantity is a positive number with up to 3 decimals.', { quantity: v });
  const [i = '0', f = ''] = s.split('.');
  const n = Number(i) * 1000 + Number(f.padEnd(3, '0'));
  if (n <= 0) return err('quantity.zero', 'Quantity must be more than zero.');
  if (n > MAX_QTY) return err('quantity.too_large', 'Quantity is too large.');
  return ok(n);
}

export function lineAmount(quantity: Milli, rate: Minor): Result<Minor> {
  const p = BigInt(quantity) * BigInt(rate);
  let q = p / 1000n;
  const r = p % 1000n;
  if ((r < 0n ? -r : r) * 2n >= 1000n) q += p < 0n ? -1n : 1n;
  if (q > BigInt(Number.MAX_SAFE_INTEGER) || q < -BigInt(Number.MAX_SAFE_INTEGER)) return err('amount.too_large', 'Line amount is too large.');
  return ok(Number(q));
}

export function formatQuantity(q: Milli): string {
  const i = Math.floor(q / 1000);
  const f = String(q % 1000).padStart(3, '0').replace(/0+$/, '');
  return f ? `${i}.${f}` : String(i);
}
