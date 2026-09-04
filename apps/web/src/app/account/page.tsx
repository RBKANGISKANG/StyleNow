'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useAuth, emptyProfile, type Profile } from '@/lib/auth';
import { apiMyBookings, apiRecordExitFeedback } from '@/lib/api';
import { ReferralPanel } from '@/components/ReferralPanel';
import { useConfirm } from '@/components/ConfirmDialog';

const SOCIALS = [
  { id: 'google' as const, label: 'Google', icon: 'G', bg: '#fff', fg: '#1a1a1a', border: true },
  { id: 'apple' as const, label: 'Apple', icon: '', bg: '#000', fg: '#fff', border: false },
  { id: 'facebook' as const, label: 'Facebook', icon: 'f', bg: '#1877f2', fg: '#fff', border: false },
];

export default function AccountPage() {
  const { t } = useI18n();
  const { user, loading } = useAuth();

  if (loading) return <div className="spinner" />;
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="page-title">
        <h1>👤 {t('acc_title')}</h1>
      </div>
      {user ? <ProfileView /> : <AuthForms />}
      <div className="panel" style={{ marginTop: 16, textAlign: 'center' }}>
        <p style={{ fontSize: '0.88rem', color: 'var(--ink-soft)' }}>💼 {t('partner_title')}</p>
        <Link href="/partner" className="btn btn-dark" style={{ marginTop: 10 }}>
          {t('partner_nav')} →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SocialRow() {
  const { t } = useI18n();
  const { loginSocial } = useAuth();
  const [hint, setHint] = useState<string | null>(null);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 10px' }}>
        <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', fontWeight: 600 }}>{t('acc_or_social')}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {SOCIALS.map((s) => (
          <button
            key={s.id}
            className="btn"
            style={{
              flex: 1,
              background: s.bg,
              color: s.fg,
              border: s.border ? '1.5px solid var(--line)' : 'none',
              boxShadow: 'var(--shadow-sm)',
            }}
            onClick={() =>
              void (async () => {
                const r = await loginSocial(s.id);
                if (!r.ok) setHint(r.error);
              })()
            }
          >
            <strong style={{ fontFamily: 'var(--font-display)' }}>{s.icon}</strong> {s.label}
          </button>
        ))}
      </div>
      {hint && (
        <p style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--danger)', fontWeight: 600 }}>{hint}</p>
      )}
      <p style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--ink-soft)' }}>{t('acc_social_hint_demo')}</p>
    </>
  );
}

function AuthForms() {
  const { t, lang } = useI18n();
  const { register, login } = useAuth();
  const [tab, setTab] = useState<'signin' | 'register'>('register');
  const [profile, setProfile] = useState<Profile>(() => emptyProfile(lang));
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<Profile>) => setProfile((p) => ({ ...p, ...patch }));
  const setConsent = (key: keyof Profile['consents'], value: boolean) =>
    setProfile((p) => ({ ...p, consents: { ...p.consents, [key]: value } }));

  const canRegister =
    profile.name.trim() &&
    /.+@.+\..+/.test(profile.email) &&
    password.length >= 8 &&
    profile.phone.trim() &&
    profile.consents.terms;

  const submitRegister = async () => {
    setBusy(true);
    setMsg(null);
    const r = await register(profile, password);
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: 'err', text: r.error === 'email_taken' ? t('acc_email_taken') : r.error });
    } else if (r.needsEmailConfirm) {
      setMsg({ kind: 'ok', text: t('acc_check_inbox') });
    }
  };

  const submitLogin = async () => {
    setBusy(true);
    setMsg(null);
    const r = await login(profile.email, password);
    setBusy(false);
    if (!r.ok) setMsg({ kind: 'err', text: r.error === 'bad_credentials' ? t('acc_bad_credentials') : r.error });
  };

  return (
    <div className="panel">
      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>
          {t('acc_register')}
        </button>
        <button className={tab === 'signin' ? 'on' : ''} onClick={() => setTab('signin')}>
          {t('acc_signin')}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tab === 'register' && (
          <input className="input" placeholder={`${t('your_name')} *`} value={profile.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
        )}
        <input className="input" type="email" placeholder={`${t('acc_email')} *`} value={profile.email} onChange={(e) => set({ email: e.target.value })} maxLength={120} />
        <input className="input" type="password" placeholder={`${t('acc_password')} *`} value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100} />
        {tab === 'register' && (
          <>
            <div>
              <input className="input" type="tel" placeholder={`${t('acc_phone')} * (+49 …)`} value={profile.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} />
              <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 4 }}>{t('acc_phone_hint')}</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder={t('acc_zip')} value={profile.postalCode} onChange={(e) => set({ postalCode: e.target.value })} maxLength={10} />
              <input className="input" style={{ flex: 2 }} placeholder={t('acc_city')} value={profile.city} onChange={(e) => set({ city: e.target.value })} maxLength={60} />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', fontWeight: 600 }}>{t('acc_birthday')}</label>
              <input className="input" type="date" value={profile.birthday} onChange={(e) => set({ birthday: e.target.value })} />
            </div>
            <label className="chip" style={{ justifyContent: 'space-between' }}>
              {t('acc_lang')}
              <select value={profile.preferredLanguage} onChange={(e) => set({ preferredLanguage: e.target.value as 'de' | 'en' })}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </label>
            <ConsentBox checked={profile.consents.terms} onChange={(v) => setConsent('terms', v)} label={t('acc_terms')} required />
            <ConsentBox checked={profile.consents.marketing} onChange={(v) => setConsent('marketing', v)} label={t('acc_marketing')} />
            <ConsentBox checked={profile.consents.personalisation} onChange={(v) => setConsent('personalisation', v)} label={t('acc_personalise')} />
          </>
        )}
      </div>

      {msg && (
        <div className="alert" style={{ marginTop: 12, ...(msg.kind === 'ok' ? { background: 'var(--teal-soft)', borderColor: 'var(--teal)', color: 'var(--teal)' } : {}) }}>
          {msg.text}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 14 }}
        disabled={busy || (tab === 'register' ? !canRegister : !profile.email || !password)}
        onClick={() => void (tab === 'register' ? submitRegister() : submitLogin())}
      >
        {busy ? '…' : tab === 'register' ? t('acc_submit_reg') : t('acc_signin')}
      </button>

      <SocialRow />
    </div>
  );
}

