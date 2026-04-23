import React from 'react';
import { ChevronDown, ChevronRight, EyeOff, Search, Terminal, Trash2 } from 'lucide-react';
import { ProjectGroup, Session } from '../types';
import { compactProjectPath, trimText } from '../utils/text';
import { formatSessionDateTime, getSessionDisplayTitle } from '../utils/format';

interface Props {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onLogoClick: () => void;
  recentSessions: Session[];
  projects: ProjectGroup[];
  expandedProjects: Record<string, boolean>;
  setExpandedProjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string, projectId?: string) => void;
  onRemoveRecentSession: (sessionId: string) => void;
  onHideSession: (session: Session) => void;
}

export const Sidebar = ({
  searchQuery,
  onSearchChange,
  onLogoClick,
  recentSessions,
  projects,
  expandedProjects,
  setExpandedProjects,
  selectedSessionId,
  onSelectSession,
  onRemoveRecentSession,
  onHideSession,
}: Props) => (
  <aside className="w-80 border-r border-gray-100 flex flex-col bg-gray-50/50">
    <div className="p-6 border-b border-gray-100 bg-white">
      <button onClick={onLogoClick} className="flex items-center gap-3 mb-6">
        <div className="bg-blue-600 p-2 rounded-lg shadow-sm shadow-blue-200">
          <Terminal className="text-white" size={20} />
        </div>
        <h1 className="font-bold text-lg tracking-tight">Claude Inspect</h1>
      </button>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
        <input
          className="w-full pl-10 pr-4 py-2 bg-gray-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-500"
          placeholder="Search projects or sessions..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <div className="px-3 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Recent Sessions</div>
        <div className="space-y-1">
          {recentSessions.map(s => (
            <div key={`recent-${s.id}`} className="group">
              <button
                onClick={() => onSelectSession(s.id)}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-200 ${
                  selectedSessionId === s.id
                    ? 'bg-white shadow-sm border border-gray-100'
                    : 'hover:bg-white/50 border border-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className={`text-sm font-medium min-w-0 ${selectedSessionId === s.id ? 'text-blue-600' : 'text-gray-700'}`}>
                    {trimText(getSessionDisplayTitle(s), 25)}
                  </div>
                  <button
                    type="button"
                    title="remove recent"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRecentSession(s.id);
                    }}
                    className="p-1 -mr-1 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="text-[11px] text-gray-400 font-mono break-all">{s.id}</div>
                <div className="text-[10px] text-gray-400">{formatSessionDateTime(s.mtime)}</div>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="px-3 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Projects</div>
        <div className="space-y-1">
          {projects.map(project => (
            <div key={project.id} className="rounded-xl border border-transparent hover:border-gray-100">
              <button
                onClick={() => setExpandedProjects(prev => ({ ...prev, [project.id]: !prev[project.id] }))}
                className="w-full text-left px-3 py-2 rounded-xl flex items-center gap-2 min-w-0 hover:bg-white/60 transition-colors"
              >
                {expandedProjects[project.id] ? (
                  <ChevronDown size={14} className="text-gray-500 shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-gray-500 shrink-0" />
                )}
                <span
                  className="text-sm font-semibold text-gray-700 block flex-1 min-w-0 overflow-hidden whitespace-nowrap"
                  title={project.name}
                >
                  {compactProjectPath(project.name, 34)}
                </span>
              </button>
              {expandedProjects[project.id] && (
                <div className="pl-6 pr-2 pb-2">
                  <div className="border-t border-gray-200 my-1"></div>
                  <div className="space-y-1">
                    {project.sessions.map(session => (
                      <div key={`${project.id}-${session.id}`} className="group">
                        <button
                          onClick={() => onSelectSession(session.id, project.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
                            selectedSessionId === session.id
                              ? 'bg-white border border-gray-100 shadow-sm'
                              : 'hover:bg-white/60 border border-transparent'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className={`text-sm font-medium min-w-0 ${selectedSessionId === session.id ? 'text-blue-600' : 'text-gray-700'} truncate`}>
                              {getSessionDisplayTitle(session)}
                            </div>
                            <button
                              type="button"
                              title="hide"
                              onClick={(e) => {
                                e.stopPropagation();
                                onHideSession(session);
                              }}
                              className="p-1 -mr-1 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                            >
                              <EyeOff size={14} />
                            </button>
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono break-all">{session.id}</div>
                          <div className="text-[10px] text-gray-400">{formatSessionDateTime(session.mtime)}</div>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  </aside>
);
