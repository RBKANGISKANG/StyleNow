'use client';
/**
 * A friend's invite link (?ref=REF-XXXX on any page) is remembered on this
 * device, so the first booking can credit the friend who sent it.
 */
import { useEffect } from 'react';

export const REF_KEY = 'sn-ref';

export function RefCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref && /^REF-[A-Z0-9]{4}$/i.test(ref)) window.localStorage.setItem(REF_KEY, ref.toUpperCase());
    } catch {
      // storage blocked — the code can still be typed at checkout
    }
  }, []);
  return null;
}
