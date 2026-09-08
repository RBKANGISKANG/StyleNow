'use client';
/**
 * Buying a gift card.
 *
 * Amount, who it's for, who it's from, a line of text, pay — and out comes a
 * card with a phone-proof code that redeems in the normal checkout's voucher
 * box, partially, until it's empty. The finished card is printable through
 * the Beleg's print isolation (a Gutschein under the tree is paper), and the
 * email button opens the buyer's own mail app with everything the recipient
 * needs — a static site sends nothing itself, and pretending otherwise would
 * be a form that goes nowhere.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { money, dateOf } from '@/lib/format';
import { apiBuyGiftCard, apiGiftTreatment, apiShopServices, apiBuyCorporateBatch, type GiftCard } from '@/lib/api';
import { PayMethod } from '@/components/PayMethod';
import { rememberPayment, type PaymentChoice } from '@/lib/payments';
import { GIFT_MIN_CENTS, GIFT_MAX_CENTS, corporateDiscountPct, type CorporateBatch } from '@/core/store';

const PRESETS = [2500, 5000, 7500, 10000];

export function GiftFlow({
  shop,
}: {
  shop: { id: string; slug: string; name: string; emoji: string; address: string };
}) {
  const { t, lang } = useI18n();
  const [amount, setAmount] = useState(5000);
  const [custom, setCustom] = useState('');
  const [toName, setToName] = useState('');
  const [fromName, setFromName] = useState('');
  const [message, setMessage] = useState('');
  const [pay, setPay] = useState<PaymentChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<GiftCard | null>(null);
  // "One balayage at X" instead of an amount: the gift IS a named service.
  const [treatId, setTreatId] = useState('');
  const [services, setServices] = useState<Array<{ id: string; name: { en: string; de: string }; basePriceCents: number }>>([]);
  useEffect(() => {
    void apiShopServices(shop.id).then((live) => {
      if (Array.isArray(live)) {
        setServices(
          (live as Array<{ id: string; name: { en: string; de: string }; basePriceCents: number }>).filter(
            (sv) => sv.basePriceCents >= GIFT_MIN_CENTS,
          ),
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.id]);
  const treat = services.find((sv) => sv.id === treatId) ?? null;

  const effective = treat ? treat.basePriceCents : custom ? Math.round(Number(custom) * 100) : amount;
  const amountOk = Number.isInteger(effective) && effective >= GIFT_MIN_CENTS && effective <= GIFT_MAX_CENTS;

  const buy = async () => {
    if (!amountOk || !pay) return;
    setBusy(true);
    const c = treat
      ? await apiGiftTreatment(shop.id, treat.id, { toName, fromName, message }, pay)
      : await apiBuyGiftCard(shop.id, effective, { toName, fromName, message }, pay);
    setBusy(false);
    if (c) {
      rememberPayment(pay);
      setCard(c);
    }
  };

  if (card) return <GiftCardSheet shop={shop} card={card} />;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="page-title">
        <h1>🎁 {t('gc_title', { shop: shop.name })}</h1>
        <Link href={`/shops/${shop.slug}`} className="btn btn-ghost sm">
          ← {t('back')}
        </Link>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 14px', lineHeight: 1.55 }}>
        {t('gc_sub')}
      </p>

      <div className="panel">
        <h3>{t('gc_amount')}</h3>
        <div className="filter-row" style={{ marginBottom: 8 }}>
          {PRESETS.map((cents) => (
            <button
              key={cents}
              className={`chip ${!custom && amount === cents ? 'on-primary' : ''}`}
              onClick={() => {
                setAmount(cents);
                setCustom('');
              }}
            >
              {money(cents, lang)}
            </button>
          ))}
          <input
            className="input"
            style={{ width: 110 }}
            inputMode="numeric"
            placeholder={t('gc_custom')}
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ''))}
          />
        </div>
        <label className="chip" style={{ marginTop: 8 }}>
          🎀 {t('gc_treat')}
          <select value={treatId} onChange={(e) => setTreatId(e.target.value)}>
            <option value="">{t('gc_treat_none')}</option>
            {services.map((sv) => (
              <option key={sv.id} value={sv.id}>{sv.name[lang]} · {money(sv.basePriceCents, lang)}</option>
            ))}
          </select>
        </label>
        {custom && !amountOk && (
          <p className="pm-err">
            {t('gc_amount_range', { min: money(GIFT_MIN_CENTS, lang), max: money(GIFT_MAX_CENTS, lang) })}
          </p>
        )}

        <h3 style={{ marginTop: 14 }}>{t('gc_personalise')}</h3>
        <input className="input" placeholder={t('gc_to')} value={toName} maxLength={60}
          onChange={(e) => setToName(e.target.value)} />
        <input className="input" style={{ marginTop: 8 }} placeholder={t('gc_from')} value={fromName} maxLength={60}
          onChange={(e) => setFromName(e.target.value)} />
        <textarea className="input" style={{ marginTop: 8, minHeight: 56, resize: 'vertical' }}
          placeholder={t('gc_message')} value={message} maxLength={200}
          onChange={(e) => setMessage(e.target.value)} />
      </div>

      {amountOk && <PayMethod amountCents={effective} onChange={setPay} />}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 14 }}
        disabled={!amountOk || !pay || busy}
        onClick={() => void buy()}
      >
        {busy ? '…' : `🎁 ${t('gc_buy')} · ${amountOk ? money(effective, lang) : ''}`}
      </button>

      <CorporatePanel shop={shop} />
    </div>
  );
}

const CORP_COUNTS = [5, 10, 20, 50];
const CORP_AMOUNTS = [2500, 5000, 10000];

/**
 * The B2B door on the same page: N ordinary gift cards in one order, at a
 * volume discount. Each code redeems at checkout like any other card — the
 * discount was the company's, the face value is the employee's.
 */
