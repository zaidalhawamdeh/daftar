import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import { t } from '../i18n.ts';
import { go, run } from '../state.ts';
import { AccountSelect, AmountInput, DateInput, Field, ProblemBox, parseMoney, today, useOutcome } from '../ui.tsx';

const MONEY = ['bank', 'credit_card', 'other_current_asset'] as const;

export function Transfer({ c }: { c: Company }) {
  const out = useOutcome();
  const [fromId, setFrom] = useState('');
  const [toId, setTo] = useState('');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const save = (e: Event) => {
    e.preventDefault();
    const r = run('transfer.create', { fromId, toId, date, amount: parseMoney(c, amount), memo });
    if (!r.ok) return out.fail(r.error);
    go('docs', { kind: 'transfer' });
  };
  return (
    <div>
      <div class="row">
        <h1>{t('Transfer')}</h1>
        <span class="spacer" />
        <button onClick={() => go('docs', { kind: 'transfer' })}>{t('Transfers')}</button>
      </div>
      <form class="card" onSubmit={save}>
        <div class="fields">
          <Field label={t('From account')}><AccountSelect c={c} value={fromId} onChange={setFrom} types={[...MONEY]} noVat /></Field>
          <Field label={t('To account')}><AccountSelect c={c} value={toId} onChange={setTo} types={[...MONEY]} noVat /></Field>
          <Field label={t('Date')}><DateInput value={date} onInput={setDate} /></Field>
          <Field label={t('Amount')}><AmountInput c={c} value={amount} onInput={setAmount} /></Field>
          <Field label={t('Memo')} wide><input value={memo} onInput={(e) => setMemo((e.target as HTMLInputElement).value)} /></Field>
        </div>
        <ProblemBox p={out.problem} />
        <button class="primary" type="submit">{t('Save')}</button>
      </form>
    </div>
  );
}
