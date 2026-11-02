'use client';
/**
 * Which visual treatment the app wears.
 *
 * `studio` is the app's look. `classic` survives only as a comparison on the
 * /design page: flipping it there applies for the current session and is not
 * remembered, so every visit starts in studio. The choice rides on
 * `<html data-design>` so the whole stylesheet can answer to it.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Design = 'classic' | 'studio';

interface DesignCtx {
  design: Design;
  setDesign: (d: Design) => void;
  ready: boolean;
}

const Ctx = createContext<DesignCtx>({ design: 'studio', setDesign: () => {}, ready: true });

export function DesignProvider({ children }: { children: ReactNode }) {
  const [design, setState] = useState<Design>('studio');

  useEffect(() => {
    document.documentElement.dataset.design = design;
  }, [design]);

  const setDesign = useCallback((d: Design) => setState(d), []);

  return <Ctx.Provider value={{ design, setDesign, ready: true }}>{children}</Ctx.Provider>;
}

export function useDesign(): DesignCtx {
  return useContext(Ctx);
}

/** Shorthand for the many places that only branch on "is this the new look". */
export function useStudio(): boolean {
  return useContext(Ctx).design === 'studio';
}

export type ThemePref = 'light' | 'dark' | 'system';
const THEME_KEY = 'stylenow.theme';

/** Runs inline in <head> so the first paint is already in the right theme. */
export const THEME_BOOT = `try{var p=localStorage.getItem('${THEME_KEY}')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;

let themePref: ThemePref = 'system';
let themeLoaded = false;
const themeListeners = new Set<() => void>();

function readPref(): ThemePref {
  if (!themeLoaded && typeof window !== 'undefined') {
    themeLoaded = true;
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s === 'light' || s === 'dark' || s === 'system') themePref = s;
    } catch {
      // storage blocked — follow the device
    }
  }
  return themePref;
}

function applyTheme(): boolean {
  const d = themePref === 'dark' || (themePref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = d ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', d ? '#17121c' : '#f0566e');
  return d;
}

/** One theme setting shared by every control that shows it. */
export function useTheme(): { pref: ThemePref; dark: boolean; setPref: (p: ThemePref) => void } {
  const [pref, setLocal] = useState<ThemePref>('system');
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const sync = () => {
      setLocal(readPref());
      setDark(applyTheme());
    };
    sync();
    themeListeners.add(sync);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    return () => {
      themeListeners.delete(sync);
      mq.removeEventListener('change', sync);
    };
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    themePref = p;
    themeLoaded = true;
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      // still applies for this session
    }
    themeListeners.forEach((f) => f());
  }, []);

  return { pref, dark, setPref };
}