function CorporatePanel({ shop }: { shop: { id: string; name: string } }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState('');
  const [count, setCount] = useState(10);
  const [amount, setAmount] = useState(5000);
  const [pay, setPay] = useState<PaymentChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<CorporateBatch | null>(null);
  const [copied, setCopied] = useState(false);

  const pct = corporateDiscountPct(count);
  const listCents = count * amount;
  const totalCents = Math.round((listCents * (100 - pct)) / 100);

  if (batch) {
    return (
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>💼 {t('corp_done', { n: String(batch.count), company: batch.company })}</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '4px 0 10px' }}>{t('corp_codes_hint')}</p>
        <pre style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem', lineHeight: 1.7, overflowX: 'auto', margin: 0 }}>
          {batch.codes.join('\n')}
        </pre>
        <button
          className="btn btn-soft sm"
          style={{ marginTop: 10 }}
          onClick={() => {
            void navigator.clipboard?.writeText(batch.codes.join('\n')).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          📋 {copied ? t('corp_copied') : t('corp_copy')}
        </button>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>💼 {t('corp_title')}</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '4px 0 10px', lineHeight: 1.5 }}>{t('corp_sub')}</p>
      {!open ? (
        <button className="btn btn-soft sm" onClick={() => setOpen(true)}>
          {t('corp_open')}
        </button>
      ) : (
        <>
          <input className="input" placeholder={t('corp_company')} value={company} maxLength={60}
            onChange={(e) => setCompany(e.target.value)} />
          <div className="filter-row" style={{ marginTop: 8 }}>
            <label className="chip">
              🃏 {t('corp_count')}
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {CORP_COUNTS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="chip">
              💶 {t('gc_amount')}
              <select value={amount} onChange={(e) => setAmount(Number(e.target.value))}>
                {CORP_AMOUNTS.map((c) => (
                  <option key={c} value={c}>{money(c, lang)}</option>
                ))}
              </select>
            </label>
          </div>
          <p style={{ fontSize: '0.85rem', margin: '10px 0 0' }}>
            {t('corp_maths', { list: money(listCents, lang), pct: String(pct) })}{' '}
            <strong>{money(totalCents, lang)}</strong>
          </p>
          <PayMethod amountCents={totalCents} onChange={setPay} />
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 10 }}
            disabled={!company.trim() || !pay || busy}
            onClick={async () => {
              if (!pay) return;
              setBusy(true);
              const r = await apiBuyCorporateBatch(shop.id, company, count, amount, pay);
              setBusy(false);
              if (r.ok) {
                rememberPayment(pay);
                setBatch(r.batch);
              }
            }}
          >
            {busy ? '…' : `💼 ${t('corp_buy')} · ${money(totalCents, lang)}`}
          </button>
        </>
      )}
    </div>
  );
}

/** The finished card — printable, mailable, and honest about how to redeem. */
export function GiftCardSheet({
  shop,
  card,
  onClose,
}: {
  shop: { slug: string; name: string; emoji: string; address: string };
  card: GiftCard;
  onClose?: () => void;
}) {
  const { t, lang } = useI18n();

  useEffect(() => {
    document.body.classList.add('rc-open');
    return () => document.body.classList.remove('rc-open');
  }, []);

  const mailHref = () => {
    const lines = [
      t('gc_mail_line1', { shop: shop.name, amount: money(card.initialCents, lang) }),
      '',
      `${t('gc_code')}: ${card.code}`,
      card.message ?? '',
      '',
      t('gc_mail_how', { shop: shop.name }),
    ].filter(Boolean);
    return `mailto:?subject=${encodeURIComponent(`🎁 ${shop.name} — ${t('gc_a_card')}`)}&body=${encodeURIComponent(lines.join('\n'))}`;
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="rc-sheet gc-sheet" role="dialog" aria-label={t('gc_a_card')}>
        <div className="gc-card">
          <div className="gc-shop">
            {shop.emoji} {shop.name}
          </div>
          <div className="gc-amount">{money(card.balanceCents, lang)}</div>
          {card.toName && <div className="gc-line">{t('gc_for')} <strong>{card.toName}</strong></div>}
          {card.message && <div className="gc-msg">„{card.message}“</div>}
          {card.fromName && <div className="gc-line">— {card.fromName}</div>}
          <div className="gc-code">{card.code}</div>
          <div className="gc-fine">
            {t('gc_redeem_hint')} · {dateOf(card.createdAt, lang)}
          </div>
        </div>

        <footer className="rc-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => window.print()}>
            🖨 {t('rc_print')}
          </button>
          <a className="btn btn-soft" href={mailHref()}>
            ✉️ {t('gc_email')}
          </a>
          {onClose ? (
            <button className="btn btn-ghost" onClick={onClose}>
              {t('rc_close')}
            </button>
          ) : (
            <Link className="btn btn-ghost" href={`/shops/${shop.slug}`}>
              {t('back')}
            </Link>
          )}
        </footer>
      </div>
    </div>
  );
}
