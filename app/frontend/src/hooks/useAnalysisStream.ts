import { useEffect, useRef, useState } from 'react';
import { Analysis } from '../types';

export const useAnalysisStream = (
  selectedSessionId: string | null,
  setAnalysis: (analysis: Analysis | null) => void,
) => {
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [totalTasks, setTotalTasks] = useState<number | null>(null);
  const [showConfirmOverride, setShowConfirmOverride] = useState(false);
  const analysisEventSourceRef = useRef<EventSource | null>(null);
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const subagentTotalRef = useRef<number>(0);

  useEffect(() => {
    if (analysisEventSourceRef.current) {
      analysisEventSourceRef.current.close();
      analysisEventSourceRef.current = null;
    }
    setAnalysisProgress(null);
    setTotalTasks(null);
    subagentTotalRef.current = 0;
    setShowConfirmOverride(false);
  }, [selectedSessionId]);

  useEffect(() => {
    return () => {
      if (analysisEventSourceRef.current) {
        analysisEventSourceRef.current.close();
        analysisEventSourceRef.current = null;
      }
    };
  }, []);

  const askConfirm = (): Promise<boolean> =>
    new Promise(resolve => {
      confirmResolveRef.current = resolve;
      setShowConfirmOverride(true);
    });

  const handleConfirmOverride = () => {
    setShowConfirmOverride(false);
    confirmResolveRef.current?.(true);
  };

  const handleCancelOverride = () => {
    setShowConfirmOverride(false);
    confirmResolveRef.current?.(false);
  };

  const triggerAnalysis = async () => {
    if (!selectedSessionId) return;
    const sessionId = selectedSessionId;

    const existsResponse = await fetch(`/api/session/${sessionId}/analysis`);
    const alreadyExists = existsResponse.ok;
    if (alreadyExists) {
      const confirmed = await askConfirm();
      if (!confirmed) return;
    }

    if (analysisEventSourceRef.current) {
      analysisEventSourceRef.current.close();
      analysisEventSourceRef.current = null;
    }

    setAnalysisProgress('Starting...');
    try {
      const analyzeResponse = await fetch(`/api/session/${sessionId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: alreadyExists }),
      });
      if (!analyzeResponse.ok) {
        setAnalysisProgress('Error: Failed to start analysis');
        return;
      }
      const responseData = await analyzeResponse.json();
      setTotalTasks(responseData.total_tasks ?? null);
      subagentTotalRef.current = 0;
    } catch {
      setAnalysisProgress('Error: Failed to start analysis');
      return;
    }

    const eventSource = new EventSource(`/api/session/${sessionId}/analysis/stream`);
    analysisEventSourceRef.current = eventSource;
    let notStartedCount = 0;
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setAnalysisProgress(data.status);
      if (data.status === 'Not started') {
        notStartedCount += 1;
      } else {
        notStartedCount = 0;
      }

      if (notStartedCount >= 20) {
        setAnalysisProgress('Error: Analysis did not start');
        eventSource.close();
        if (analysisEventSourceRef.current === eventSource) {
          analysisEventSourceRef.current = null;
        }
        return;
      }

      if (data.status === 'Completed') {
        fetch(`/api/session/${sessionId}/analysis`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => {
            if (data && Array.isArray(data.frames)) {
              setAnalysis(data);
            } else {
              setAnalysis(null);
              setAnalysisProgress('Error: Invalid analysis response');
            }
          });
        eventSource.close();
        if (analysisEventSourceRef.current === eventSource) {
          analysisEventSourceRef.current = null;
        }
      } else if (data.status.startsWith('Error')) {
        eventSource.close();
        if (analysisEventSourceRef.current === eventSource) {
          analysisEventSourceRef.current = null;
        }
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
      if (analysisEventSourceRef.current === eventSource) {
        analysisEventSourceRef.current = null;
      }
    };
  };

  const parseTaskStep = (status: string): { current: number; label: string } | null => {
    const subMatch = status.match(/sub-agent\s+(\d+)\/(\d+)/i);
    if (subMatch) {
      subagentTotalRef.current = parseInt(subMatch[2]);
      return { current: parseInt(subMatch[1]), label: 'analysing sub-agent' };
    }
    const groupMatch = status.match(/sub-agent groups?\s+(\d+)\/\d+/i);
    if (groupMatch) {
      return { current: subagentTotalRef.current + parseInt(groupMatch[1]), label: 'analysing sub-agent groups' };
    }
    if (/finaliz/i.test(status)) {
      return { current: totalTasks ?? 0, label: 'finalizing' };
    }
    return null;
  };

  return {
    analysisProgress,
    totalTasks,
    parseTaskStep,
    setAnalysisProgress,
    triggerAnalysis,
    showConfirmOverride,
    handleConfirmOverride,
    handleCancelOverride,
  };
};
