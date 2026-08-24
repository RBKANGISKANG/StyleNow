'use client';
/**
 * Accounts & sessions, three transports like the rest of the app:
 *
 *  - supabase mode: real auth — email/password via supabase.auth.signUp
 *    (respects the project's email-confirmation setting) and OAuth via
 *    signInWithOAuth (Google / Apple / Facebook — the provider must be
 *    enabled in the Supabase dashboard; we surface a clear hint if not).
 *    The profile document lives in the `profiles` table (RLS: own row only).
 *
 *  - local / server-demo mode: accounts live in this browser's localStorage
 *    with a SHA-256'd password — good enough to demonstrate the full
 *    registration UX, clearly not a security boundary. Social buttons create
 *    a labelled demo session so the flow stays walkable.
 *
 * Collected profile data is the superset a marketplace actually needs; the
 * consents mirror the GDPR posture of the scaffold (terms required,
 * marketing & personalisation opt-in, export + delete self-service).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as sb from '@/lib/supabase-backend';

export interface Profile {
  name: string;
  email: string;
  phone: string;
  city: string;
  postalCode: string;
  birthday: string; // YYYY-MM-DD or ''
  preferredLanguage: 'de' | 'en';
  consents: {
    terms: boolean;
    marketing: boolean;
    personalisation: boolean;
  };
}

export interface SessionUser extends Profile {
  id: string;
  provider: 'email' | 'google' | 'apple' | 'facebook';
  demo: boolean;
}

export type AuthResult = { ok: true; needsEmailConfirm?: boolean } | { ok: false; error: string };

interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  register: (profile: Profile, password: string) => Promise<AuthResult>;
  login: (email: string, password: string) => Promise<AuthResult>;
  loginSocial: (provider: 'google' | 'apple' | 'facebook') => Promise<AuthResult>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  exportData: () => string;
  deleteAccount: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

const ACCOUNTS_KEY = 'sn-accounts';
const SESSION_KEY = 'sn-session';

interface StoredAccount extends Profile {
  id: string;
  passHash: string;
  provider: SessionUser['provider'];
}

/** GoTrue reports network failures as error objects, not exceptions. */
function isNetworkAuthError(e: { message?: string; status?: number } | null): boolean {
  if (!e) return false;
  return e.status === 0 || /fetch|network|timed? ?out|abort/i.test(e.message ?? '');
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readAccounts(): StoredAccount[] {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function writeAccounts(list: StoredAccount[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  } catch {
    // private mode
  }
}

export function emptyProfile(lang: 'de' | 'en'): Profile {
  return {
    name: '',
    email: '',
    phone: '',
    city: '',
    postalCode: '',
    birthday: '',
    preferredLanguage: lang,
    consents: { terms: false, marketing: false, personalisation: false },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  // restore session
  useEffect(() => {
    void (async () => {
      if (sb.isConfigured()) {
        try {
          const client = await sb.authClient();
          const { data } = await client.auth.getSession();
          if (data.session?.user) {
            setUser(await sb.loadSessionUser(data.session.user));
            setLoading(false);
            return;
          }
        } catch {
          // fall through to local session
        }
      }
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          const { email } = JSON.parse(raw);
          const acc = readAccounts().find((a) => a.email === email);
          if (acc) {
            const { passHash, ...rest } = acc;
            setUser({ ...rest, demo: true });
          }
        }
      } catch {
        // no session
      }
      setLoading(false);
    })();
  }, []);

  const register = useCallback(async (profile: Profile, password: string): Promise<AuthResult> => {
    const email = profile.email.trim().toLowerCase();
    if (sb.isConfigured()) {
      try {
        const client = await sb.authClient();
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { name: profile.name } },
        });
        if (error) {
          if (!isNetworkAuthError(error)) return { ok: false, error: error.message };
          throw error; // network — degrade to the demo path below
        }
        if (data.user) await sb.saveProfile(data.user.id, { ...profile, email });
        if (data.session?.user) {
          setUser(await sb.loadSessionUser(data.session.user));
          return { ok: true };
        }
        return { ok: true, needsEmailConfirm: true };
      } catch (e) {
        sb.markUnavailable(e);
        // fall through to demo registration so the flow still completes
      }
    }
    const accounts = readAccounts();
    if (accounts.some((a) => a.email === email)) return { ok: false, error: 'email_taken' };
    const acc: StoredAccount = {
      ...profile,
      email,
      id: `acc-${crypto.randomUUID()}`,
      passHash: await sha256(password),
      provider: 'email',
    };
    writeAccounts([...accounts, acc]);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email }));
    const { passHash, ...rest } = acc;
    setUser({ ...rest, demo: true });
    return { ok: true };
  }, []);

  const login = useCallback(async (emailRaw: string, password: string): Promise<AuthResult> => {
    const email = emailRaw.trim().toLowerCase();
    if (sb.isConfigured()) {
      try {
        const client = await sb.authClient();
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          if (!isNetworkAuthError(error)) return { ok: false, error: error.message };
          throw error;
        }
        if (data.session?.user) {
          setUser(await sb.loadSessionUser(data.session.user));
          return { ok: true };
        }
        return { ok: false, error: 'no_session' };
      } catch (e) {
        sb.markUnavailable(e);
      }
    }
    const acc = readAccounts().find((a) => a.email === email);
    if (!acc || acc.passHash !== (await sha256(password))) return { ok: false, error: 'bad_credentials' };
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email }));
    const { passHash, ...rest } = acc;
    setUser({ ...rest, demo: true });
    return { ok: true };
  }, []);

  const loginSocial = useCallback(async (provider: 'google' | 'apple' | 'facebook'): Promise<AuthResult> => {
    if (sb.isConfigured()) {
      try {
        const client = await sb.authClient();
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: window.location.origin + window.location.pathname },
        });
        // On success the browser navigates away; an error usually means the
        // provider is not enabled in the Supabase dashboard.
        if (error) {
          if (!isNetworkAuthError(error)) return { ok: false, error: error.message };
          throw error;
        }
        return { ok: true };
      } catch (e) {
        sb.markUnavailable(e);
      }
    }
    // demo social session
    const email = `demo.${provider}@stylenow.local`;
    const accounts = readAccounts();
    let acc = accounts.find((a) => a.email === email);
    if (!acc) {
      acc = {
        ...emptyProfile('en'),
        name: `${provider[0].toUpperCase()}${provider.slice(1)} User`,
        email,
        consents: { terms: true, marketing: false, personalisation: false },
        id: `acc-${crypto.randomUUID()}`,
        passHash: '',
        provider,
      };
      writeAccounts([...accounts, acc]);
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email }));
    const { passHash, ...rest } = acc;
    setUser({ ...rest, demo: true });
    return { ok: true };
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      if (!user) return;
      const next = { ...user, ...patch, consents: { ...user.consents, ...(patch.consents ?? {}) } };
      setUser(next);
      if (!user.demo && sb.isConfigured()) {
        try {
          await sb.saveProfile(user.id, next);
          return;
        } catch (e) {
          sb.markUnavailable(e);
        }
      }
      writeAccounts(
        readAccounts().map((a) => (a.email === user.email ? { ...a, ...next } : a)),
      );
    },
    [user],
  );

  const exportData = useCallback((): string => {
    // GDPR Art. 20 — everything this browser knows about the person.
    const payload = {
      exportedAt: new Date().toISOString(),
      profile: user,
      bookings: JSON.parse(localStorage.getItem('sn-state-v1') ?? '{}'),
      favourites: JSON.parse(localStorage.getItem('sn-favs') ?? '[]'),
    };
    return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
  }, [user]);

  const deleteAccount = useCallback(async () => {
    if (!user) return;
    if (!user.demo && sb.isConfigured()) {
      try {
        await sb.deleteProfile(user.id);
        const client = await sb.authClient();
        await client.auth.signOut();
      } catch {
        // proceed with local cleanup regardless
      }
    }
    writeAccounts(readAccounts().filter((a) => a.email !== user.email));
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }, [user]);

  const logout = useCallback(async () => {
    if (user && !user.demo && sb.isConfigured()) {
      try {
        const client = await sb.authClient();
        await client.auth.signOut();
      } catch {
        // session is cleared locally below either way
      }
    }
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }, [user]);

  return (
    <Ctx.Provider value={{ user, loading, register, login, loginSocial, updateProfile, exportData, deleteAccount, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
