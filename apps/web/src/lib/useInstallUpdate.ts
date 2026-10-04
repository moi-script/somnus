'use client';

import { useCallback, useState } from 'react';
import { downloadLabel, updateErrorText } from './updateFlow';

export type InstallState =
  | { phase: 'idle' }
  | { phase: 'downloading'; label: string }
  | { phase: 'installing' }
  | { phase: 'error'; message: string };

/** In-app update: download with progress, then hand the APK to Android's installer. */
export function useInstallUpdate(url: string) {
  const [state, setState] = useState<InstallState>({ phase: 'idle' });

  const start = useCallback(async () => {
    setState({ phase: 'downloading', label: downloadLabel(0, 0) });
    const { downloadAndInstall, InstallStepError } = await import('./native/installUpdate');
    try {
      await downloadAndInstall(url, (received, total) =>
        setState({ phase: 'downloading', label: downloadLabel(received, total) }),
      );
      setState({ phase: 'installing' });
    } catch (err) {
      const step = err instanceof InstallStepError ? err.step : 'download';
      setState({ phase: 'error', message: updateErrorText(step, err) });
    }
  }, [url]);

  return { state, start };
}
