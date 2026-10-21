import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import { reversalOf } from '../../../core/journal.ts';
import { t } from '../i18n.ts';
import { run } from '../state.ts';
import { AccountSelect, AmountInput, DateInput, Field, Money, ProblemBox, parseMoney, today, useOutcome } from '../ui.tsx';

interface Row {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}
const blank = (): Row => ({ accountId: '', debit: '', credit: '', memo: '' });

export function Journal({ c }: { c: Company }) {
  const out = useOutcome();
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [rows, setRows] = useState<Row[]>([blank(), blank()]);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const debits = rows.reduce((s, r) => s + (parseMoney(c, r.debit) ?? 0), 0);
  const credits = rows.reduce((s, r) => s + (parseMoney(c, r.credit) ?? 0), 0);
  const save = () => {
    const lines = rows.filter((r) => r.accountId).map((r) => ({ accountId: r.accountId, debit: parseMoney(c, r.debit) ?? 0, credit: parseMoney(c, r.credit) ?? 0, memo: r.memo }));
    const r = run('journal.post', { date, memo, lines });
    if (!r.ok) return out.fail(r.error);
    setRows([blank(), blank()]);
    setMemo('');
    out.succeed('✓');
  };
  // Entries written by hand; documents' entries are managed through their documents.
  const manual = c.entries.filter((e) => !e.source).slice().reverse();
  return (
    <div>
      <h1>{t('Journal entry')}</h1>
      <div class="card">
        <div class="fields">
          <Field label={t('Date')}><DateInput value={date} onInput={setDate} /></Field>
          <Field label={t('Memo')} wide><input value={memo} onInput={(e) => setMemo((e.target as HTMLInputElement).value)} /></Field>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th style={{ width: '34%' }}>{t('Account')}</th><th class="n">{t('Debit')}</th><th class="n">{t('Credit')}</th><th>{t('Memo')}</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><AccountSelect c={c} value={r.accountId} onChange={(v) => set(i, { accountId: v })} exclude={['accounts_receivable', 'accounts_payable']} label={t('Account')} /></td>
                  <td><AmountInput c={c} value={r.debit} label={t('Debit')} onInput={(v) => set(i, { debit: v, credit: v ? '' : r.credit })} /></td>
                  <td><AmountInput c={c} value={r.credit} label={t('Credit')} onInput={(v) => set(i, { credit: v, debit: v ? '' : r.debit })} /></td>
                  <td><input value={r.memo} onInput={(e) => set(i, { memo: (e.target as HTMLInputElement).value })} /></td>
                  <td><button class="small" aria-label={t('Remove line')} onClick={() => setRows(rows.length > 2 ? rows.filter((_, j) => j !== i) : rows)}>×</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><button class="small" onClick={() => setRows([...rows, blank()])}>{t('Add line')}</button></td>
                <td class="n"><Money c={c} value={debits} /></td>
                <td class="n"><Money c={c} value={credits} /></td>
                <td colSpan={2} class={debits === credits ? 'muted' : 'neg'}>{debits === credits ? '' : `${t('Difference')}: `}{debits !== credits && <Money c={c} value={debits - credits} />}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <ProblemBox p={out.problem} />
        {out.notice && <div class="notice" role="status">{out.notice}</div>}
        <div class="row" style={{ marginTop: 'var(--s3)' }}><button class="primary" onClick={save} disabled={debits !== credits || debits === 0}>{t('Save')}</button></div>
      </div>

      <h2>{t('Journal entries')}</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>{t('Date')}</th><th>#</th><th>{t('Memo')}</th><th class="n">{t('Amount')}</th><th /></tr></thead>
          <tbody>
            {manual.map((e) => {
              const reversed = reversalOf(c, e.id);
              const amount = e.lines.reduce((s, l) => s + l.debit, 0);
              return (
                <tr key={e.id} class={reversed || e.reverses ? 'void' : ''}>
                  <td class="num">{e.date}</td>
                  <td class="num">{e.id}</td>
                  <td>{e.memo}</td>
                  <td class="n"><Money c={c} value={amount} /></td>
                  <td class="n">
                    {!reversed && e.reverses === null && (
                      <button class="small" onClick={() => { const r = run('journal.reverse', { entryId: e.id, date: today() < e.date ? e.date : today() }); if (!r.ok) out.fail(r.error); }}>{t('Reverse')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
