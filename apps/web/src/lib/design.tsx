'use client';
/**
 * Which visual treatment the app wears.
 *
 * `classic` is what the app has always shipped. `studio` is the design pass:
 * a real type scale with a top to it, drawn icons instead of emoji, deeper
 * cards, and the shop page recomposed around a cover with the identity card
 * lifted onto it.
 *
 * The choice rides on `<html data-design>` so the whole stylesheet can answer
 * to it, and lives in localStorage so it survives a reload. It starts as
 * `classic` on the server and on the first client render — reading storage
 * during render would make the markup disagree with itself and hydration would
 * throw the difference away — then the effect below applies the stored answer.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Design = 'classic' | 'studio';

const KEY = 'stylenow.design';

interface DesignCtx {
  design: Design;
  setDesign: (d: Design) => void;
  /** True once the stored preference has been read, for anything that must not flash. */
  ready: boolean;
}

const Ctx = createContext<DesignCtx>({ design: 'classic', setDesign: () => {}, ready: false });

export function DesignProvider({ children }: { children: ReactNode }) {
  const [design, setState] = useState<Design>('classic');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      // private mode, or storage blocked — classic is a fine answer
    }
    if (stored === 'studio' || stored === 'classic') setState(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.design = design;
  }, [design]);

  const setDesign = useCallback((d: Design) => {
    setState(d);
    try {
      localStorage.setItem(KEY, d);
    } catch {
      // the choice still applies for this session
    }
  }, []);

  return <Ctx.Provider value={{ design, setDesign, ready }}>{children}</Ctx.Provider>;
}

export function useDesign(): DesignCtx {
  return useContext(Ctx);
}

/** Shorthand for the many places that only branch on "is this the new look". */
export function useStudio(): boolean {
  return useContext(Ctx).design === 'studio';
}
