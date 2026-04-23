import { ProjectGroup } from '../types';

export const buildProjectGroups = (
  projects: ProjectGroup[],
  hiddenSessionSet: Set<string>,
  includeHidden: boolean,
): ProjectGroup[] => {
  const filtered = projects
    .map(project => {
      const sessions = project.sessions.filter(session =>
        includeHidden ? hiddenSessionSet.has(session.id) : !hiddenSessionSet.has(session.id)
      );
      const latestMtime = sessions.reduce((latest, session) => {
        const mtime = session.mtime ?? 0;
        return mtime > latest ? mtime : latest;
      }, 0);
      return {
        ...project,
        sessions,
        latest_mtime: latestMtime,
      };
    })
    .filter(project => project.sessions.length > 0);

  filtered.sort((a, b) => {
    const byTime = (b.latest_mtime ?? 0) - (a.latest_mtime ?? 0);
    if (byTime !== 0) return byTime;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return filtered;
};
