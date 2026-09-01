'use client';
/**
 * The Beleg.
 *
 * A digital receipt for one appointment, built to the shape German tax law
 * actually asks of a B2C service receipt (per the IHK guides to §14/§33 UStG):
 * who supplied it and from where, a tax number, a receipt number and dates —
 * issue date and Leistungsdatum are different facts — the priced lines, and
 * the gross total with the VAT it contains. Most salon visits sit under the
 * €250 Kleinbetragsrechnung line, so this comfortably exceeds the minimum;
 * the one thing the renderer must never do is show VAT for a Kleinunternehmer
 * (§19 UStG) — a small business that shows VAT owes it — so that flag swaps
 * the VAT block for the exemption sentence, verbatim in German because the
 * sentence is addressed to the Finanzamt, not to the reader.
 *
 * The tip is printed separately and outside the taxable total: Trinkgeld
 * given voluntarily to staff is not part of the service price.
 *
 * "Save as PDF" is the browser's print dialog with a print stylesheet that
 * isolates the sheet — every platform ships that, nobody installs anything,
 * and the 2025 E-Rechnung mandate does not touch B2C, so a clean printable
 * document is the honest deliverable (structured XRechnung/ZUGFeRD would be
 * for the salon's B2B suppliers, not for customers). "Email" opens the
 * customer's own mail app with the receipt as text — a static site sends
 * nothing itself, and pretending otherwise would be a form that goes nowhere.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money, dateOf, fullDateOf } from '@/lib/format';
import { apiBillingProfile, type BillingProfile } from '@/lib/api';
import { buildXRechnung } from '@/lib/xrechnung';

export interface ReceiptData {
  reference: string;
  startsAt: number;
  shopId: string;
  shopName: string;
  shopAddress: string;
  guestName?: string;
  breakdown: Array<{ label: string; cents: number }>;
  totalCents: number;
  vatCents: number;
  paidCents: number;
  refundedCents: number;
  tipCents: number;
  staffName: string | null;
}

const KLEINUNTERNEHMER_SENTENCE =
  'Kein Steuerausweis aufgrund der Anwendung der Kleinunternehmerregelung (§ 19 UStG).';

export function Receipt({ data, onClose }: { data: ReceiptData; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [billing, setBilling] = useState<BillingProfile | null>(null);

  useEffect(() => {
    let alive = true;
    void apiBillingProfile(data.shopId).then((b) => {
      if (alive) setBilling(b);
    });
    return () => {
      alive = false;
    };
  }, [data.shopId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const netCents = data.totalCents - data.vatCents;

  const textVersion = (): string => {
    const b = billing;
    const lines = [
      `${b?.legalName || data.shopName}`,
      data.shopAddress,
      b ? `${t('rc_taxid')}: ${b.taxId}` : '',
      '',
      `${t('rc_number')}: ${data.reference}`,
      `${t('rc_service_date')}: ${fullDateOf(data.startsAt, lang)}`,
      `${t('rc_issued')}: ${dateOf(Date.now(), lang)}`,
      data.guestName ? `${t('rc_customer')}: ${data.guestName}` : '',
      '',
      ...data.breakdown.map((l) => `${l.label}: ${money(l.cents, lang)}`),
      '',
      `${t('rc_total')}: ${money(data.totalCents, lang)}`,
      ...(b?.smallBusiness
        ? [KLEINUNTERNEHMER_SENTENCE]
        : [`${t('rc_net')}: ${money(netCents, lang)}`, `${t('rc_vat')}: ${money(data.vatCents, lang)}`]),
      ...(data.tipCents > 0 ? [`${t('rc_tip')}: ${money(data.tipCents, lang)}`] : []),
      ...(data.refundedCents > 0 ? [`${t('rc_refunded')}: ${money(data.refundedCents, lang)}`] : []),
    ];
    return lines.filter((l) => l !== '').join('\n');
  };

  const mailHref = () =>
    `mailto:?subject=${encodeURIComponent(`${t('rc_title')} ${data.reference} — ${data.shopName}`)}&body=${encodeURIComponent(textVersion())}`;

  return (
    <div className="rc-backdrop" onClick={onClose}>
      <div className="rc-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="rc-head">
          <div>
            <h2>{t('rc_title')}</h2>
            <span className="rc-ref">{t('rc_number')} {data.reference}</span>
          </div>
          <div className="rc-issuer">
            <strong>{billing?.legalName || data.shopName}</strong>
            <span>{data.shopAddress}</span>
            {billing && <span>{t('rc_taxid')}: {billing.taxId}</span>}
          </div>
        </header>

        <div className="rc-meta">
          <div>
            <span className="k">{t('rc_service_date')}</span>
            <span>{fullDateOf(data.startsAt, lang)}</span>
          </div>
          <div>
            <span className="k">{t('rc_issued')}</span>
            <span>{dateOf(Date.now(), lang)}</span>
          </div>
          {data.guestName && (
            <div>
              <span className="k">{t('rc_customer')}</span>
              <span>{data.guestName}</span>
            </div>
          )}
          {data.staffName && (
            <div>
              <span className="k">{t('rc_staff')}</span>
              <span>{data.staffName}</span>
            </div>
          )}
        </div>

        <table className="rc-lines">
          <tbody>
            {data.breakdown.map((l, i) => (
              <tr key={i}>
                <td>{l.label}</td>
                <td className="num">{money(l.cents, lang)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="rc-total">
              <td>{t('rc_total')}</td>
              <td className="num">{money(data.totalCents, lang)}</td>
            </tr>
            {billing?.smallBusiness ? (
              <tr className="rc-sub">
                {/* The sentence the Finanzamt expects, so it stays German in
                    both languages — translating it would change its meaning. */}
                <td colSpan={2} className="rc-kleinunternehmer">{KLEINUNTERNEHMER_SENTENCE}</td>
              </tr>
            ) : (
              <>
                <tr className="rc-sub">
                  <td>{t('rc_net')}</td>
                  <td className="num">{money(netCents, lang)}</td>
                </tr>
                <tr className="rc-sub">
                  <td>{t('rc_vat')}</td>
                  <td className="num">{money(data.vatCents, lang)}</td>
                </tr>
              </>
            )}
            {data.tipCents > 0 && (
              <tr className="rc-sub">
                <td>{t('rc_tip')}</td>
                <td className="num">{money(data.tipCents, lang)}</td>
              </tr>
            )}
            {data.refundedCents > 0 && (
              <tr className="rc-sub rc-refund">
                <td>{t('rc_refunded')}</td>
                <td className="num">−{money(data.refundedCents, lang)}</td>
              </tr>
            )}
          </tfoot>
        </table>

        <p className="rc-note">{t('rc_keep_note')}</p>

        <ERechnung data={data} billing={billing} />

        <footer className="rc-actions">
          <button className="btn btn-primary" onClick={() => window.print()}>
            🖨 {t('rc_print')}
          </button>
          <a className="btn btn-soft" href={mailHref()}>
            ✉️ {t('rc_email')}
          </a>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('rc_close')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The B2B door: a structured E-Rechnung (XRechnung UBL) for customers who
 * booked as a business.
 *
 * It lives inside the receipt rather than beside it because that is where the
 * question comes up — you are looking at the Beleg and your bookkeeping wants
 * "the XML" instead. The explainer says in one breath what nobody explains:
 * private customers do not need this file, businesses may, and the printable
 * Beleg above stays valid either way. The buyer block asks for exactly what a
 * business invoice must add over a consumer receipt — who the invoice is
 * addressed to — and nothing else.
 */
