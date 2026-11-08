'use client';
/**
 * Company / shop registration — the four-step onboarding a marketplace
 * actually needs before it can list a business: legal identity, location (or
 * mobile radius), the bookable offer, and payout + policy + consents.
 * Applications land in `shop_applications` (Supabase) / the demo store and
 * mirror the admin-review flow from the OpenAPI contract
 * (GET /admin/shops/pending → decision).
 */
import { apiLeadPrefill, apiSalonReferrerName } from '@/lib/api';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { apiPartnerApply, apiMyApplications, apiCustomCategories, apiAddCustomCategory } from '@/lib/api';
import { fileToLogoDataUrl } from '@/lib/image';
import { deviceId } from '@/lib/device';
import { BASE_CATEGORIES } from '@/core/categories';
import { shopHref } from '@/lib/shop-href';

// Multi-select: a studio can offer several of these at once. "Mobile" is not
// a category here — it's the service-mode toggle in the location step.
// The vocabulary is shared with the service manager (src/core/categories.ts).
const CATEGORY_OPTIONS = BASE_CATEGORIES;
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

/** Countries a salon can sign up from (EU + neighbours). Germany first. */
const SALON_COUNTRIES = ['DE', 'AT', 'CH', 'NL', 'BE', 'LU', 'FR', 'DK', 'PL', 'CZ', 'IT', 'ES', 'PT', 'IE', 'SE', 'FI', 'NO', 'GB', 'HU', 'SK', 'SI', 'HR', 'RO', 'BG', 'GR', 'EE', 'LV', 'LT', 'MT', 'CY'];

