export const getSessionIdFromUrl = (): string | null => {
  const id = new URL(window.location.href).searchParams.get('session');
  return id && id.trim() ? id : null;
};

export const updateUrlForSession = (
  sessionId: string | null,
  mode: 'push' | 'replace' = 'push',
): void => {
  const url = new URL(window.location.href);
  if (sessionId) {
    url.searchParams.set('session', sessionId);
  } else {
    url.searchParams.delete('session');
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (mode === 'replace') {
    window.history.replaceState(null, '', nextUrl);
  } else {
    window.history.pushState(null, '', nextUrl);
  }
};
