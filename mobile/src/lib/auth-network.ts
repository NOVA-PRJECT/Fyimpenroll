/** Bound the whole operation, including consuming the response body. */
export async function withAuthDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms = 12000, external?: AbortSignal | null): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (external?.aborted) abort();
  external?.addEventListener('abort', abort);
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await run(controller.signal); }
  finally { clearTimeout(timer); external?.removeEventListener('abort', abort); }
}

/** Keep SDK session cleanup/events, while the backend owns global revocation. */
export function createAuthFetch(providerUrl: string, backendUrl: string, nativeFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const isGlobalLogout = url.origin === new URL(providerUrl).origin && url.pathname === '/auth/v1/logout'
      && (!url.searchParams.has('scope') || url.searchParams.get('scope') === 'global');
    return withAuthDeadline(async signal => {
      if (!isGlobalLogout) return nativeFetch(input, { ...init, signal });
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const response = await nativeFetch(`${backendUrl.replace(/\/$/, '')}/api/auth/logout`, {
        method: 'POST', headers: { Authorization: headers.get('Authorization') || '' }, signal,
      });
      const result = await response.json();
      if (!response.ok || !result.revoked) {
        return new Response(JSON.stringify({ msg: 'Signed out on this device; server revocation could not be confirmed.' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    }, 12000, init?.signal || (input instanceof Request ? input.signal : undefined));
  };
}

export class ProfileRequests<T> {
  private pending = new Map<string, Promise<T>>();
  load(token: string, fetchProfile: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(token);
    if (existing) return existing;
    const request = fetchProfile().finally(() => { if (this.pending.get(token) === request) this.pending.delete(token); });
    this.pending.set(token, request);
    return request;
  }
  clear() { this.pending.clear(); }
}
