'use client';
/**
 * Notifications on this phone or browser. Web push in browsers (Android,
 * desktop, iPhone once added to the home screen); inside the store apps the
 * native Capacitor push plugin is used when the shell includes it.
 * Only in server mode — push needs a server to send from.
 */
import { useEffect, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { backendMode } from '@/lib/api';

type Cat = 'bookings' | 'reminders' | 'messages' | 'news';
const CATS: Cat[] = ['bookings', 'reminders', 'messages', 'news'];
type Prefs = Record<Cat, boolean>;
const ID_KEY = 'sn-push-id';
const api = () => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/push`;

interface NativePush {
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(ev: string, fn: (x: { value?: string; notification?: { data?: { url?: string } } }) => void): Promise<unknown>;
}
type Cap = { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { PushNotifications?: NativePush } };
const cap = (): Cap | undefined => (globalThis as { Capacitor?: Cap }).Capacitor;
const nativePush = () => (cap()?.isNativePlatform?.() ? cap()?.Plugins?.PushNotifications : undefined);

function storedId(): string {
  try {
    return localStorage.getItem(ID_KEY) ?? '';
  } catch {
    return '';
  }
}

function urlB64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function register(body: Record<string, unknown>): Promise<Prefs | null> {
  const r = await fetch(api(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return null;
  const j = await r.json();
  try {
    localStorage.setItem(ID_KEY, j.sub.id);
  } catch {
    /* fine: re-registering is harmless */
  }
  return j.sub.prefs as Prefs;
}

/** Ask permission and register this device. Returns the prefs, or an error key. */
async function enable(lang: string): Promise<Prefs | 'denied' | 'unsupported' | 'failed'> {
  const native = nativePush();
  if (native) {
    const p = await native.requestPermissions();
    if (p.receive !== 'granted') return 'denied';
    const token = await new Promise<string | null>((resolve) => {
      void native.addListener('registration', (t) => resolve(t.value ?? null));
      void native.addListener('registrationError', () => resolve(null));
      void native.register();
      setTimeout(() => resolve(null), 15000);
    });
    if (!token) return 'failed';
    const kind = cap()?.getPlatform?.() === 'ios' ? 'apns' : 'fcm';
    return (await register({ kind, id: token, lang })) ?? 'failed';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const reg = (await navigator.serviceWorker.getRegistration(`${base}/`)) ?? (await navigator.serviceWorker.register(`${base}/sw.js`));
  await navigator.serviceWorker.ready;
  const { publicKey } = await fetch(api()).then((r) => r.json());
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) }));
  const j = sub.toJSON();
  return (await register({ kind: 'web', id: j.endpoint, keys: j.keys, lang })) ?? 'failed';
}

/** In the native app: open the page a tapped notification points to. */
export function useNativePushTaps(): void {
  useEffect(() => {
    const native = nativePush();
    if (!native) return;
    void native.addListener('pushNotificationActionPerformed', (a) => {
      const url = a.notification?.data?.url;
      if (url && url.startsWith('/')) window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${url}`;
    });
  }, []);
}

export function PushSettings({ forBusiness = false }: { forBusiness?: boolean }) {
  const { t, lang } = useI18n();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (backendMode() !== 'server') return;
    setReady(true);
    const id = storedId();
    if (!id) return;
    void fetch(`${api()}?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => j.sub && setPrefs(j.sub.prefs));
  }, []);

  if (!ready) return null;

  const turnOn = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await enable(lang);
      if (typeof r === 'string') setMsg(t(`pn_err_${r}` as MsgKey));
      else setPrefs(r);
    } catch {
      setMsg(t('pn_err_failed'));
    }
    setBusy(false);
  };

  const toggle = async (c: Cat) => {
    if (!prefs) return;
    const next = { ...prefs, [c]: !prefs[c] };
    setPrefs(next);
    await fetch(api(), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: storedId(), prefs: next }) });
  };

  const turnOff = async () => {
    await fetch(api(), { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: storedId() }) });
    try {
      localStorage.removeItem(ID_KEY);
      const reg = await navigator.serviceWorker?.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    } catch {
      /* the server side is already off */
    }
    setPrefs(null);
  };

  const test = async () => {
    await fetch(`${api()}?test=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: storedId() }) });
    setMsg(t('pn_test_sent'));
  };

  return (
    <div className="panel push-settings" style={{ marginTop: 14 }}>
      <h3>🔔 {t('pn_title')}</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', margin: '4px 0 10px', lineHeight: 1.55 }}>{t(forBusiness ? 'pn_sub_biz' : 'pn_sub')}</p>
      {!prefs ? (
        <button className="btn btn-primary sm" disabled={busy} onClick={() => void turnOn()}>
          🔔 {t('pn_on')}
        </button>
      ) : (
        <>
          <div className="stack" style={{ gap: 6 }}>
            {CATS.map((c) => (
              <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.88rem' }}>
                <input type="checkbox" checked={prefs[c]} onChange={() => void toggle(c)} />
                {t(`pn_cat_${c}` as MsgKey)}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-soft sm" onClick={() => void test()}>
              🧪 {t('pn_test')}
            </button>
            <button className="btn btn-soft sm" onClick={() => void turnOff()}>
              🔕 {t('pn_off')}
            </button>
          </div>
        </>
      )}
      {msg && <p style={{ fontSize: '0.8rem', marginTop: 8 }}>{msg}</p>}
    </div>
  );
}

/** Mounted once in the layout: in the store apps, a tapped notification opens its page. */
export function NativePushTaps() {
  useNativePushTaps();
  return null;
}
