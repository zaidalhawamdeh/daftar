import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COMMANDS } from '../../core/commands.ts';
import { lang, t } from './i18n.ts';
import { COMMAND_SCREENS, NAV, type ScreenId } from './routes.ts';
import { closeCompany, go, setLanguage, setTheme, useApp } from './state.ts';
import { Accounts } from './screens/Accounts.tsx';
import { ApplyCredit } from './screens/ApplyCredit.tsx';
import { DocForm } from './screens/DocForm.tsx';
import { Docs } from './screens/Docs.tsx';
import { Home } from './screens/Home.tsx';
import { Items } from './screens/Items.tsx';
import { Journal } from './screens/Journal.tsx';
import { Memorized } from './screens/Memorized.tsx';
import { Parties } from './screens/Parties.tsx';
import { Reconcile } from './screens/Reconcile.tsx';
import { Reports } from './screens/Reports.tsx';
import { Settings } from './screens/Settings.tsx';
import { Settle } from './screens/Settle.tsx';
import { Transfer } from './screens/Transfer.tsx';
import { Welcome } from './screens/Welcome.tsx';
import { Import } from './screens/Import.tsx';

export function App() {
  const s = useApp();
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!s.company) return <Welcome />;
  const c = s.company;
  const r = s.route;
  const p = r.params ?? {};
  const current = (screen: ScreenId, params?: Record<string, unknown>) => r.screen === screen && (!params || Object.entries(params).every(([k, v]) => p[k] === v));

  const screen = (() => {
    switch (r.screen as ScreenId) {
      case 'accounts': return <Accounts c={c} />;
      case 'customers': return <Parties c={c} kind="customer" />;
      case 'vendors': return <Parties c={c} kind="vendor" />;
      case 'items': return <Items c={c} />;
      case 'docs': return <Docs c={c} kind={(p.kind as never) ?? 'invoice'} />;
      case 'sales-form':
      case 'purchase-form': return <DocForm key={String(p.kind) + String(p.partyId ?? "")} c={c} kind={p.kind as never} partyId={p.partyId as string | undefined} />;
      case 'settle-form': return <Settle key={String(p.kind)} c={c} kind={(p.kind as 'payment' | 'bill_payment') ?? 'payment'} />;
      case 'apply-credit': return <ApplyCredit key={`${String(p.side)}-${String(p.sourceId)}`} c={c} side={(p.side as 'customer' | 'vendor') ?? 'customer'} sourceId={p.sourceId as number | undefined} />;
      case 'transfer': return <Transfer c={c} />;
      case 'journal': return <Journal c={c} />;
      case 'reconcile': return <Reconcile c={c} />;
      case 'reports': return <Reports c={c} report={(p.report as string) ?? 'profitAndLoss'} />;
      case 'memorized': return <Memorized c={c} />;
      case 'settings': return <Settings c={c} />;
      case 'import': return <Import c={c} />;
      default: return <Home c={c} />;
    }
  })();

  return (
    <div class="shell">
      <nav class="nav" aria-label={t('Commands')}>
        <div class="brand">
          {lang() === 'ar' ? 'دفتر' : 'Daftar'}
          <small>{c.name}</small>
        </div>
        {NAV.map((g) => (
          <div key={g.group}>
            {g.group && <h4>{t(g.group)}</h4>}
            {g.items.map((i) => (
              <button key={i.label} class="link" aria-current={current(i.target.screen, i.target.params) ? 'page' : undefined} onClick={() => go(i.target.screen, i.target.params)}>
                {t(i.label)}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main class="main">
        <div class="topbar">
          <span class="saved" aria-live="polite">{s.saveError ? <span class="neg">{t('Not saved')}: {s.saveError}</span> : s.saving ? t('Saving…') : t('Saved')}</span>
          <div class="tools">
            <button class="small" onClick={() => setPalette(true)} title="Ctrl+K">
              {t('Search commands…')} <kbd>Ctrl K</kbd>
            </button>
            <button class="small" lang={s.lang === 'ar' ? 'en' : 'ar'} title={t('Language')} onClick={() => setLanguage(s.lang === 'ar' ? 'en' : 'ar')}>
              {s.lang === 'ar' ? 'English' : 'العربية'}
            </button>
            <button class="small" title={t('Theme')} onClick={() => setTheme(s.theme === 'dark' ? 'light' : 'dark')}>
              {s.theme === 'dark' ? t('Light') : t('Dark')}
            </button>
            <button class="small" onClick={closeCompany}>{t('Close company')}</button>
          </div>
        </div>
        {s.elsewhere && (
          <div class="problem" role="alert">
            {t('This company was changed in another tab. Reload to continue here.')}{' '}
            <button class="small" onClick={() => location.reload()}>{t('Reload')}</button>
          </div>
        )}
        {screen}
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

// Every command in the core, searchable by name in either language.
function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const all = useMemo(() => [...COMMANDS.values()].map((cmd) => ({ id: cmd.id, label: cmd.label[lang()], other: cmd.label[lang() === 'ar' ? 'en' : 'ar'] })), []);
  const shown = all.filter((x) => !q || `${x.label} ${x.other} ${x.id}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  const pick = (id: string) => {
    const target = COMMAND_SCREENS[id];
    if (target) go(target.screen, target.params);
    onClose();
  };
  return (
    <div class="overlay" onClick={onClose}>
      <div class="palette" role="dialog" aria-label={t('Commands')} onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder={t('Search commands…')}
          onInput={(e) => {
            setQ((e.target as HTMLInputElement).value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((n) => Math.min(n + 1, shown.length - 1));
            if (e.key === 'ArrowUp') setSel((n) => Math.max(n - 1, 0));
            if (e.key === 'Enter' && shown[sel]) pick(shown[sel].id);
          }}
        />
        <ul role="listbox">
          {shown.map((x, i) => (
            <li key={x.id}>
              <button role="option" aria-selected={i === sel} onClick={() => pick(x.id)}>
                {x.label} <span class="muted">· {x.other}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
