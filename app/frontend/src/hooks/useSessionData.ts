import { useEffect, useState } from 'react';
import { Analysis, Event } from '../types';

export interface EventCounts {
  withSubagents: number;
  withoutSubagents: number;
}

export const useSessionData = (selectedSessionId: string | null) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [eventCounts, setEventCounts] = useState<EventCounts>({ withSubagents: 0, withoutSubagents: 0 });
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  useEffect(() => {
    if (!selectedSessionId) return;

    setLoading(true);
    setAnalysis(null);
    setEventCounts({ withSubagents: 0, withoutSubagents: 0 });

    const controller = new AbortController();
    const signal = controller.signal;

    Promise.all([
      fetch(`/api/session/${selectedSessionId}/analysis`, { signal })
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`/api/session/${selectedSessionId}`, { signal }).then(res => {
        if (!res.ok) {
          throw new Error('Failed to load session');
        }
        return res.json();
      }),
      fetch(`/api/session/${selectedSessionId}?include_subagents=true`, { signal })
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null),
    ])
      .then(([analysisData, sessionData, withSubagentsData]) => {
        const sessionEvents = Array.isArray(sessionData) ? sessionData : [];
        const allEvents = Array.isArray(withSubagentsData) ? withSubagentsData : sessionEvents;
        setAnalysis(analysisData);
        setEvents(sessionEvents);
        setEventCounts({
          withSubagents: allEvents.length,
          withoutSubagents: sessionEvents.length,
        });
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setEvents([]);
          setEventCounts({ withSubagents: 0, withoutSubagents: 0 });
        }
      })
      .finally(() => {
        if (!signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedSessionId]);

  return { events, eventCounts, loading, analysis, setAnalysis };
};
