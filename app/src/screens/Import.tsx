// Moving in: a QuickBooks IIF file, opening balances from CSV reports, or lists from CSV. Every import
// is previewed on a copy of the books first; nothing changes until the person confirms.

import { useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import { t } from '../i18n.ts';
import { preview, run } from '../state.ts';
import { DateInput, Field, ProblemBox, today, useOutcome } from '../ui.tsx';

type Mode = 'iif' | 'opening' | 'list';

async function readFile(e: Event): Promise<string> {
  const file = (e.target as HTMLInputElement).files?.[0];
  return file ? file.text() : '';
}

export function Import({ c }: { c: Company }) {
  void c;
  const out = useOutcome();
  const [mode, setMode] = useState<Mode>('iif');
  const [iif, setIif] = useState('');
  const [tb, setTb] = useState('');
  const [inv, setInv] = useState('');
  const [bills, setBills] = useState('');
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState('customer');
  const [list, setList] = useState('');
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const request = (): [string, Record<string, unknown>] =>
    mode === 'iif' ? ['import.iif', { text: iif }] : mode === 'opening' ? ['import.openingBalances', { date, trialBalance: tb, openInvoices: inv, unpaidBills: bills }] : ['import.list', { kind, text: list }];
  const check = () => {
    const [id, p] = request();
    const r = preview<Record<string, unknown>>(id, p);
    if (!r.ok) {
      setSummary(null);
      return out.fail(r.error);
    }
    out.clear();
    setSummary(r.value);
  };
  const commit = () => {
    const [id, p] = request();
    const r = run<Record<string, unknown>>(id, p);
    if (!r.ok) return out.fail(r.error);
    setSummary(null);
    out.succeed('✓');
  };
  const file = (set: (s: string) => void) => async (e: Event) => {
    set(await readFile(e));
    setSummary(null);
  };

  return (
    <div>
      <h1>{t('Import')}</h1>
      <div class="row" role="tablist" style={{ marginBottom: 'var(--s4)' }}>
        {(['iif', 'opening', 'list'] as Mode[]).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} class={mode === m ? 'primary' : ''} onClick={() => { setMode(m); setSummary(null); out.clear(); }}>
            {t(m === 'iif' ? 'QuickBooks file (IIF)' : m === 'opening' ? 'Opening balances (CSV)' : 'Lists (CSV)')}
          </button>
        ))}
      </div>
      <div class="card">
        {mode === 'iif' && (
          <>
            <p class="muted">{t('In QuickBooks Desktop: File → Utilities → Export → Lists and transactions to IIF files.')}</p>
            <Field label="IIF"><input type="file" accept=".iif,.txt" onChange={file(setIif)} /></Field>
          </>
        )}
        {mode === 'opening' && (
          <>
            <p class="muted">{t('Export these reports as CSV on the date you start: Trial Balance, Open Invoices, Unpaid Bills. Accounts must exist first.')}</p>
            <div class="fields">
              <Field label={t('Date')}><DateInput value={date} onInput={setDate} /></Field>
              <Field label={t('Trial balance')}><input type="file" accept=".csv,.txt" onChange={file(setTb)} /></Field>
              <Field label={t('Open invoices')}><input type="file" accept=".csv,.txt" onChange={file(setInv)} /></Field>
              <Field label={t('Unpaid bills')}><input type="file" accept=".csv,.txt" onChange={file(setBills)} /></Field>
            </div>
          </>
        )}
        {mode === 'list' && (
          <div class="fields">
            <Field label={t('Type')}>
              <select value={kind} onChange={(e) => { setKind((e.target as HTMLSelectElement).value); setSummary(null); }}>
                <option value="customer">{t('Customers')}</option>
                <option value="vendor">{t('Vendors')}</option>
                <option value="item">{t('Items')}</option>
                <option value="account">{t('Chart of accounts')}</option>
              </select>
            </Field>
            <Field label="CSV"><input type="file" accept=".csv,.txt" onChange={file(setList)} /></Field>
          </div>
        )}
        <ProblemBox p={out.problem} />
        {out.notice && <div class="notice" role="status">{out.notice}</div>}
        {summary && (
          <div class="table-wrap" style={{ margin: 'var(--s3) 0' }}>
            <table>
              <tbody>
                {Object.entries(summary).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{Array.isArray(v) ? v.join(' · ') || '—' : typeof v === 'object' && v ? Object.entries(v).map(([a, b]) => `${a}: ${String(b)}`).join(', ') : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div class="row">
          <button onClick={check}>{t('Preview')}</button>
          <button class="primary" onClick={commit} disabled={!summary}>{t('Import')}</button>
        </div>
      </div>
    </div>
  );
}
