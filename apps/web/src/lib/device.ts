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
