import React, { createContext, useContext, MutableRefObject } from 'react';
import { Event } from '../types';

export interface SessionContextValue {
  events: Event[];
  selectedSessionId: string | null;
  subagentLogs: Record<string, Event[]>;
  fetchSubagentLogs: (agentId: string) => void;
  setActiveSubagentId: (id: string | null) => void;
  mainContentScrollRef: MutableRefObject<HTMLDivElement | null>;
  messageRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  updateFrameSuggestion: (frameIndex: number, suggestion: string) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = ({
  value,
  children,
}: {
  value: SessionContextValue;
  children: React.ReactNode;
}) => (
  <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
);

export const useSession = (): SessionContextValue => {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return ctx;
};
