import { useEffect, useState } from 'react';
import { getSessionIdFromUrl, updateUrlForSession } from '../utils/url';

export const useSelectedSession = () => {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSubagentId, setActiveSubagentId] = useState<string | null>(null);

  useEffect(() => {
    const initialSessionId = getSessionIdFromUrl();
    if (initialSessionId) {
      setSelectedSessionId(initialSessionId);
    }

    const onPopState = () => {
      setSelectedSessionId(getSessionIdFromUrl());
      setActiveSubagentId(null);
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const selectSessionId = (sessionId: string) => {
    if (sessionId !== selectedSessionId) {
      updateUrlForSession(sessionId);
    }
    setSelectedSessionId(sessionId);
  };

  const clearSelectedSession = () => {
    setSelectedSessionId(null);
    setActiveSubagentId(null);
    updateUrlForSession(null);
  };

  return {
    selectedSessionId,
    setSelectedSessionId,
    selectSessionId,
    clearSelectedSession,
    activeSubagentId,
    setActiveSubagentId,
  };
};
