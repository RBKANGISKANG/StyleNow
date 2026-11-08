/**
 * Push notifications. Server only.
 *
 *   Web push (browsers, "add to home screen"): works out of the box. The
 *   VAPID keys are made on first use and kept in the database, or taken from
 *   VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY when set.
 *
 *   Android app (Firebase Cloud Messaging):  FCM_SERVICE_ACCOUNT_JSON
 *   iPhone app (Apple Push):                 APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID,
 *                                            APNS_BUNDLE_ID, APNS_PRODUCTION=1 for the store build
 *   Without those, native devices are simply skipped. See apps/mobile-shell/PUSH.md.
 */
import { createSign, createPrivateKey, sign as edSign } from 'node:crypto';
import http2 from 'node:http2';
import webpush from 'web-push';
import {
  pushTargets,
  pushVapidKeys,
  removePushSub,
  setPushVapidKeys,
  type PushCategory,
  type PushSub,
} from '@/core/store';

export interface PushMessage {
  title: string;
  body: string;
  url: string; // path inside the app, e.g. /bookings
  tag?: string; // same tag replaces the older notification
}

const subject = () => process.env.VAPID_SUBJECT || `mailto:${process.env.MAIL_FROM?.replace(/^.*</, '').replace(/>.*$/, '') || 'hello@stylenow.app'}`;

/** The public key browsers subscribe with. Makes the key pair once. */
export function vapidPublicKey(): string {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return process.env.VAPID_PUBLIC_KEY;
  let k = pushVapidKeys();
  if (!k) {
    setPushVapidKeys(webpush.generateVAPIDKeys());
    k = pushVapidKeys()!;
  }
  return k.publicKey;
}

function vapidPrivateKey(): string {
  vapidPublicKey();
  return process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PRIVATE_KEY : pushVapidKeys()!.privateKey;
}

async function sendWeb(sub: PushSub, m: PushMessage): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.id, keys: sub.keys! },
      JSON.stringify(m),
      { vapidDetails: { subject: subject(), publicKey: vapidPublicKey(), privateKey: vapidPrivateKey() }, TTL: 24 * 3600, urgency: 'high' },
    );
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) removePushSub(sub.id); // the browser unsubscribed
  }
}

// ---- Android: FCM HTTP v1 with a service account --------------------------------

let fcmToken: { value: string; until: number } | null = null;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

async function fcmAccess(sa: { client_email: string; private_key: string }): Promise<string> {
  if (fcmToken && fcmToken.until > Date.now() + 60e3) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  }).then((x) => x.json());
  if (!r.access_token) throw new Error('fcm_auth');
  fcmToken = { value: r.access_token, until: Date.now() + (r.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}

async function sendFcm(sub: PushSub, m: PushMessage): Promise<void> {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return;
  try {
    const sa = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await fcmAccess(sa)}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { token: sub.id, notification: { title: m.title, body: m.body }, data: { url: m.url }, android: { priority: 'high', notification: { tag: m.tag } } },
      }),
    });
    if (res.status === 404 || res.status === 400) {
      const err = await res.json().catch(() => ({}));
      if (JSON.stringify(err).includes('UNREGISTERED') || res.status === 404) removePushSub(sub.id);
    }
  } catch {
    /* a bad key must not stop the other devices */
  }
}

// ---- iPhone: APNs with a .p8 token key ------------------------------------------

let apnsJwt: { value: string; at: number } | null = null;

function apnsToken(): string | null {
  const { APNS_KEY_P8: p8, APNS_KEY_ID: kid, APNS_TEAM_ID: team } = process.env;
  if (!p8 || !kid || !team) return null;
  if (apnsJwt && Date.now() - apnsJwt.at < 50 * 60e3) return apnsJwt.value;
  const head = b64url(JSON.stringify({ alg: 'ES256', kid }));
  const claim = b64url(JSON.stringify({ iss: team, iat: Math.floor(Date.now() / 1000) }));
  const key = createPrivateKey(p8.replace(/\\n/g, '\n'));
  const sig = edSign('sha256', Buffer.from(`${head}.${claim}`), { key, dsaEncoding: 'ieee-p1363' });
  apnsJwt = { value: `${head}.${claim}.${b64url(sig)}`, at: Date.now() };
  return apnsJwt.value;
}

function sendApns(sub: PushSub, m: PushMessage): Promise<void> {
  const token = apnsToken();
  const topic = process.env.APNS_BUNDLE_ID;
  if (!token || !topic) return Promise.resolve();
  const host = process.env.APNS_PRODUCTION === '1' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  return new Promise((resolve) => {
    try {
      const client = http2.connect(host);
      client.on('error', () => resolve());
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${sub.id}`,
        authorization: `bearer ${token}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        ...(m.tag ? { 'apns-collapse-id': m.tag.slice(0, 64) } : {}),
      });
      req.on('response', (h) => {
        if (h[':status'] === 410) removePushSub(sub.id);
      });
      req.on('close', () => {
        client.close();
        resolve();
      });
      req.on('error', () => resolve());
      req.end(JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: 'default' }, url: m.url }));
    } catch {
      resolve();
    }
  });
}

/** Tell these people (account emails / device ids), on every device they enabled for this category. */
export async function pushTo(owners: string[], category: PushCategory, make: (lang: string) => PushMessage): Promise<number> {
  const subs = pushTargets(owners, category);
  await Promise.all(
    subs.map((s) => {
      const m = make(s.lang);
      return s.kind === 'web' ? sendWeb(s, m) : s.kind === 'fcm' ? sendFcm(s, m) : sendApns(s, m);
    }),
  );
  return subs.length;
}

