'use client';
/**
 * Registers the offline service worker once the app has fully started.
 * Registering it during page load (inline in <head>) let a newly activated
 * worker take control while React was still hydrating, which React 19
 * reports as a hydration error. After hydration it is harmless.
 */
import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    const t = window.setTimeout(() => {
      navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {});
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
