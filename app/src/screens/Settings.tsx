import { useEffect, useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import { fromText, toText } from '../../../store/serialize.ts';
import { EMIRATES, type Emirate } from '../../../core/vat.ts';
import { lang, t } from '../i18n.ts';
import { emirateName } from '../labels.ts';
import { listBackups, openCompany, restoreBackup, run, useApp } from '../state.ts';
import { DateInput, Field, ProblemBox, useOutcome } from '../ui.tsx';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

export function Settings({ c }: { c: Company }) {
  const out = useOutcome();
  const [closing, setClosing] = useState(c.closingDate ?? '');
  const [reopen, setReopen] = useState(false);
  const s = useApp();
  const [versions, setVersions] = useState<{ key: number; savedAt: string }[]>([]);
  useEffect(() => {
    if (s.companyId) listBackups(s.companyId).then(setVersions).catch(() => setVersions([]));
  }, [s.companyId, s.saving]);
  const months = lang() === 'ar' ? MONTHS_AR : MONTHS_EN;

  const saveClosing = () => {
    const r = run('company.setClosingDate', { date: closing || null, reopen });
    if (!r.ok) return out.fail(r.error);
    setReopen(false);
    out.succeed('✓');
  };
  const download = () => {
    const blob = new Blob([toText(c)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${c.name.replace(/[\\/:*?"<>|]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.daftar`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportIif = () => {
    const r = run<string>('export.iif');
    if (!r.ok) return out.fail(r.error);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.value], { type: 'text/plain' }));
    a.download = `${c.name.replace(/[\/:*?"<>|]+/g, '_')}.iif`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const restore = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const r = fromText(await file.text());
    if (!r.ok) return out.fail(r.error);
    openCompany(r.value);
  };

  return (
    <div>
      <h1>{t('Settings')}</h1>
      <div class="card">
        <div class="fields">
          <Field label={t('Company name')} wide><input value={c.name} disabled /></Field>
          <Field label={t('Currency')}><input value={c.currency.code} disabled /></Field>
          <Field label={t('Fiscal year starts in')}>
            <select value={c.fiscalYearStartMonth} onChange={(e) => { const r = run('company.setFiscalYearStart', { month: Number((e.target as HTMLSelectElement).value) }); if (!r.ok) out.fail(r.error); }}>
              {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <VatSettings c={c} />

      <h2>{t('Closing date')}</h2>
      <div class="card">
        <p class="muted">{t('Books are closed through')}: <strong class="num">{c.closingDate ?? t('Not set')}</strong></p>
        <div class="row">
          <Field label={t('Closing date')}><DateInput value={closing} onInput={setClosing} /></Field>
          <label class="check" style={{ alignSelf: 'flex-end' }}><input type="checkbox" checked={reopen} onChange={() => setReopen(!reopen)} /> {t('Reopen closed periods')}</label>
          <button class="primary" style={{ alignSelf: 'flex-end' }} onClick={saveClosing}>{t('Set closing date')}</button>
        </div>
        <ProblemBox p={out.problem} />
        {out.notice && <div class="notice" role="status">{out.notice}</div>}
      </div>

      <h2>{t('Backup')}</h2>
      <div class="card row">
        <button onClick={download}>{t('Download backup file')}</button>
        <button onClick={exportIif}>{t('Export to QuickBooks (IIF)')}</button>
        <label class="btn">
          {t('Open a backup file as a new company')}
          <input type="file" accept=".daftar,application/json" hidden onChange={restore} />
        </label>
      </div>

      <h2>{t('Earlier versions')}</h2>
      <div class="table-wrap">
        <table>
          <tbody>
            {versions.slice(1).map((v) => (
              <tr key={v.key}>
                <td class="num">{new Date(v.savedAt).toLocaleString(lang() === 'ar' ? 'ar' : 'en')}</td>
                <td class="n">
                  <button class="small" onClick={async () => { const r = await restoreBackup(v.key); if (!r.ok) out.fail(r.error); else out.succeed('✓'); }}>{t('Restore this version')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// UAE VAT registration: the TRN, the emirate of establishment (which return box the sales go in) and
// the address printed on tax invoices. Only for companies kept in dirhams.
function VatSettings({ c }: { c: Company }) {
  const out = useOutcome();
  const [trn, setTrn] = useState(c.vat?.trn ?? '');
  const [emirate, setEmirate] = useState<Emirate | ''>(c.vat?.emirate ?? '');
  const [address, setAddress] = useState(c.vat?.address ?? '');
  const [from, setFrom] = useState(c.vat?.from ?? '');
  const save = () => {
    const r = run('vat.setup', { trn, emirate, address, from });
    if (!r.ok) return out.fail(r.error);
    out.succeed('✓');
  };
  return (
    <>
      <h2>{t('VAT (UAE)')}</h2>
      <div class="card">
        {c.currency.code !== 'AED' ? (
          <p class="muted">{t('UAE VAT is available for companies kept in UAE dirhams (AED).')}</p>
        ) : (
          <>
            <p class="muted">{c.vat ? t('Registered for VAT. New lines are standard-rated (5%) unless you choose another tax code.') : t('Register the company to add VAT to documents, print tax invoices and prepare the VAT return.')}</p>
            <div class="fields">
              <Field label={t('Tax Registration Number (TRN)')}><input value={trn} inputMode="numeric" placeholder="100…" onInput={(e) => setTrn((e.target as HTMLInputElement).value)} /></Field>
              <Field label={t('Emirate of establishment')}>
                <select value={emirate} onChange={(e) => setEmirate((e.target as HTMLSelectElement).value as Emirate)}>
                  <option value="">{t('Choose…')}</option>
                  {EMIRATES.map((e) => <option key={e} value={e}>{emirateName(e)}</option>)}
                </select>
              </Field>
              <Field label={t('Registered from')}><DateInput value={from} onInput={setFrom} /></Field>
              <Field label={t('Address on tax invoices')} wide><input value={address} onInput={(e) => setAddress((e.target as HTMLInputElement).value)} /></Field>
            </div>
            <button class="primary" onClick={save}>{c.vat ? t('Save VAT details') : t('Register for VAT')}</button>
          </>
        )}
        <ProblemBox p={out.problem} />
        {out.notice && <div class="notice" role="status">{out.notice}</div>}
      </div>
    </>
  );
}
