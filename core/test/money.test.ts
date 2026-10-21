import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currency, formatAmount, parseAmount, sum } from '../money.ts';

const JOD = { code: 'JOD', digits: 3 };
const USD = { code: 'USD', digits: 2 };
const JPY = { code: 'JPY', digits: 0 };
const val = (r: ReturnType<typeof parseAmount>) => (r.ok ? r.value : r.error.code);

test('currencies carry their real number of decimals', () => {
  assert.deepEqual(currency('jod'), { ok: true, value: JOD });
  assert.deepEqual(currency('KWD'), { ok: true, value: { code: 'KWD', digits: 3 } });
  assert.deepEqual(currency('usd'), { ok: true, value: USD });
  assert.equal(currency('XYZ').ok, false);
  assert.equal(currency(7).ok, false);
});

test('parsing turns text into whole minor units without floats', () => {
  assert.equal(val(parseAmount('1,234.567', JOD)), 1234567);
  assert.equal(val(parseAmount('0.1', JOD)), 100);
  assert.equal(val(parseAmount('.5', USD)), 50);
  assert.equal(val(parseAmount('12', USD)), 1200);
  assert.equal(val(parseAmount('-12.5', USD)), -1250);
  assert.equal(val(parseAmount('(12.50)', USD)), -1250);
  assert.equal(val(parseAmount('0.29', USD)), 29, '0.29 * 100 is 28.999… in floating point; we never multiply');
  assert.equal(val(parseAmount('1.005', JOD)), 1005);
  assert.equal(val(parseAmount('500', JPY)), 500);
  assert.equal(val(parseAmount('-0', USD)), 0);
  assert.ok(Object.is(val(parseAmount('-0.00', USD)), 0), 'no negative zero');
});

test('Arabic digits and separators are understood', () => {
  assert.equal(val(parseAmount('١٬٢٣٤٫٥٦٧', JOD)), 1234567);
  assert.equal(val(parseAmount('۱۲۳٫۵', USD)), 12350);
});

test('more decimals than the currency has is refused, never rounded', () => {
  assert.equal(val(parseAmount('1.234', USD)), 'amount.too_precise');
  assert.equal(val(parseAmount('1.5', JPY)), 'amount.too_precise');
  assert.equal(val(parseAmount('1.2345', JOD)), 'amount.too_precise');
});

test('junk and oversized input is refused', () => {
  for (const bad of ['', 'abc', '1.2.3', '1e5', '--1', '12-', '$12', 'NaN', 'Infinity']) {
    assert.equal(parseAmount(bad, USD).ok, false, bad);
  }
  assert.equal(val(parseAmount('99999999999999999999', USD)), 'amount.too_large');
  assert.equal(parseAmount(12 as unknown, USD).ok, false);
});

test('formatting shows every decimal and groups thousands', () => {
  assert.equal(formatAmount(1234567, JOD), '1,234.567');
  assert.equal(formatAmount(5, JOD), '0.005');
  assert.equal(formatAmount(-1250, USD), '-12.50');
  assert.equal(formatAmount(0, USD), '0.00');
  assert.equal(formatAmount(1234567, JPY), '1,234,567');
  assert.equal(formatAmount(1234567, JOD, { grouping: false }), '1234.567');
  for (const bad of [1.5, NaN, 1e21, Infinity]) assert.equal(formatAmount(bad, USD), '#AMOUNT?', String(bad));
});

test('parse and format round-trip', () => {
  for (const m of [0, 1, 9, 10, 999, 1000, 123456789, -42, Number.MAX_SAFE_INTEGER]) {
    for (const cur of [JOD, USD, JPY]) assert.equal(val(parseAmount(formatAmount(m, cur), cur)), m);
  }
});

test('sums refuse to overflow silently', () => {
  assert.deepEqual(sum([1, 2, 3]), { ok: true, value: 6 });
  assert.equal(sum([Number.MAX_SAFE_INTEGER, 1]).ok, false);
  assert.equal(sum([1.5]).ok, false);
});
