// Regressions for the adversarial review of M6 (21 Oct 2026). Each failed before its fix.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCompany } from '../company.ts';
import { importOpeningBalances } from '../import/opening.ts';

test('#6 a trial balance whose accounts are all missing names them instead of saying it is empty', () => {
  const r = createCompany({ name: 'M6', currency: 'USD', template: 'basic' });
  assert.ok(r.ok);
  const out = importOpeningBalances(r.value, { date: '2026-01-01', trialBalance: 'Account,Debit,Credit\nPetty cash drawer,50.00,\nOwner loan,,50.00' });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.error.code, 'opening.accounts_missing');
  assert.match(out.error.message, /Petty cash drawer/);
  assert.match(out.error.message, /Owner loan/);
});
