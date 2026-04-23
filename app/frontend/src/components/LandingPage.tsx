import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ProjectGroup, Session } from '../types';
import { compactProjectPath } from '../utils/text';
import { formatSessionDateTime, getSessionDisplayTitle } from '../utils/format';

interface Props {
  showHiddenOnMain: boolean;
  setShowHiddenOnMain: React.Dispatch<React.SetStateAction<boolean>>;
  visibleProjects: ProjectGroup[];
  hiddenProjects: ProjectGroup[];
  onSelectSession: (sessionId: string, projectId: string) => void;
  onHideSession: (session: Session) => void;
  onUnhideSession: (sessionId: string) => void;
}

export const LandingPage = ({
  showHiddenOnMain,
  setShowHiddenOnMain,
  visibleProjects,
  hiddenProjects,
  onSelectSession,
  onHideSession,
  onUnhideSession,
}: Props) => (
  <div className="flex-1 overflow-y-scroll px-8 py-10 bg-gray-50/30 [scrollbar-gutter:stable]">
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {showHiddenOnMain ? 'Hidden Sessions' : 'Projects'}
          </h2>
          <p className="text-sm text-gray-500">
            {showHiddenOnMain
              ? 'Showing hidden sessions grouped by project.'
              : 'Select a session from any project to begin inspection.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHiddenOnMain(prev => !prev)}
          className="mt-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 rounded-md hover:bg-gray-100 transition-colors"
        >
          {showHiddenOnMain ? 'Show regular' : 'Show hidden'}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(showHiddenOnMain ? hiddenProjects : visibleProjects).map(project => (
          <div key={`landing-${project.id}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div
              className="text-sm font-semibold text-gray-900 mb-3 block min-w-0 overflow-hidden whitespace-nowrap"
              title={project.name}
            >
              {compactProjectPath(project.name, 64)}
            </div>
            <div className="border-t border-gray-200 mb-2"></div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {project.sessions.map(session => (
                <div key={`landing-session-${project.id}-${session.id}`} className="relative group">
                  <button
                    onClick={() => onSelectSession(session.id, project.id)}
                    className="w-full text-left px-3 py-2 pr-9 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100"
                  >
                    <div className="text-sm font-medium text-gray-700 truncate">{getSessionDisplayTitle(session)}</div>
                    <div className="text-[10px] text-gray-400 font-mono truncate">{session.id}</div>
                    <div className="text-[10px] text-gray-400 flex items-center gap-2">
                      <span>{formatSessionDateTime(session.mtime)}</span>
                      <span className="font-mono">• {session.size_mb.toFixed(1)} MB</span>
                    </div>
                  </button>
                  {!showHiddenOnMain && (
                    <button
                      type="button"
                      title="hide"
                      onClick={(e) => {
                        e.stopPropagation();
                        onHideSession(session);
                      }}
                      className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <EyeOff size={14} />
                    </button>
                  )}
                  {showHiddenOnMain && (
                    <button
                      type="button"
                      title="unhide"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnhideSession(session.id);
                      }}
                      className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);
