import { useEffect, useState } from 'preact/hooks';
import type { Company } from '../../../core/company.ts';
import { fromText, toText } from '../../../store/serialize.ts';
import { lang, t } from '../i18n.ts';
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
