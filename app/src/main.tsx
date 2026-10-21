import { render } from 'preact';
import { App } from './App.tsx';
import { applyPreferences } from './state.ts';
import './styles.css';

applyPreferences();
render(<App />, document.getElementById('app')!);

// Installed or not, the built app keeps working offline once it has been opened. The desktop
// program (app://) already has every file on disk and needs no service worker.
if (import.meta.env.PROD && location.protocol.startsWith('http') && 'serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
