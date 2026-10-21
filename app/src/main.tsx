import { render } from 'preact';
import { App } from './App.tsx';
import { applyPreferences } from './state.ts';
import './styles.css';

applyPreferences();
render(<App />, document.getElementById('app')!);
