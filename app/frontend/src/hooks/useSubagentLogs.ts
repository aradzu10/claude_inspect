import { useRef, useState } from 'react';
import { Event } from '../types';

export const useSubagentLogs = (selectedSessionId: string | null) => {
  const [subagentLogs, setSubagentLogs] = useState<Record<string, Event[]>>({});
  const pendingSubagentFetchesRef = useRef<Set<string>>(new Set());

  const fetchSubagentLogs = (agentId: string) => {
    if (!selectedSessionId || subagentLogs[agentId] || pendingSubagentFetchesRef.current.has(agentId)) return;
    pendingSubagentFetchesRef.current.add(agentId);
    fetch(`/api/subagent/${selectedSessionId}/${agentId}`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        setSubagentLogs(prev => ({ ...prev, [agentId]: Array.isArray(data) ? data : [] }));
      })
      .catch(() => {
        setSubagentLogs(prev => ({ ...prev, [agentId]: [] }));
      })
      .finally(() => {
        pendingSubagentFetchesRef.current.delete(agentId);
      });
  };

  return { subagentLogs, setSubagentLogs, fetchSubagentLogs };
};
