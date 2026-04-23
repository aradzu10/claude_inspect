import { useEffect, useState } from 'react';
import { HIDDEN_SESSIONS_STORAGE_KEY } from '../constants';

export const useHiddenSessions = () => {
  const [hiddenSessionIds, setHiddenSessionIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_SESSIONS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    window.localStorage.setItem(HIDDEN_SESSIONS_STORAGE_KEY, JSON.stringify(hiddenSessionIds));
  }, [hiddenSessionIds]);

  return { hiddenSessionIds, setHiddenSessionIds };
};
