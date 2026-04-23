import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  Clock,
  Copy,
  Cpu,
  FileText,
  Folder,
  History,
  Info,
} from 'lucide-react';
import { Analysis, Session } from '../types';
import { formatSessionDateTime, getSessionDisplayTitle } from '../utils/format';
import { compactProjectPathTail } from '../utils/text';
import { EventCounts } from '../hooks/useSessionData';

interface Props {
  selectedSession: Session | null;
  selectedSessionId: string;
  eventCounts: EventCounts;
  analysis: Analysis | null;
  analysisProgress: string | null;
  totalTasks: number | null;
  parseTaskStep: (status: string) => { current: number; label: string } | null;
  sessionFilesStatus: string | null;
  onCreateSessionFiles: () => void;
  onTriggerAnalysis: () => void;
}

export const SessionHeader = ({
  selectedSession,
  selectedSessionId,
  eventCounts,
  analysis,
  analysisProgress,
  totalTasks,
  parseTaskStep,
  sessionFilesStatus,
  onCreateSessionFiles,
  onTriggerAnalysis,
}: Props) => {
  const [showSessionMeta, setShowSessionMeta] = useState(false);
  const [projectPathCopyState, setProjectPathCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  useEffect(() => {
    setShowSessionMeta(false);
    setProjectPathCopyState('idle');
    setShowErrorDetail(false);
  }, [selectedSessionId]);

  useEffect(() => {
    if (projectPathCopyState === 'idle') return;
    const timeoutId = window.setTimeout(() => {
      setProjectPathCopyState('idle');
    }, 1500);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [projectPathCopyState]);

  const selectedProjectPath = selectedSession?.project_name || '';
  const selectedProjectPathShort = compactProjectPathTail(selectedProjectPath, 2);

  const copyProjectPath = async () => {
    if (!selectedProjectPath) return;
    try {
      await navigator.clipboard.writeText(selectedProjectPath);
      setProjectPathCopyState('copied');
    } catch (error) {
      console.error('Failed to copy project path', error);
      setProjectPathCopyState('error');
    }
  };

  return (
    <header className="py-2 border-b border-gray-100 px-8 flex flex-col gap-1.5 shrink-0 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="flex items-center justify-between gap-4 min-w-0">
        <div className="min-w-0 flex items-center gap-2 text-sm leading-none">
          {selectedSession?.mtime ? (
            <>
              <Clock size={14} className="text-gray-400 shrink-0" />
              <span className="inline-flex items-center text-xs text-gray-500 whitespace-nowrap leading-none">
                {formatSessionDateTime(selectedSession.mtime)}
              </span>
            </>
          ) : null}
          <History size={14} className="text-gray-400 shrink-0" />
          <span className="relative -top-px inline-flex items-center font-semibold text-gray-900 truncate leading-none">
            Session: {getSessionDisplayTitle(selectedSession) || selectedSessionId}
          </span>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowSessionMeta(prev => !prev)}
              className="inline-flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Session metadata"
            >
              <Info size={14} />
            </button>
            {showSessionMeta ? (
              <div className="absolute left-0 top-full mt-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-500 shadow-md whitespace-nowrap z-20">
                {[`session id: ${selectedSessionId}`, selectedSession?.slug ? `slug: ${selectedSession.slug}` : ''].filter(Boolean).join(' · ')}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
            <Cpu size={14} />
            {eventCounts.withSubagents.toLocaleString()} Events
            <span className="text-gray-500">({eventCounts.withoutSubagents.toLocaleString()} main)</span>
          </div>
          {analysisProgress ? (
            analysisProgress.startsWith('Error') ? (
              <div className="relative flex items-center gap-1.5 text-xs text-red-500">
                <AlertCircle size={14} className="shrink-0" />
                <button
                  type="button"
                  onClick={() => setShowErrorDetail(v => !v)}
                  className="font-semibold hover:underline"
                >
                  Analysis failed
                </button>
                {showErrorDetail && (
                  <div className="absolute right-0 top-full mt-1 z-20 w-[480px] rounded-lg border border-red-100 bg-white shadow-xl p-3 text-[11px] font-mono text-red-700 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                    {analysisProgress.replace(/^Error:\s*/, '')}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 animate-pulse">
                <Clock size={14} />
                {(() => {
                  const step = totalTasks ? parseTaskStep(analysisProgress) : null;
                  return step ? (
                    <span>
                      Tasks&nbsp;
                      <span className="font-mono">{step.current}&nbsp;/&nbsp;{totalTasks}</span>
                      <span className="font-normal text-blue-400"> ({step.label})</span>
                    </span>
                  ) : <span>{analysisProgress}</span>;
                })()}
              </div>
            )
          ) : (
            <>
              <button
                onClick={onCreateSessionFiles}
                className="flex items-center gap-2 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95"
              >
                <FileText size={14} /> Create Session Files
              </button>
              <button
                onClick={onTriggerAnalysis}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-md shadow-blue-100 active:scale-95"
              >
                <Activity size={14} /> {analysis ? 'Re-Analyze Session' : 'Analyze Session'}
              </button>
            </>
          )}
        </div>
      </div>
      {sessionFilesStatus ? (
        <div className="text-xs text-gray-500">{sessionFilesStatus}</div>
      ) : null}
      <div className="flex items-center gap-2 min-w-0 text-sm text-gray-700" title={selectedProjectPath}>
        <Folder size={15} className="text-gray-400 shrink-0" />
        <span className="truncate bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">{selectedProjectPathShort}</span>
        <button
          type="button"
          onClick={copyProjectPath}
          className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
          title={projectPathCopyState === 'copied' ? 'Copied' : projectPathCopyState === 'error' ? 'Copy failed' : 'Copy full path'}
          aria-label="Copy full project path"
        >
          {projectPathCopyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </header>
  );
};
