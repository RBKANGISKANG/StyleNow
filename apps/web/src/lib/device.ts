'use client';
/** Anonymous device identity — stands in for the account until auth ships. */
export function deviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem('sn-device');
  if (!id) {
    id = `dev-${crypto.randomUUID()}`;
    localStorage.setItem('sn-device', id);
  }
  return id;
}

export function newIdempotencyKey(): string {
  return `idem-${crypto.randomUUID()}`;
}

/** After login: this browser takes on the account's device id, so bookings follow the person. */
export function adoptDeviceId(id: string): void {
  if (typeof window === 'undefined' || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) return;
  localStorage.setItem('sn-device', id);
}

/**
 * Every call to our own /api carries this browser's device id in a header,
 * so the server can tell a salon owner's own browser from anyone else's.
 * (Query-string device ids are only used for customer data the device owns.)
 */
if (typeof window !== 'undefined' && !(window as { __snFetch?: boolean }).__snFetch) {
  (window as { __snFetch?: boolean }).__snFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
    if (sameOrigin && url.includes('/api/')) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has('x-sn-device')) headers.set('x-sn-device', deviceId());
      return orig(input, { ...init, headers, credentials: init?.credentials ?? 'same-origin' });
    }
    return orig(input, init);
  };
}
