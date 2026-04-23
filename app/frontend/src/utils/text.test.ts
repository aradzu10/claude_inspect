import { describe, expect, it } from 'vitest';
import { trimText, compactProjectPath, compactProjectPathTail, getBasename } from './text';

describe('trimText', () => {
  it('returns the text unchanged when under the limit', () => {
    expect(trimText('hello', 10)).toBe('hello');
  });

  it('returns the text unchanged when exactly at the limit', () => {
    expect(trimText('hello', 5)).toBe('hello');
  });

  it('truncates from the right by default', () => {
    expect(trimText('hello world', 8)).toBe('hello...');
  });

  it('truncates from the left when fromLeft is true', () => {
    expect(trimText('hello world', 8, true)).toBe('...world');
  });

  it('returns empty string unchanged', () => {
    expect(trimText('', 5)).toBe('');
  });

  it('treats falsy text as returnable', () => {
    expect(trimText(undefined as any, 5)).toBeUndefined();
  });
});

describe('compactProjectPath', () => {
  it('returns the path unchanged when under the limit', () => {
    expect(compactProjectPath('/home/user', 20)).toBe('/home/user');
  });

  it('strips trailing slashes before measuring', () => {
    expect(compactProjectPath('/home/user/', 20)).toBe('/home/user');
  });

  it('collapses leading segments and prefixes with ...', () => {
    const result = compactProjectPath('/home/aradz/projects/repos/claude_inspect', 25);
    expect(result.startsWith('.../')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(25);
    expect(result.endsWith('claude_inspect')).toBe(true);
  });

  it('falls back to trimmed tail when the last segment alone exceeds the limit', () => {
    const result = compactProjectPath('/a/really_really_long_segment_name', 15);
    expect(result.startsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(15);
  });

  it('returns empty string for empty input', () => {
    expect(compactProjectPath('', 10)).toBe('');
  });
});

describe('compactProjectPathTail', () => {
  it('returns the path unchanged when it has fewer segments than requested', () => {
    expect(compactProjectPathTail('/home/user', 3)).toBe('/home/user');
  });

  it('keeps only the last N segments with a leading ...', () => {
    expect(compactProjectPathTail('/a/b/c/d/e', 2)).toBe('.../d/e');
  });

  it('strips trailing slashes', () => {
    expect(compactProjectPathTail('/a/b/c/d/e/', 2)).toBe('.../d/e');
  });

  it('returns empty string for empty input', () => {
    expect(compactProjectPathTail('', 2)).toBe('');
  });
});

describe('getBasename', () => {
  it('returns the last segment of a path', () => {
    expect(getBasename('/a/b/c.txt')).toBe('c.txt');
  });

  it('returns the input when there is no separator', () => {
    expect(getBasename('file.txt')).toBe('file.txt');
  });

  it('returns empty string for empty input', () => {
    expect(getBasename('')).toBe('');
  });
});