function ConsentBox({
  checked,
  onChange,
  label,
  required,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.83rem' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--primary)' }} />
      <span style={required && !checked ? { color: 'var(--danger)' } : undefined}>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------

function ProfileView() {
  const { t } = useI18n();
  const { user, updateProfile, exportData, deleteAccount, logout } = useAuth();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState(0);
  const { ask, dialog } = useConfirm();

  // Shown inside the deletion dialog: leaving does not cancel appointments,
  // and the person deserves to know before, not after.
  useEffect(() => {
    void apiMyBookings().then((bs) =>
      setUpcoming(
        bs.filter((b) => b.startsAt > Date.now() && ['confirmed', 'pending_payment'].includes(b.status)).length,
      ),
    );
  }, []);

  if (!user) return null;
  const p = draft ?? user;

  const askDelete = () =>
    ask({
      title: t('acc_del_title'),
      body: t('acc_del_body'),
      consequences: [
        ...(upcoming > 0 ? [t('acc_del_upcoming', { n: String(upcoming) })] : []),
        t('acc_del_c1'),
        t('acc_del_c2'),
        t('acc_del_c3'),
        t('acc_del_c4'),
      ],
      questions: [
        {
          id: 'reason',
          label: t('acc_del_q_reason'),
          required: true,
          options: [
            t('acc_del_r_unused'),
            t('acc_del_r_shops'),
            t('acc_del_r_price'),
            t('acc_del_r_privacy'),
            t('acc_del_r_bad'),
            t('cd_reason_other'),
          ],
        },
        { id: 'note', label: t('acc_del_q_note'), placeholder: t('acc_del_note_ph') },
      ],
      typeToConfirm: user.email,
      confirmLabel: t('acc_delete'),
      extra: (
        <a className="btn btn-soft sm" href={exportData()} download="stylenow-my-data.json">
          📦 {t('acc_export')}
        </a>
      ),
      run: async (answers) => {
        // Ask first, delete second — afterwards there is nobody left to ask.
        await apiRecordExitFeedback('account', user.email, answers);
        await deleteAccount();
      },
    });

  const save = async () => {
    if (draft) await updateProfile(draft);
    setDraft(null);
    setToast(t('acc_saved'));
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="avatar" style={{ background: 'var(--primary)', margin: 0 }}>{user.name[0]?.toUpperCase() ?? '?'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800 }}>{t('acc_welcome', { name: user.name })}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
              {user.email} · {t('acc_via')} {user.provider}
            </div>
            {user.demo && <span className="st-badge st-pending_payment" style={{ marginTop: 4, display: 'inline-block' }}>{t('acc_demo_badge')}</span>}
          </div>
          <button className="btn btn-soft sm" onClick={() => void logout()}>{t('acc_signout')}</button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h3>{t('acc_profile')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" value={p.name} onChange={(e) => setDraft({ ...p, name: e.target.value })} placeholder={t('your_name')} />
          <input className="input" value={p.phone} onChange={(e) => setDraft({ ...p, phone: e.target.value })} placeholder={t('acc_phone')} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} value={p.postalCode} onChange={(e) => setDraft({ ...p, postalCode: e.target.value })} placeholder={t('acc_zip')} />
            <input className="input" style={{ flex: 2 }} value={p.city} onChange={(e) => setDraft({ ...p, city: e.target.value })} placeholder={t('acc_city')} />
          </div>
          <input className="input" type="date" value={p.birthday} onChange={(e) => setDraft({ ...p, birthday: e.target.value })} />
        </div>
        <h3 style={{ marginTop: 18 }}>{t('acc_consents')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ConsentBox checked={p.consents.marketing} onChange={(v) => setDraft({ ...p, consents: { ...p.consents, marketing: v } })} label={t('acc_marketing')} />
          <ConsentBox checked={p.consents.personalisation} onChange={(v) => setDraft({ ...p, consents: { ...p.consents, personalisation: v } })} label={t('acc_personalise')} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={!draft} onClick={() => void save()}>
          {t('acc_save')}
        </button>
      </div>

      {/* The design switch lives in the header for quick comparison; this is
          where you go to see what it actually changes. */}
      <div className="panel" style={{ marginTop: 14 }}>
        <Link className="btn btn-soft" href="/design">
          {t('ds_title')} →
        </Link>
        <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 6 }}>{t('ds_lead')}</p>
      </div>

      {/* Invite a friend: they save €5 on a first booking over €25; when it
          confirms, a €5 gift card lands on your account automatically. */}
      <ReferralPanel />

      <div className="panel" style={{ marginTop: 14 }}>
        <a className="btn btn-soft" href={exportData()} download="stylenow-my-data.json">
          📦 {t('acc_export')}
        </a>
        <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 6 }}>{t('acc_export_hint')}</p>
        <button className="btn btn-ghost sm" style={{ color: 'var(--danger)', marginTop: 10 }} onClick={askDelete}>
          🗑 {t('acc_delete')}
        </button>
      </div>
      {toast && <div className="toast" role="status">✅ {toast}</div>}
      {dialog}
    </>
  );
}
