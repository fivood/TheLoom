import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CrashBoundary from './components/CrashBoundary';
import { recordDiagnosticError } from './diagnostics';
import './styles.css';
import '@xyflow/react/dist/style.css';

window.addEventListener('error', (event) => {
  recordDiagnosticError(localStorage, 'window', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  recordDiagnosticError(localStorage, 'promise', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CrashBoundary>
      <App />
    </CrashBoundary>
  </React.StrictMode>,
);
