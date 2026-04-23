import { beforeEach, describe, expect, it } from 'vitest';
import { getSessionIdFromUrl, updateUrlForSession } from './url';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('getSessionIdFromUrl', () => {
  it('returns null when no session param is present', () => {
    expect(getSessionIdFromUrl()).toBeNull();
  });

  it('returns the session id when the query parameter is set', () => {
    window.history.replaceState(null, '', '/?session=abc-123');
    expect(getSessionIdFromUrl()).toBe('abc-123');
  });

  it('returns null for an empty session parameter', () => {
    window.history.replaceState(null, '', '/?session=');
    expect(getSessionIdFromUrl()).toBeNull();
  });

  it('returns null for a whitespace-only session parameter', () => {
    window.history.replaceState(null, '', '/?session=%20%20');
    expect(getSessionIdFromUrl()).toBeNull();
  });
});

describe('updateUrlForSession', () => {
  it('appends the session id as a query parameter', () => {
    updateUrlForSession('abc');
    expect(new URL(window.location.href).searchParams.get('session')).toBe('abc');
  });

  it('removes the session parameter when given null', () => {
    window.history.replaceState(null, '', '/?session=abc');
    updateUrlForSession(null);
    expect(new URL(window.location.href).searchParams.get('session')).toBeNull();
  });

  it('preserves other query parameters', () => {
    window.history.replaceState(null, '', '/?foo=bar');
    updateUrlForSession('xyz');
    const url = new URL(window.location.href);
    expect(url.searchParams.get('foo')).toBe('bar');
    expect(url.searchParams.get('session')).toBe('xyz');
  });

  it('supports replace mode without pushing a new history entry', () => {
    const before = window.history.length;
    updateUrlForSession('abc', 'replace');
    expect(window.history.length).toBe(before);
    expect(new URL(window.location.href).searchParams.get('session')).toBe('abc');
  });
});