function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export default function PartnerPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [error, setError] = useState(false);
  const [doneRef, setDoneRef] = useState<string | null>(null);
  const [liveSlug, setLiveSlug] = useState<string | null>(null);
  const [pendingRefs, setPendingRefs] = useState<string[]>([]);

  // business
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [customCats, setCustomCats] = useState<Array<{ id: string; label: string }>>([]);
  const [newCat, setNewCat] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [contactName, setContactName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [instagram, setInstagram] = useState('');
  const [vatId, setVatId] = useState('');
  // The salon's country decides cash-register notices, payouts and VAT wording.
  const [country, setCountry] = useState('DE');
  const [registerNo, setRegisterNo] = useState('');
  const [smallBusiness, setSmallBusiness] = useState(false);
  // location — a company can operate several branches (a chain)
  const [isMobile, setIsMobile] = useState(false);
  const [radiusKm, setRadiusKm] = useState('10');
  const [locations, setLocations] = useState([{ street: '', zip: '', city: 'Berlin', district: '' }]);
  const setLoc = (i: number, patch: Partial<(typeof locations)[number]>) =>
    setLocations(locations.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const city = locations[0]?.city ?? 'Berlin';
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

  // Invited by another salon (/partner?salon_ref=SAL-…): both earn free months.
  const [invitedBy, setInvitedBy] = useState<{ code: string; name: string } | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('salon_ref');
    if (code) void apiSalonReferrerName(code).then((name) => name && setInvitedBy({ code: code.toUpperCase(), name }));
  }, []);

  // Invited by a customer (/partner?cust_ref=REF-…): the customer earns level points.
  const [custRef, setCustRef] = useState<string | null>(null);
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('cust_ref');
    if (c && /^REF-[A-Z0-9]{4,12}$/i.test(c)) setCustRef(c.toUpperCase());
  }, []);

  // An invite link (/partner?lead=…) opens the form with what we already know.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('lead');
    if (!id) return;
    void apiLeadPrefill(id).then((l) => {
      if (!l) return;
      setLegalName((v) => v || l.name);
      setDisplayName((v) => v || l.name);
      const cat = { hair: 'hair', beauty: 'skincare', massage: 'massage', tattoo: 'tattoo', spa: 'massage' }[l.category] ?? '';
      if (cat) setCategories((c) => (c.length ? c : [cat]));
      setContactName((v) => v || l.ownerName);
      setEmail((v) => v || l.email);
      setPhone((v) => v || l.phone);
      setWebsite((v) => v || l.website);
      setInstagram((v) => v || l.instagram);
      setLocations((ls) => (ls[0]?.street ? ls : [{ street: l.street, zip: l.postcode, city: l.city || 'Hamburg', district: '' }]));
      setPrefilledFor(l.name);
    });
  }, []);

  useEffect(() => {
    void apiMyApplications().then((apps) =>
      setPendingRefs(apps.filter((a) => a.status === 'pending').map((a) => a.id)),
    );
    void apiCustomCategories().then(setCustomCats);
  }, [doneRef]);

  const addOwnCategory = async () => {
    const label = newCat.trim();
    if (!label) return;
    const cat = await apiAddCustomCategory(label);
    if (cat) {
      setCustomCats((cs) => (cs.some((c) => c.id === cat.id) ? cs : [...cs, cat]));
      setCategories((cur) => (cur.includes(cat.id) ? cur : [...cur, cat.id]));
      setNewCat('');
    }
  };

  const stepValid = [
    () =>
      legalName.trim() &&
      displayName.trim() &&
      categories.length > 0 &&
      contactName.trim() &&
      /.+@.+\..+/.test(email) &&
      phone.trim(),
    () =>
      isMobile
        ? Number(radiusKm) > 0
        : locations.every((l) => l.street.trim() && l.zip.trim() && l.city.trim()),
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
      business: { legalName, displayName, categories, logoUrl, contactName, email, phone, website, instagram, vatId, registerNo, smallBusiness, country },
      locations: isMobile
        ? [{ mobile: true, radiusKm: Number(radiusKm), city }]
        : locations.map((l) => ({ mobile: false, ...l })),
      isChain: !isMobile && locations.length > 1,
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
      leadId: new URLSearchParams(window.location.search).get('lead') ?? undefined,
      salonRef: invitedBy?.code,
      custRef: custRef ?? undefined,
      // the key the dashboard scopes by, so the new salon shows up there
      ownerKey: user?.email ?? deviceId(),
    }, { iban: iban.replace(/\s/g, '').toUpperCase() });
    setBusy(false);
    if (app) {
      setLiveSlug(app.status === 'approved' && app.shop ? app.shop.slug : null);
      setDoneRef(app.id);
    }
  };

  if (doneRef && liveSlug) {
    return (
      <div className="confirm-card">
        <div className="confirm-top">
          <div className="tick">✓</div>
          <h2>{t('p_live_title')}</h2>
        </div>
        <div className="confirm-body">
          <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{t('p_live_sub')}</div>
          <div className="ref">{doneRef.toUpperCase()}</div>
          <p style={{ fontSize: '0.9rem' }}>{t('p_live_body')}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <Link className="btn btn-primary" href={shopHref(liveSlug)}>{t('p_live_view')}</Link>
            <Link className="btn btn-soft" href="/dashboard">{t('p_live_dashboard')}</Link>
          </div>
        </div>
      </div>
    );
  }

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
    <div className="bf" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-title" style={{ display: 'block' }}>
        <h1>💼 {t('partner_title')}</h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.88rem', marginTop: 4 }}>{t('partner_sub')}</p>
        {prefilledFor && <div className="alert" style={{ marginTop: 10 }}>✨ {t('ld_prefilled', { name: prefilledFor })}</div>}
        {custRef && !invitedBy && <div className="alert" style={{ marginTop: 10, background: 'var(--teal-soft)', borderColor: 'var(--teal)', color: 'var(--teal)' }}>💌 {t('vr_biz_invited')}</div>}
        {invitedBy && <div className="alert" style={{ marginTop: 10, background: 'var(--teal-soft)', borderColor: 'var(--teal)', color: 'var(--teal)' }}>🤝 {t('sref_invited', { name: invitedBy.name })}</div>}
      </div>

      <div className="pt-perks">
        {([['📅', 'pt_p1', 'pt_p1d'], ['💳', 'pt_p2', 'pt_p2d'], ['📈', 'pt_p3', 'pt_p3d']] as const).map(([ico, k, d]) => (
          <div className="pt-perk" key={k}>
            <span className="lp-ico">{ico}</span>
            <b>{t(k)}</b>
            <span>{t(d)}</span>
          </div>
        ))}
      </div>

      {pendingRefs.map((ref) => (
        <div className="alert" key={ref} style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber)', color: '#8a5a0d' }}>
          ⏳ {t('p_pending', { ref: ref.toUpperCase() })}
        </div>
      ))}

      <div className="steps" role="list" style={{ ['--bf-progress-n' as string]: String(step / (steps.length - 1)) }}>
        {steps.map((label, i) => (
          <div
            key={label}
            role="listitem"
            aria-current={i === step ? 'step' : undefined}
            className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}
          >
            <span className="step-dot">{i < step ? '✓' : i + 1}</span>
            <span className="step-label">{label}</span>
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
              {customCats.map((c) => (
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
                  🏷️ {c.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder={t('p_cat_own')}
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addOwnCategory())}
                maxLength={40}
              />
              <button type="button" className="btn btn-soft" disabled={!newCat.trim()} onClick={() => void addOwnCategory()}>
                {t('p_cat_add')}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="logo-preview" />
            ) : (
              <div className="logo-preview" style={{ display: 'grid', placeItems: 'center', fontSize: '1.4rem' }}>🏪</div>
            )}
            <label className="btn btn-soft sm" style={{ cursor: 'pointer' }}>
              🖼 {t('p_logo')}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void fileToLogoDataUrl(f).then(setLogoUrl).catch(() => {});
                  e.target.value = '';
                }}
              />
            </label>
            {logoUrl && (
              <button type="button" className="btn btn-ghost sm" onClick={() => setLogoUrl(null)}>✕</button>
            )}
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
          <label className="chip" style={{ justifyContent: 'space-between', gap: 8 }}>
            {t('p_country')}
            <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t('p_country')}>
              {SALON_COUNTRIES.map((c) => (
                <option key={c} value={c}>{countryName(c, lang)}</option>
              ))}
            </select>
          </label>
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
              <input
                className="input"
                style={{ flex: 2 }}
                placeholder={`${t('p_city')} *`}
                value={locations[0].city}
                onChange={(e) => setLoc(0, { city: e.target.value })}
              />
            </div>
          ) : (
            <>
              <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{t('p_chain_hint')}</p>
              {locations.map((l, i) => (
                <div
                  key={i}
                  style={{
                    border: '1.5px solid var(--line)',
                    borderRadius: 'var(--r-md)',
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.8rem' }}>📍 {t('p_location_n', { n: i + 1 })}</strong>
                    {locations.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost sm"
                        onClick={() => setLocations(locations.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <input className="input" placeholder={`${t('p_street')} *`} value={l.street} onChange={(e) => setLoc(i, { street: e.target.value })} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" style={{ flex: 1 }} placeholder={`${t('p_zip')} *`} value={l.zip} onChange={(e) => setLoc(i, { zip: e.target.value })} maxLength={10} />
                    <input className="input" style={{ flex: 2 }} placeholder={`${t('p_city')} *`} value={l.city} onChange={(e) => setLoc(i, { city: e.target.value })} />
                  </div>
                  <input className="input" placeholder={t('p_district')} value={l.district} onChange={(e) => setLoc(i, { district: e.target.value })} />
                </div>
              ))}
              <button
                type="button"
                className="btn btn-soft sm"
                onClick={() => setLocations([...locations, { street: '', zip: '', city: locations[0].city, district: '' }])}
              >
                {t('p_add_location')}
              </button>
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
