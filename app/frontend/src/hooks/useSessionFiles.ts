import { useEffect, useState } from 'react';

export const useSessionFiles = (selectedSessionId: string | null) => {
  const [sessionFilesStatus, setSessionFilesStatus] = useState<string | null>(null);

  useEffect(() => {
    setSessionFilesStatus(null);
  }, [selectedSessionId]);

  const createSessionFilesOnly = async () => {
    if (!selectedSessionId) return;
    const sessionId = selectedSessionId;
    setSessionFilesStatus('Creating session files...');
    try {
      const response = await fetch(`/api/session/${sessionId}/session-files`, { method: 'POST' });
      if (!response.ok) {
        setSessionFilesStatus('Error: Failed to create session files');
        return;
      }
      const data = await response.json();
      const subagentCount = Number(data?.subagent_count || 0);
      const groupCount = Number(data?.group_count || 0);
      setSessionFilesStatus(`Created (${subagentCount} sub-agents, ${groupCount} groups)`);
    } catch {
      setSessionFilesStatus('Error: Failed to create session files');
    }
  };

  return { sessionFilesStatus, createSessionFilesOnly };
};
