export const trimText = (text: string, limit: number, fromLeft = false): string => {
  if (!text || text.length <= limit) return text;
  if (fromLeft) return '...' + text.slice(-(limit - 3));
  return text.slice(0, limit - 3) + '...';
};

export const compactProjectPath = (projectPath: string, limit: number): string => {
  if (!projectPath) return '';
  const normalized = projectPath.replace(/\/+$/, '');
  if (normalized.length <= limit) return normalized;

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return trimText(normalized, limit, true);

  let tail = parts[parts.length - 1];
  if (tail.length + 4 > limit) {
    return trimText(tail, limit, true);
  }

  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = `${parts[i]}/${tail}`;
    if (candidate.length + 4 > limit) break;
    tail = candidate;
  }

  return `.../${tail}`;
};

export const compactProjectPathTail = (projectPath: string, segmentCount = 2): string => {
  if (!projectPath) return '';
  const normalized = projectPath.replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return normalized;
  if (parts.length <= segmentCount) return normalized;
  return `.../${parts.slice(-segmentCount).join('/')}`;
};

export const getBasename = (path: string): string => {
  if (!path) return '';
  return path.split('/').pop() || path;
};
