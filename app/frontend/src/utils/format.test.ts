import { describe, expect, it } from 'vitest';
import { formatSessionDateTime, getSessionDisplayTitle } from './format';
import { Session } from '../types';

describe('formatSessionDateTime', () => {
  it('formats a unix timestamp as dd/mm/yy hh:mm', () => {
    const fixed = new Date(2024, 0, 5, 14, 7).getTime() / 1000;
    expect(formatSessionDateTime(fixed)).toBe('05/01/24 14:07');
  });

  it('zero-pads months and days', () => {
    const fixed = new Date(2024, 8, 9, 3, 4).getTime() / 1000;
    expect(formatSessionDateTime(fixed)).toBe('09/09/24 03:04');
  });

  it('returns an empty string when mtime is undefined', () => {
    expect(formatSessionDateTime(undefined)).toBe('');
  });

  it('returns an empty string when mtime is zero', () => {
    expect(formatSessionDateTime(0)).toBe('');
  });
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  title: 'default-title',
  path: '/p',
  size_mb: 1,
  ...overrides,
});

describe('getSessionDisplayTitle', () => {
  it('prefers name over other fields', () => {
    const s = makeSession({ name: 'Nice Name', slug: 'slug', title: 'title' });
    expect(getSessionDisplayTitle(s)).toBe('Nice Name');
  });

  it('falls back to slug when name is missing', () => {
    const s = makeSession({ slug: 'slug', title: 'title' });
    expect(getSessionDisplayTitle(s)).toBe('slug');
  });

  it('falls back to title when name and slug are missing', () => {
    const s = makeSession({ title: 'title' });
    expect(getSessionDisplayTitle(s)).toBe('title');
  });

  it('falls back to id when title is missing', () => {
    const s = makeSession({ title: '' });
    expect(getSessionDisplayTitle(s)).toBe('sess-1');
  });

  it('returns "Unknown" when the session is null', () => {
    expect(getSessionDisplayTitle(null)).toBe('Unknown');
  });

  it('returns "Unknown" when the session is undefined', () => {
    expect(getSessionDisplayTitle(undefined)).toBe('Unknown');
  });
});
