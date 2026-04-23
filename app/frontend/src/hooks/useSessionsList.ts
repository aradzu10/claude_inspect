import { useEffect, useState } from 'react';
import { ProjectGroup, Session, SessionsResponse } from '../types';

export const useSessionsList = (searchQuery: string) => {
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const query = searchQuery.trim();
    const url = query ? `/api/sessions?q=${encodeURIComponent(query)}` : '/api/sessions';
    fetch(url)
      .then(res => res.json())
      .then((data: SessionsResponse) => {
        setRecentSessions(Array.isArray(data?.recent_sessions) ? data.recent_sessions : []);
        const nextProjects = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(nextProjects);
        setExpandedProjects(prev => {
          const next = { ...prev };
          for (const project of nextProjects) {
            if (next[project.id] === undefined) {
              next[project.id] = false;
            }
          }
          return next;
        });
      });
  }, [searchQuery]);

  return {
    recentSessions,
    setRecentSessions,
    projects,
    setProjects,
    expandedProjects,
    setExpandedProjects,
  };
};
