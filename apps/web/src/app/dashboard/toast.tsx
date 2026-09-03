'use client';
/** The little "saved" flash every operator tab shows after a change. */
import { useEffect, useState } from 'react';

export function useToast() {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, setToast, toastEl: toast ? <div className="toast" role="status">{toast}</div> : null };
}
