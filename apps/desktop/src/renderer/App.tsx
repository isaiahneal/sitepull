import { useEffect, useState } from 'react';

import { AppChrome } from './components/AppChrome.js';
import { CaptureView } from './components/CaptureView.js';
import { EmptyState } from './components/EmptyState.js';
import { ErrorView } from './components/ErrorView.js';
import { ResultWorkspace } from './components/ResultWorkspace.js';
import { Toast, type ToastState } from './components/Toast.js';
import { useSitepull } from './hooks/use-sitepull.js';

export function App() {
  const controller = useSitepull();
  const { model, goHome } = controller;
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3_600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  return (
    <AppChrome screen={model.screen} hostname={model.manifest?.source.hostname} onHome={goHome}>
      {model.screen === 'empty' ? <EmptyState controller={controller} /> : null}
      {model.screen === 'capturing' ? <CaptureView controller={controller} /> : null}
      {model.screen === 'error' ? <ErrorView controller={controller} /> : null}
      {model.screen === 'results' ? (
        <ResultWorkspace controller={controller} notify={setToast} />
      ) : null}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </AppChrome>
  );
}
