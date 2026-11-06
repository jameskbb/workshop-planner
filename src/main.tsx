import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/index.css';
// The editor (shell registrations + every feature) is loaded on demand by App; see editorEntry.
import { App } from '@/app/App';
import { dispatch, transact, undo, useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';

// Dev-only handle for debugging and e2e assertions (never shipped in production builds).
if (import.meta.env.DEV) Object.assign(window, { __wp: { useProjectStore, useUiStore, dispatch, transact, undo } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
