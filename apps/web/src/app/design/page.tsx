'use client';
/**
 * The design vocabulary, in the app rather than in a document.
 *
 * A palette printed in a PDF drifts from the product the week after it is
 * written. This page reads the same custom properties the rest of the app is
 * painted with, so a swatch here is the colour a button is — if one changes,
 * this changes with it. The type ramp and the icon set are rendered the same
 * way, by the same components the screens use.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useDesign } from '@/lib/design';
import { Icon, type IconName } from '@/components/Icon';

const ACCENTS: Array<{ token: string; label: string; on: string }> = [
  { token: '--primary', label: 'Primary', on: '#fff' },
  { token: '--primary-deep', label: 'Primary deep', on: '#fff' },
  { token: '--teal', label: 'Teal', on: '#fff' },
  { token: '--violet', label: 'Violet', on: '#fff' },
  { token: '--amber', label: 'Amber', on: '#4a2f08' },
  { token: '--success', label: 'Success', on: '#fff' },
  { token: '--danger', label: 'Danger', on: '#fff' },
  { token: '--ink', label: 'Ink', on: '#fff' },
];

const SURFACES: Array<{ token: string; label: string }> = [
  { token: '--bg', label: 'Canvas' },
  { token: '--surface', label: 'Surface' },
  { token: '--surface-2', label: 'Surface 2' },
  { token: '--primary-soft', label: 'Primary soft' },
];

const ICONS: IconName[] = [
  'scissors', 'star', 'pin', 'clock', 'calendar', 'zap', 'bell', 'heart', 'share',
  'trend', 'users', 'message', 'shield', 'repeat', 'phone', 'search', 'plus',
  'check', 'chevron', 'sparkle', 'globe', 'briefcase', 'user', 'image', 'sun',
];

/** Resolve a custom property to the value the browser actually paints. */
function useTokens(names: string[]): Record<string, string> {
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const n of names) out[n] = cs.getPropertyValue(n).trim();
    setVals(out);
    // names is a module-level constant list; re-reading on every render would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return vals;
}

export default function DesignPage() {
  const { t } = useI18n();
  const { design, setDesign } = useDesign();
  const tokens = useTokens([...ACCENTS.map((a) => a.token), ...SURFACES.map((s) => s.token)]);

  return (
    <div>
      <div className="page-title">
        <h1>{t('ds_title')}</h1>
        <button
          className={`btn ${design === 'studio' ? 'btn-dark' : 'btn-soft'} sm`}
          onClick={() => setDesign(design === 'studio' ? 'classic' : 'studio')}
        >
          <Icon name="sparkle" size={15} />
          {t(design === 'studio' ? 'design_studio' : 'design_classic')}
        </button>
      </div>
      <p className="ds-lead">{t('ds_lead')}</p>

      <section className="section">
        <h2>{t('ds_colour')}</h2>
        <div className="panel">
          <div className="ds-swatches">
            {ACCENTS.map((a) => (
              <div
                key={a.token}
                className="ds-sw"
                style={{ background: `var(${a.token})`, color: a.on }}
              >
                <b>{a.label}</b>
                <span>{tokens[a.token] || a.token}</span>
              </div>
            ))}
          </div>
          <div className="ds-swatches sm">
            {SURFACES.map((s) => (
              <div key={s.token} className="ds-sw pale" style={{ background: `var(${s.token})` }}>
                <b>{s.label}</b>
                <span>{tokens[s.token] || s.token}</span>
              </div>
            ))}
          </div>
          <p className="ds-note">{t('ds_colour_note')}</p>
        </div>
      </section>

      <section className="section">
        <h2>{t('ds_type')}</h2>
        <div className="panel ds-type">
          <div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.1rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
              Display
            </span>
            <em>Poppins 700 · −0.03em</em>
          </div>
          <div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.32rem', fontWeight: 700, letterSpacing: '-0.025em' }}>
              Section
            </span>
            <em>Poppins 700</em>
          </div>
          <div>
            <span style={{ fontSize: '0.92rem', fontWeight: 700 }}>Label</span>
            <em>Inter 700</em>
          </div>
          <div>
            <span style={{ fontSize: '0.87rem' }}>Body — a cut that fits your week.</span>
            <em>Inter 400 · 1.55</em>
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', fontWeight: 600 }}>Meta</span>
            <em>Inter 600 · ink-soft</em>
          </div>
          <p className="ds-note">{t('ds_type_note')}</p>
        </div>
      </section>

      <section className="section">
        <h2>{t('ds_controls')}</h2>
        <div className="panel">
          <div className="ds-row">
            <span className="btn btn-primary sm">Primary</span>
            <span className="btn btn-dark sm">Dark</span>
            <span className="btn btn-soft sm">Soft</span>
            <span className="btn btn-ghost sm">Ghost</span>
          </div>
          <div className="ds-row">
            <span className="chip">Chip</span>
            <span className="chip on">Chip on</span>
            <span className="chip on-primary">Chip primary</span>
          </div>
          <div className="ds-row">
            <span className="open-badge on">Open until 20:00</span>
            <span className="open-badge off">Opens Thu at 09:00</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>{t('ds_icons')}</h2>
        <div className="panel">
          <div className="ds-icons">
            {ICONS.map((n) => (
              <div key={n} className="ds-ico" title={n}>
                <Icon name={n} size={21} />
              </div>
            ))}
          </div>
          <p className="ds-note">{t('ds_icons_note')}</p>
        </div>
      </section>
    </div>
  );
}
