import { render } from 'preact';
import { App } from './App.tsx';
import { applyPreferences } from './state.ts';
import './styles.css';

applyPreferences();
render(<App />, document.getElementById('app')!);

// Installed or not, the built app keeps working offline once it has been opened.
if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js');