function ERechnung({ data, billing }: { data: ReceiptData; billing: BillingProfile | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [buyer, setBuyer] = useState({ name: '', street: '', zip: '', city: '' });

  if (!billing) return null;

  const download = () => {
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const xml = buildXRechnung({
      reference: data.reference,
      issueDate: iso(Date.now()),
      serviceDate: iso(data.startsAt),
      seller: { ...billing, address: data.shopAddress },
      buyer,
      breakdown: data.breakdown,
      totalCents: data.totalCents,
      vatCents: data.vatCents,
      paidCents: data.paidCents,
    });
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `xrechnung-${data.reference}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rc-erech">
      <button className="rc-erech-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        📄 {t('xr_toggle')} <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="rc-erech-body">
          <p className="info-fine">{t('xr_explain')}</p>
          <div className="rc-erech-form">
            <input className="input" placeholder={t('xr_company')} value={buyer.name} maxLength={120}
              onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
            <input className="input" placeholder={t('xr_street')} value={buyer.street} maxLength={120}
              onChange={(e) => setBuyer({ ...buyer, street: e.target.value })} />
            <div className="rc-erech-row">
              <input className="input" placeholder={t('xr_zip')} value={buyer.zip} maxLength={5} style={{ maxWidth: 110 }}
                onChange={(e) => setBuyer({ ...buyer, zip: e.target.value.replace(/\D/g, '') })} />
              <input className="input" placeholder={t('xr_city')} value={buyer.city} maxLength={80}
                onChange={(e) => setBuyer({ ...buyer, city: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-soft sm" disabled={!buyer.name.trim()} onClick={download}>
            ⬇️ {t('xr_download')}
          </button>
          <p className="info-fine">{t('xr_note')}</p>
        </div>
      )}
    </div>
  );
}
