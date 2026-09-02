'use client';
/**
 * The payment step of checkout.
 *
 * Five doors, the ones a Berlin customer actually reaches for: card, PayPal,
 * Apple Pay, Google Pay and SEPA-Lastschrift. The form runs the same client
 * checks a real gateway front-end runs — Luhn on the card number with live
 * brand detection, expiry in the future, mod-97 on the IBAN — so typos die
 * here, not at a bank. Wallets condense to a single authorize tap, which is
 * exactly their pitch in real life.
 *
 * And the honesty line, printed right on the form: this is a demo checkout —
 * no processor sits behind it and no charge happens. What survives is only a
 * masked label ("Visa ····4242"); a full card number or IBAN never leaves
 * this component, not into the engine, not into storage. The chosen method is
 * remembered (masked) so the next visit is one tap, like any wallet.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money } from '@/lib/format';
import {
  luhnValid, cardBrand, formatCardNumber, expiryValid, cvcValid,
  ibanValid, formatIban, maskedCardLabel, maskedIbanLabel,
  savedPayment, type PaymentChoice, type PaymentMethod,
} from '@/lib/payments';

const BRAND_ICON: Record<string, string> = {
  visa: 'VISA', mastercard: 'MC', amex: 'AMEX', girocard: 'giro', unknown: '💳',
};

type Tab = Exclude<PaymentMethod, 'at_salon'>;

export function PayMethod({
  amountCents,
  onChange,
}: {
  amountCents: number;
  onChange: (p: PaymentChoice | null) => void;
}) {
  const { t, lang } = useI18n();
  const [saved, setSaved] = useState<PaymentChoice | null>(null);
  const [useSaved, setUseSaved] = useState(false);
  const [tab, setTab] = useState<Tab>('card');
  const [card, setCard] = useState({ num: '', exp: '', cvc: '' });
  const [sepa, setSepa] = useState({ iban: '', holder: '' });
  const [authorized, setAuthorized] = useState<Partial<Record<Tab, boolean>>>({});

  useEffect(() => {
    const s = savedPayment();
    if (s && s.method !== 'at_salon') {
      setSaved(s);
      setUseSaved(true);
    }
  }, []);

  const brand = cardBrand(card.num);
  const choice: PaymentChoice | null = useMemo(() => {
    if (useSaved && saved) return saved;
    switch (tab) {
      case 'card':
        return luhnValid(card.num) && expiryValid(card.exp) && cvcValid(card.cvc, brand)
          ? { method: 'card', label: maskedCardLabel(card.num) }
          : null;
      case 'sepa':
        return ibanValid(sepa.iban) && sepa.holder.trim().length > 1
          ? { method: 'sepa', label: maskedIbanLabel(sepa.iban) }
          : null;
      case 'paypal':
        return authorized.paypal ? { method: 'paypal', label: 'PayPal' } : null;
      case 'apple_pay':
        return authorized.apple_pay ? { method: 'apple_pay', label: 'Apple Pay' } : null;
      case 'google_pay':
        return authorized.google_pay ? { method: 'google_pay', label: 'Google Pay' } : null;
    }
  }, [useSaved, saved, tab, card, brand, sepa, authorized]);

  useEffect(() => onChange(choice), [choice, onChange]);

  const wallet = (m: Tab, cls: string, mark: string) => (
    <button
      type="button"
      className={`pm-wallet ${cls}${authorized[m] ? ' done' : ''}`}
      onClick={() => setAuthorized((a) => ({ ...a, [m]: true }))}
    >
      {authorized[m] ? `✓ ${t('pm_authorized')}` : `${mark} · ${money(amountCents, lang)}`}
    </button>
  );

  return (
    <div className="panel pm-panel">
      <h3>💳 {t('pm_title', { amount: money(amountCents, lang) })}</h3>

      {saved && useSaved ? (
        <div className="pm-saved">
          <span>
            {t('pm_saved')} <strong>{saved.label}</strong>
          </span>
          <button type="button" className="btn btn-ghost sm" onClick={() => setUseSaved(false)}>
            {t('pm_other')}
          </button>
        </div>
      ) : (
        <>
          <div className="pm-tabs" role="tablist">
            {(
              [
                ['card', `💳 ${t('pm_card')}`],
                ['paypal', 'PayPal'],
                ['apple_pay', ' Pay'],
                ['google_pay', 'G Pay'],
                ['sepa', `🏦 SEPA`],
              ] as Array<[Tab, string]>
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={tab === m}
                className={tab === m ? 'on' : ''}
                onClick={() => setTab(m)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'card' && (
            <div className="pm-body">
              <div className="pm-cardnum">
                <input
                  className="input"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder={t('pm_card_num')}
                  value={card.num}
                  onChange={(e) => setCard({ ...card, num: formatCardNumber(e.target.value) })}
                />
                <span className={`pm-brand${brand !== 'unknown' ? ' known' : ''}`}>{BRAND_ICON[brand]}</span>
              </div>
              <div className="pm-row">
                <input
                  className="input"
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  placeholder="MM/YY"
                  maxLength={5}
                  value={card.exp}
                  onChange={(e) => {
                    const d = e.target.value.replace(/[^\d/]/g, '');
                    setCard({ ...card, exp: d.length === 2 && !d.includes('/') && card.exp.length < d.length ? `${d}/` : d });
                  }}
                />
                <input
                  className="input"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  placeholder="CVC"
                  maxLength={4}
                  value={card.cvc}
                  onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '') })}
                />
              </div>
              {card.num.replace(/\s/g, '').length >= 13 && !luhnValid(card.num) && (
                <p className="pm-err">{t('pm_card_bad')}</p>
              )}
              {card.exp.length === 5 && !expiryValid(card.exp) && <p className="pm-err">{t('pm_exp_bad')}</p>}
            </div>
          )}

          {tab === 'sepa' && (
            <div className="pm-body">
              <input
                className="input"
                autoComplete="off"
                spellCheck={false}
                placeholder="IBAN — DE89 3704 0044 0532 0130 00"
                value={sepa.iban}
                onChange={(e) => setSepa({ ...sepa, iban: formatIban(e.target.value) })}
              />
              <input
                className="input"
                style={{ marginTop: 8 }}
                placeholder={t('pm_holder')}
                value={sepa.holder}
                maxLength={80}
                onChange={(e) => setSepa({ ...sepa, holder: e.target.value })}
              />
              {sepa.iban.replace(/\s/g, '').length >= 15 && !ibanValid(sepa.iban) && (
                <p className="pm-err">{t('pm_iban_bad')}</p>
              )}
              {choice?.method === 'sepa' && <p className="pm-fine">{t('pm_sepa_mandate')}</p>}
            </div>
          )}

          {tab === 'paypal' && <div className="pm-body">{wallet('paypal', 'paypal', 'PayPal')}</div>}
          {tab === 'apple_pay' && <div className="pm-body">{wallet('apple_pay', 'apple', ' Pay')}</div>}
          {tab === 'google_pay' && <div className="pm-body">{wallet('google_pay', 'google', 'G Pay')}</div>}
        </>
      )}

      <p className="pm-fine">🔒 {t('pm_demo_note')}</p>
    </div>
  );
}
