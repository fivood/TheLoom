import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportProject, useLoom } from '../store';
import { recordDiagnosticError } from '../diagnostics';

interface CrashBoundaryState {
  error: Error | null;
}

export default class CrashBoundary extends Component<{ children: ReactNode }, CrashBoundaryState> {
  state: CrashBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('界面发生错误', error, info.componentStack);
    recordDiagnosticError(localStorage, 'react', error, info.componentStack ?? '');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash-screen">
        <section className="crash-card">
          <div className="crash-mark">!</div>
          <h1>界面遇到问题</h1>
          <p>项目会继续保存在本地。建议先下载紧急备份，再重新载入应用。</p>
          <div className="crash-actions">
            <button onClick={() => exportProject(useLoom.getState().project)}>下载紧急备份</button>
            <button className="primary" onClick={() => window.location.reload()}>重新载入</button>
          </div>
          <details>
            <summary>错误详情</summary>
            <pre>{this.state.error.message}</pre>
          </details>
        </section>
      </main>
    );
  }
}
