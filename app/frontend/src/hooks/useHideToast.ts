import { useEffect, useState } from 'react';
import { HIDE_TOAST_DURATION_MS } from '../constants';

export interface HideToastState {
  sessionId: string;
  label: string;
}

export const useHideToast = () => {
  const [hideToast, setHideToast] = useState<HideToastState | null>(null);
  const [hideToastProgress, setHideToastProgress] = useState(100);

  useEffect(() => {
    if (!hideToast) return;
    const startedAt = Date.now();
    setHideToastProgress(100);
    const intervalId = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, HIDE_TOAST_DURATION_MS - elapsed);
      setHideToastProgress((remaining / HIDE_TOAST_DURATION_MS) * 100);
      if (remaining === 0) {
        setHideToast(null);
      }
    }, 50);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hideToast]);

  return { hideToast, setHideToast, hideToastProgress };
};
