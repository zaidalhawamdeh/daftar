import { render } from 'preact';
import { App } from './App.tsx';
import { applyPreferences } from './state.ts';
import './styles.css';

applyPreferences();
render(<App />, document.getElementById('app')!);

// Ask the browser not to evict the books when disk runs low or the site goes unused. It may still
// refuse, which is why the downloaded .daftar file is the real backup.
if (navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined);

// Installed or not, the built app keeps working offline once it has been opened. The desktop
// program (app://) already has every file on disk and needs no service worker.
if (import.meta.env.PROD && location.protocol.startsWith('http') && 'serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
