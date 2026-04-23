import React, { useMemo, useRef, useState } from 'react';
import { Analysis, Session } from './types';
import { buildProjectGroups } from './utils/sessions';
import { getSessionDisplayTitle } from './utils/format';
import { useHiddenSessions } from './hooks/useHiddenSessions';
import { useHideToast } from './hooks/useHideToast';
import { useSessionsList } from './hooks/useSessionsList';
import { useSessionData } from './hooks/useSessionData';
import { useAnalysisStream } from './hooks/useAnalysisStream';
import { useSubagentLogs } from './hooks/useSubagentLogs';
import { useSessionFiles } from './hooks/useSessionFiles';
import { useSelectedSession } from './hooks/useSelectedSession';
import { SessionProvider } from './context/SessionContext';
import { Sidebar } from './components/Sidebar';
import { LandingPage } from './components/LandingPage';
import { SessionHeader } from './components/SessionHeader';
import { SessionView } from './components/SessionView';
import { SubagentModal } from './components/SubagentModal';
import { HideToast } from './components/HideToast';
import { ConfirmDialog } from './components/ConfirmDialog';

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showHiddenOnMain, setShowHiddenOnMain] = useState(false);

  const { hiddenSessionIds, setHiddenSessionIds } = useHiddenSessions();
  const { hideToast, setHideToast, hideToastProgress } = useHideToast();
  const {
    recentSessions, setRecentSessions,
    projects,
    expandedProjects, setExpandedProjects,
  } = useSessionsList(searchQuery);

  const {
    selectedSessionId,
    selectSessionId,
    clearSelectedSession,
    activeSubagentId,
    setActiveSubagentId,
  } = useSelectedSession();

  const { events, eventCounts, loading, analysis, setAnalysis } = useSessionData(selectedSessionId);
  const {
    analysisProgress,
    totalTasks,
    parseTaskStep,
    triggerAnalysis,
    showConfirmOverride,
    handleConfirmOverride,
    handleCancelOverride,
  } = useAnalysisStream(selectedSessionId, setAnalysis);
  const { subagentLogs, fetchSubagentLogs } = useSubagentLogs(selectedSessionId);
  const { sessionFilesStatus, createSessionFilesOnly } = useSessionFiles(selectedSessionId);

  const mainContentScrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const hiddenSessionSet = useMemo(() => new Set(hiddenSessionIds), [hiddenSessionIds]);
  const visibleProjects = useMemo(() => buildProjectGroups(projects, hiddenSessionSet, false), [projects, hiddenSessionSet]);
  const hiddenProjects = useMemo(() => buildProjectGroups(projects, hiddenSessionSet, true), [projects, hiddenSessionSet]);
  const sidebarRecentSessions = useMemo(
    () => recentSessions.filter(session => !hiddenSessionSet.has(session.id)),
    [recentSessions, hiddenSessionSet],
  );

  const selectedSession: Session | null =
    recentSessions.find(s => s.id === selectedSessionId)
    || projects.flatMap(project => project.sessions).find(s => s.id === selectedSessionId)
    || null;

  const selectSession = (sessionId: string, projectId?: string) => {
    selectSessionId(sessionId);
    setRecentSessions(prev => {
      const allSessions = [...prev, ...projects.flatMap(project => project.sessions)];
      const selected = allSessions.find(session => session.id === sessionId);
      if (!selected) return prev;
      const deduped = [selected, ...prev.filter(session => session.id !== sessionId)];
      return deduped.slice(0, 20);
    });
    if (projectId) {
      setExpandedProjects(prev => ({ ...prev, [projectId]: true }));
    }
    fetch(`/api/session/${sessionId}/recent`, { method: 'POST' }).catch(() => null);
  };

  const removeRecentSession = (sessionId: string) => {
    setRecentSessions(prev => prev.filter(session => session.id !== sessionId));
    fetch(`/api/session/${sessionId}/recent/remove`, { method: 'POST' }).catch(() => null);
  };

  const hideSession = (session: Session) => {
    setHiddenSessionIds(prev => (prev.includes(session.id) ? prev : [...prev, session.id]));
    removeRecentSession(session.id);
    if (selectedSessionId === session.id) {
      clearSelectedSession();
    }
    setHideToast({ sessionId: session.id, label: getSessionDisplayTitle(session) });
  };

  const undoHide = () => {
    if (!hideToast) return;
    setHiddenSessionIds(prev => prev.filter(id => id !== hideToast.sessionId));
    setHideToast(null);
  };

  const unhideSession = (sessionId: string) => {
    setHiddenSessionIds(prev => prev.filter(id => id !== sessionId));
  };

  const updateFrameSuggestion = (frameIndex: number, newSuggestion: string) => {
    if (!analysis) return;
    const newAnalysis: Analysis = { ...analysis, frames: analysis.frames.map(f => ({ ...f })) };
    newAnalysis.frames[frameIndex].suggestion = newSuggestion;
    setAnalysis(newAnalysis);

    fetch(`/api/session/${selectedSessionId}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAnalysis),
    });
  };

  return (
    <SessionProvider
      value={{
        events,
        selectedSessionId,
        subagentLogs,
        fetchSubagentLogs,
        setActiveSubagentId,
        mainContentScrollRef,
        messageRefs,
        updateFrameSuggestion,
      }}
    >
      <div className="flex h-screen bg-white text-gray-900 font-sans antialiased">
        <Sidebar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onLogoClick={clearSelectedSession}
          recentSessions={sidebarRecentSessions}
          projects={visibleProjects}
          expandedProjects={expandedProjects}
          setExpandedProjects={setExpandedProjects}
          selectedSessionId={selectedSessionId}
          onSelectSession={selectSession}
          onRemoveRecentSession={removeRecentSession}
          onHideSession={hideSession}
        />

        <main className="flex-1 flex flex-col min-w-0 bg-white">
          {selectedSessionId ? (
            <>
              <SessionHeader
                selectedSession={selectedSession}
                selectedSessionId={selectedSessionId}
                eventCounts={eventCounts}
                analysis={analysis}
                analysisProgress={analysisProgress}
                totalTasks={totalTasks}
                parseTaskStep={parseTaskStep}
                sessionFilesStatus={sessionFilesStatus}
                onCreateSessionFiles={createSessionFilesOnly}
                onTriggerAnalysis={triggerAnalysis}
              />
              <SessionView
                events={events}
                analysis={analysis}
                loading={loading}
                selectedSessionId={selectedSessionId}
                mainContentScrollRef={mainContentScrollRef}
              />
            </>
          ) : (
            <LandingPage
              showHiddenOnMain={showHiddenOnMain}
              setShowHiddenOnMain={setShowHiddenOnMain}
              visibleProjects={visibleProjects}
              hiddenProjects={hiddenProjects}
              onSelectSession={selectSession}
              onHideSession={hideSession}
              onUnhideSession={unhideSession}
            />
          )}

          {selectedSessionId && activeSubagentId && (
            <SubagentModal
              agentId={activeSubagentId}
              onClose={() => setActiveSubagentId(null)}
            />
          )}

          {hideToast && (
            <HideToast
              label={hideToast.label}
              progress={hideToastProgress}
              onUndo={undoHide}
            />
          )}

          {showConfirmOverride && (
            <ConfirmDialog
              message="analysis.json already exists. Do you want to override it and re-run the analysis?"
              onConfirm={handleConfirmOverride}
              onCancel={handleCancelOverride}
            />
          )}
        </main>
      </div>
    </SessionProvider>
  );
}

export default App;
