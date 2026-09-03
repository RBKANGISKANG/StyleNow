'use client';
/**
 * Focus discipline for dialogs.
 *
 * A dialog that opens without taking focus strands a keyboard user on the
 * page behind it; one that closes without giving focus back drops them at
 * the top of the document. This hook does both halves: on mount it moves
 * focus into the dialog container (which needs tabIndex={-1}); on unmount
 * it returns focus to whatever had it — usually the button that opened
 * the dialog. Escape handling and scroll locking stay with each dialog;
 * this is only about where the keyboard IS.
 */
import { useEffect, useRef } from 'react';

export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      // the opener may have unmounted (e.g. a row that disappeared) — then
      // focus simply stays where the browser puts it
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  return ref;
}
