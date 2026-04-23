import { describe, expect, it } from 'vitest';
import { buildProjectGroups } from './sessions';
import { ProjectGroup, Session } from '../types';

const mkSession = (id: string, mtime = 0): Session => ({
  id,
  title: id,
  path: `/p/${id}`,
  size_mb: 1,
  mtime,
});

const mkProject = (id: string, sessions: Session[]): ProjectGroup => ({
  id,
  name: id,
  short_name: id,
  sessions,
});

describe('buildProjectGroups', () => {
  it('returns only visible sessions when includeHidden is false', () => {
    const projects = [mkProject('p1', [mkSession('a'), mkSession('b'), mkSession('c')])];
    const result = buildProjectGroups(projects, new Set(['b']), false);
    expect(result).toHaveLength(1);
    expect(result[0].sessions.map(s => s.id)).toEqual(['a', 'c']);
  });

  it('returns only hidden sessions when includeHidden is true', () => {
    const projects = [mkProject('p1', [mkSession('a'), mkSession('b'), mkSession('c')])];
    const result = buildProjectGroups(projects, new Set(['b']), true);
    expect(result).toHaveLength(1);
    expect(result[0].sessions.map(s => s.id)).toEqual(['b']);
  });

  it('drops projects with no sessions after filtering', () => {
    const projects = [
      mkProject('empty', [mkSession('only-hidden')]),
      mkProject('full', [mkSession('v')]),
    ];
    const result = buildProjectGroups(projects, new Set(['only-hidden']), false);
    expect(result.map(p => p.id)).toEqual(['full']);
  });

  it('computes latest_mtime from visible sessions', () => {
    const projects = [mkProject('p1', [mkSession('a', 10), mkSession('b', 50), mkSession('c', 30)])];
    const result = buildProjectGroups(projects, new Set(), false);
    expect(result[0].latest_mtime).toBe(50);
  });

  it('sorts projects by latest_mtime descending, then by name', () => {
    const projects = [
      mkProject('alpha-old', [mkSession('x', 10)]),
      mkProject('beta-new', [mkSession('y', 100)]),
      mkProject('zulu-old', [mkSession('z', 10)]),
    ];
    const result = buildProjectGroups(projects, new Set(), false);
    expect(result.map(p => p.id)).toEqual(['beta-new', 'alpha-old', 'zulu-old']);
  });

  it('does not mutate the input projects array', () => {
    const sessions = [mkSession('a'), mkSession('b')];
    const projects = [mkProject('p1', sessions)];
    const before = JSON.stringify(projects);
    buildProjectGroups(projects, new Set(['a']), false);
    expect(JSON.stringify(projects)).toBe(before);
  });
});
