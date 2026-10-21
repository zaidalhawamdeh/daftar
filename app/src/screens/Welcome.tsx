import { useEffect, useState } from 'preact/hooks';
import { createCompany } from '../../../core/company.ts';
import { studio } from '../../../core/test/golden/studio.ts';
import { fromText } from '../../../store/serialize.ts';
import { lang, t } from '../i18n.ts';
import { listStored, openCompany, openStored, setLanguage, useApp } from '../state.ts';
import { Field, ProblemBox, useOutcome } from '../ui.tsx';

const CURRENCIES = ['JOD', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'IQD', 'USD', 'EUR', 'GBP', 'CAD'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

export function Welcome() {
  const s = useApp();
  const out = useOutcome();
  const [recent, setRecent] = useState<{ id: string; name: string; savedAt: string }[]>([]);
  const [name, setName] = useState('');
  const [cur, setCur] = useState('JOD');
  const [fy, setFy] = useState(1);
  const [template, setTemplate] = useState('basic');
  useEffect(() => {
    listStored().then(setRecent).catch(() => setRecent([]));
  }, []);

  const create = (e: Event) => {
    e.preventDefault();
    const r = createCompany({ name, currency: cur, language: s.lang, fiscalYearStartMonth: fy, template });
    if (!r.ok) return out.fail(r.error);
    openCompany(r.value);
  };
  const openFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const r = fromText(await file.text());
    if (!r.ok) return out.fail(r.error);
    openCompany(r.value);
  };
  const months = lang() === 'ar' ? MONTHS_AR : MONTHS_EN;

  return (
    <div class="welcome">
      <div class="row">
        <div class="brand">{lang() === 'ar' ? 'دفتر' : 'Daftar'}</div>
        <span class="spacer" />
        <button class="small" onClick={() => setLanguage(s.lang === 'ar' ? 'en' : 'ar')}>{s.lang === 'ar' ? 'English' : 'العربية'}</button>
      </div>
      <p class="muted">{t('Open-source accounting that stays on your computer.')}</p>

      {recent.length > 0 && (
        <section>
          <h2>{t('Recent companies')}</h2>
          <div class="row">
            {recent.map((r) => (
              <button key={r.id} onClick={async () => { const x = await openStored(r.id); if (!x.ok) out.fail(x.error); }}>
                {r.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section class="card" style={{ marginTop: 'var(--s5)' }}>
        <h2 style={{ marginTop: 0 }}>{t('New company')}</h2>
        <form onSubmit={create}>
          <div class="fields">
            <Field label={t('Company name')} wide>
              <input value={name} required onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label={t('Currency')}>
              <select value={cur} onChange={(e) => setCur((e.target as HTMLSelectElement).value)}>
                {CURRENCIES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            <Field label={t('Fiscal year starts in')}>
              <select value={fy} onChange={(e) => setFy(Number((e.target as HTMLSelectElement).value))}>
                {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label={t('Chart of accounts')}>
              <select value={template} onChange={(e) => setTemplate((e.target as HTMLSelectElement).value)}>
                <option value="basic">{t('Basic chart for a small business')}</option>
                <option value="none">{t('Start empty')}</option>
              </select>
            </Field>
          </div>
          <ProblemBox p={out.problem} />
          <button class="primary" type="submit">{t('Create company')}</button>
        </form>
      </section>

      <div class="row" style={{ marginTop: 'var(--s4)' }}>
        <button onClick={() => openCompany(studio().c)}>{t('Try the sample company')}</button>
        <label class="btn">
          {t('Open a company file')}
          <input type="file" accept=".daftar,application/json" hidden onChange={openFile} />
        </label>
      </div>
      <p class="muted" style={{ marginTop: 'var(--s4)' }}>{t('Your books never leave this computer unless you export them.')}</p>
    </div>
  );
}
