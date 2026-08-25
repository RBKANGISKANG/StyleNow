'use client';
/**
 * Company / shop registration — the four-step onboarding a marketplace
 * actually needs before it can list a business: legal identity, location (or
 * mobile radius), the bookable offer, and payout + policy + consents.
 * Applications land in `shop_applications` (Supabase) / the demo store and
 * mirror the admin-review flow from the OpenAPI contract
 * (GET /admin/shops/pending → decision).
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { apiPartnerApply, apiMyApplications } from '@/lib/api';

// Multi-select: a studio can offer several of these at once. "Mobile" is not
// a category here — it's the service-mode toggle in the location step.
const CATEGORY_OPTIONS = [
  { id: 'hair', emoji: '💇', en: 'Hair', de: 'Haare' },
  { id: 'barber', emoji: '💈', en: 'Barber', de: 'Barbier' },
  { id: 'nails', emoji: '💅', en: 'Nails', de: 'Nägel' },
  { id: 'brows', emoji: '👁️', en: 'Brows & lashes', de: 'Brauen & Wimpern' },
  { id: 'makeup', emoji: '💄', en: 'Make-up', de: 'Make-up' },
  { id: 'skincare', emoji: '🧖', en: 'Facial & skincare', de: 'Gesicht & Hautpflege' },
  { id: 'massage', emoji: '💆', en: 'Massage & spa', de: 'Massage & Spa' },
  { id: 'waxing', emoji: '🪷', en: 'Waxing & hair removal', de: 'Waxing & Haarentfernung' },
  { id: 'tanning', emoji: '☀️', en: 'Tanning', de: 'Bräunung' },
  { id: 'tattoo', emoji: '🖋️', en: 'Tattoo & piercing', de: 'Tattoo & Piercing' },
] as const;
const LANG_OPTIONS = ['de', 'en', 'tr', 'ar', 'pl', 'es', 'fr'];
const DOWS = [1, 2, 3, 4, 5, 6, 7];

interface ServiceRow {
  name: string;
  priceEur: string;
  minutes: string;
}
interface Hours {
  open: string;
  close: string;
  closed: boolean;
}

const DEFAULT_HOURS: Record<number, Hours> = Object.fromEntries(
  DOWS.map((d) => [d, { open: '09:00', close: '18:00', closed: d === 7 }]),
) as Record<number, Hours>;

export default function PartnerPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [error, setError] = useState(false);
  const [doneRef, setDoneRef] = useState<string | null>(null);
  const [pendingRefs, setPendingRefs] = useState<string[]>([]);

  // business
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [contactName, setContactName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [instagram, setInstagram] = useState('');
  const [vatId, setVatId] = useState('');
  const [registerNo, setRegisterNo] = useState('');
  const [smallBusiness, setSmallBusiness] = useState(false);
  // location
  const [isMobile, setIsMobile] = useState(false);
  const [street, setStreet] = useState('');
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('Berlin');
  const [district, setDistrict] = useState('');
  const [radiusKm, setRadiusKm] = useState('10');
  // offer
  const [hours, setHours] = useState<Record<number, Hours>>(DEFAULT_HOURS);
  const [services, setServices] = useState<ServiceRow[]>([{ name: '', priceEur: '', minutes: '45' }]);
  const [staffCount, setStaffCount] = useState('2');
  const [languages, setLanguages] = useState<string[]>(['de']);
  // legal
  const [owner, setOwner] = useState('');
  const [iban, setIban] = useState('');
  const [freeUntilH, setFreeUntilH] = useState('24');
  const [lateFeePct, setLateFeePct] = useState('50');
  const [noShowPct, setNoShowPct] = useState('100');
  const [depositPct, setDepositPct] = useState('20');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptTruth, setAcceptTruth] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiMyApplications().then((apps) =>
      setPendingRefs(apps.filter((a) => a.status === 'pending').map((a) => a.id)),
    );
  }, [doneRef]);

  const stepValid = [
    () =>
      legalName.trim() &&
      displayName.trim() &&
      categories.length > 0 &&
      contactName.trim() &&
      /.+@.+\..+/.test(email) &&
      phone.trim(),
    () => (isMobile ? Number(radiusKm) > 0 : street.trim() && zip.trim() && city.trim()),
    () => services.some((s) => s.name.trim() && Number(s.priceEur) > 0 && Number(s.minutes) > 0),
    () => owner.trim() && iban.replace(/\s/g, '').length >= 15 && acceptTerms && acceptTruth,
  ];

  const next = () => {
    if (!stepValid[step]()) {
      setError(true);
      return;
    }
    setError(false);
    setStep((s) => s + 1);
  };

  const submit = async () => {
    if (!stepValid[3]()) {
      setError(true);
      return;
    }
    setBusy(true);
    const app = await apiPartnerApply({
      business: { legalName, displayName, categories, contactName, email, phone, website, instagram, vatId, registerNo, smallBusiness },
      location: isMobile ? { mobile: true, radiusKm: Number(radiusKm), city } : { mobile: false, street, zip, city, district },
      offer: {
        openingHours: hours,
        services: services
          .filter((s) => s.name.trim())
          .map((s) => ({ name: s.name.trim(), priceCents: Math.round(Number(s.priceEur) * 100), durationMin: Number(s.minutes) })),
        staffCount: Number(staffCount),
        languages,
      },
      payoutAndPolicy: {
        owner,
        ibanMasked: iban.replace(/\s/g, '').replace(/^(.{4}).+(.{4})$/, '$1…$2'),
        freeUntilHours: Number(freeUntilH),
        lateFeePercent: Number(lateFeePct),
        noShowFeePercent: Number(noShowPct),
        depositPercent: Number(depositPct),
      },
      consents: { partnerTerms: acceptTerms, accuracy: acceptTruth, submittedAt: new Date().toISOString() },
      locale: lang,
    });
    setBusy(false);
    if (app) setDoneRef(app.id);
  };

  if (doneRef) {
    return (
      <div className="confirm-card">
        <div className="confirm-top">
          <div className="tick">✓</div>
          <h2>{t('p_done_title')}</h2>
        </div>
        <div className="confirm-body">
          <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{t('p_done_sub')}</div>
          <div className="ref">{doneRef.toUpperCase()}</div>
          <p style={{ fontSize: '0.9rem' }}>{t('p_done_body', { email })}</p>
        </div>
      </div>
    );
  }

  const steps = [t('ps_business'), t('ps_location'), t('ps_offer'), t('ps_legal')];

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-title" style={{ display: 'block' }}>
        <h1>💼 {t('partner_title')}</h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.88rem', marginTop: 4 }}>{t('partner_sub')}</p>
      </div>

      {pendingRefs.map((ref) => (
        <div className="alert" key={ref} style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber)', color: '#8a5a0d' }}>
          ⏳ {t('p_pending', { ref: ref.toUpperCase() })}
        </div>
      ))}

      <div className="steps">
        {steps.map((label, i) => (
          <div key={label} className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
            {i < step ? '✓ ' : ''}
            {label}
          </div>
        ))}
      </div>

      {error && <div className="alert">{t('p_required')}</div>}

      {step === 0 && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" placeholder={`${t('p_legal_name')} *`} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          <input className="input" placeholder={`${t('p_display_name')} *`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <div>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: categories.length === 0 && error ? 'var(--danger)' : 'var(--ink-soft)' }}>
              {t('p_category')} *
            </span>
            <div className="filter-row" style={{ marginTop: 8, marginBottom: 0 }}>
              {CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${categories.includes(c.id) ? 'on-primary' : ''}`}
                  onClick={() =>
                    setCategories(
                      categories.includes(c.id) ? categories.filter((x) => x !== c.id) : [...categories, c.id],
                    )
                  }
                >
                  {c.emoji} {lang === 'de' ? c.de : c.en}
                </button>
              ))}
            </div>
          </div>
          <input className="input" placeholder={`${t('p_contact_name')} *`} value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 2, minWidth: 180 }} type="email" placeholder={`${t('p_email')} *`} value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 140 }} type="tel" placeholder={`${t('p_phone')} *`} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={t('p_website')} value={website} onChange={(e) => setWebsite(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={t('p_instagram')} value={instagram} onChange={(e) => setInstagram(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={t('p_vat')} value={vatId} onChange={(e) => setVatId(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={t('p_register_no')} value={registerNo} onChange={(e) => setRegisterNo(e.target.value)} />
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={smallBusiness} onChange={(e) => setSmallBusiness(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
            {t('p_small_business')}
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}>
            <span className="switch">
              <input type="checkbox" checked={isMobile} onChange={(e) => setIsMobile(e.target.checked)} />
              <span className="knob" />
            </span>
            🚗 {t('p_mobile')}
          </label>
          {isMobile ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} type="number" min={1} max={50} placeholder={t('p_radius')} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
              <input className="input" style={{ flex: 2 }} placeholder={`${t('p_city')} *`} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          ) : (
            <>
              <input className="input" placeholder={`${t('p_street')} *`} value={street} onChange={(e) => setStreet(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} placeholder={`${t('p_zip')} *`} value={zip} onChange={(e) => setZip(e.target.value)} maxLength={10} />
                <input className="input" style={{ flex: 2 }} placeholder={`${t('p_city')} *`} value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <input className="input" placeholder={t('p_district')} value={district} onChange={(e) => setDistrict(e.target.value)} />
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <>
          <div className="panel">
            <h3>{t('p_hours')}</h3>
            {DOWS.map((d) => {
              const h = hours[d];
              const dayName = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, d)));
              return (
                <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                  <span style={{ width: 40, fontWeight: 700, fontSize: '0.85rem' }}>{dayName}</span>
                  <label className="switch">
                    <input type="checkbox" checked={!h.closed} onChange={(e) => setHours({ ...hours, [d]: { ...h, closed: !e.target.checked } })} />
                    <span className="knob" />
                  </label>
                  {h.closed ? (
                    <span style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{t('p_closed')}</span>
                  ) : (
                    <>
                      <input className="input" style={{ width: 110, padding: '8px 10px' }} type="time" value={h.open} onChange={(e) => setHours({ ...hours, [d]: { ...h, open: e.target.value } })} />
                      –
                      <input className="input" style={{ width: 110, padding: '8px 10px' }} type="time" value={h.close} onChange={(e) => setHours({ ...hours, [d]: { ...h, close: e.target.value } })} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="panel">
            <h3>{t('p_services_label')} *</h3>
            {services.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input className="input" style={{ flex: 2 }} placeholder={t('p_svc_name')} value={s.name} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input" style={{ width: 90 }} type="number" min={0} step="0.5" placeholder="€" value={s.priceEur} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, priceEur: e.target.value } : x)))} />
                <input className="input" style={{ width: 80 }} type="number" min={10} step={5} placeholder={t('min')} value={s.minutes} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)))} />
                {services.length > 1 && (
                  <button className="btn btn-ghost sm" onClick={() => setServices(services.filter((_, j) => j !== i))}>✕</button>
                )}
              </div>
            ))}
            <button className="btn btn-soft sm" onClick={() => setServices([...services, { name: '', priceEur: '', minutes: '45' }])}>
              {t('p_add_service')}
            </button>
            <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="chip">
                👥 {t('p_staff_count')}
                <input type="number" min={1} max={50} value={staffCount} onChange={(e) => setStaffCount(e.target.value)} style={{ width: 54, border: 'none', outline: 'none', background: 'transparent', fontWeight: 700 }} />
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--ink-soft)' }}>🗣 {t('p_languages')}:</span>
              <div className="filter-row" style={{ marginTop: 6, marginBottom: 0 }}>
                {LANG_OPTIONS.map((l) => (
                  <button key={l} className={`chip ${languages.includes(l) ? 'on-primary' : ''}`} onClick={() => setLanguages(languages.includes(l) ? languages.filter((x) => x !== l) : [...languages, l])}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {step === 3 && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" placeholder={`${t('p_owner')} *`} value={owner} onChange={(e) => setOwner(e.target.value)} />
          <div>
            <input className="input" placeholder="IBAN * — DE00 0000 0000 0000 0000 00" value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} maxLength={42} />
            <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 4 }}>{t('p_iban_hint')}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {[
              [t('p_policy_free'), freeUntilH, setFreeUntilH, 0, 168],
              [t('p_policy_late'), lateFeePct, setLateFeePct, 0, 100],
              [t('p_policy_noshow'), noShowPct, setNoShowPct, 0, 100],
              [t('p_deposit'), depositPct, setDepositPct, 0, 100],
            ].map(([label, value, setter, min, max]) => (
              <label key={label as string} style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--ink-soft)' }}>
                {label as string}
                <input className="input" style={{ marginTop: 4 }} type="number" min={min as number} max={max as number} value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} />
              </label>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: '0.83rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--primary)' }} />
            <span style={!acceptTerms ? { color: 'var(--danger)' } : undefined}>{t('p_terms')}</span>
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: '0.83rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={acceptTruth} onChange={(e) => setAcceptTruth(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--primary)' }} />
            <span style={!acceptTruth ? { color: 'var(--danger)' } : undefined}>{t('p_truth')}</span>
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {step > 0 && (
          <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>← {t('back')}</button>
        )}
        {step < 3 ? (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={next}>{t('p_next')} →</button>
        ) : (
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => void submit()}>
            {busy ? '…' : `📨 ${t('p_submit')}`}
          </button>
        )}
      </div>
    </div>
  );
}
