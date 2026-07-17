import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CrashBoundary from './components/CrashBoundary';
import { recordDiagnosticError } from './diagnostics';
import { initTheme } from './theme';
import './styles.css';
import '@xyflow/react/dist/style.css';

// 主题在样式加载后、React 挂载前应用,避免启动白闪
initTheme();

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
