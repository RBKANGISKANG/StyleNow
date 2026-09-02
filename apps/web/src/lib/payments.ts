/**
 * Payment-form plumbing: the checks a real checkout runs before it ever talks
 * to a processor. Everything here is pure and browser-free.
 *
 * Honesty first: this demo is a static site with no payment processor behind
 * it, so nothing in this module charges anything. What it does do is exactly
 * what the client half of Stripe/Adyen does — Luhn-check the PAN, detect the
 * brand, validate expiry, mod-97 an IBAN — so the checkout behaves like the
 * real thing, rejects the typos a real gateway would reject, and hands the
 * engine only a masked label ("Visa ····4242"), never a full number.
 */
import type { PaymentMethod } from '@/core/store';
export type { PaymentMethod };

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'girocard' | 'unknown';

const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Luhn checksum — the same first gate every card processor runs. */
export function luhnValid(number: string): boolean {
  const d = digitsOf(number);
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function cardBrand(number: string): CardBrand {
  const d = digitsOf(number);
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^68/.test(d)) return 'girocard';
  return 'unknown';
}

/** "4242424242424242" → "4242 4242 4242 4242" (Amex groups 4-6-5). */
export function formatCardNumber(raw: string): string {
  const d = digitsOf(raw).slice(0, 19);
  if (cardBrand(d) === 'amex') {
    return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
  }
  return d.replace(/(.{4})/g, '$1 ').trim();
}

/** MM/YY, this month or later. */
export function expiryValid(mmyy: string): boolean {
  const m = mmyy.match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!m) return false;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return false;
  const year = 2000 + Number(m[2]);
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

export function cvcValid(cvc: string, brand: CardBrand): boolean {
  return new RegExp(brand === 'amex' ? '^\\d{4}$' : '^\\d{3}$').test(cvc.trim());
}

/**
 * IBAN mod-97 (ISO 13616) — move the first four chars to the end, map letters
 * to numbers (A=10…), and the remainder of the big number mod 97 must be 1.
 * Length is checked for the countries a Berlin salon actually sees.
 */
const IBAN_LENGTHS: Record<string, number> = { DE: 22, AT: 20, CH: 21, NL: 18, FR: 27, IT: 27, ES: 24, BE: 16, PL: 28 };

export function ibanValid(input: string): boolean {
  const iban = input.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!expected || iban.length !== expected) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rem = (rem * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

export function formatIban(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase().slice(0, 34).replace(/(.{4})/g, '$1 ').trim();
}

/** "Visa ····4242" — what the booking, the Beleg and the dashboard may see. */
export function maskedCardLabel(number: string): string {
  const d = digitsOf(number);
  const brand = cardBrand(d);
  const name = brand === 'unknown' ? 'Card' : brand === 'girocard' ? 'girocard' : brand[0].toUpperCase() + brand.slice(1);
  return `${name} ····${d.slice(-4)}`;
}

export function maskedIbanLabel(iban: string): string {
  const clean = iban.replace(/\s/g, '').toUpperCase();
  return `SEPA ${clean.slice(0, 2)}··${clean.slice(-4)}`;
}

/**
 * The remembered method, so the next checkout is one tap. Only the masked
 * label survives — a full PAN or IBAN never touches storage.
 */
const PREF_KEY = 'stylenow.pay.pref';

export interface PaymentChoice {
  method: PaymentMethod;
  label: string;
}

export function savedPayment(): PaymentChoice | null {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PaymentChoice;
    return p && typeof p.method === 'string' && typeof p.label === 'string' ? p : null;
  } catch {
    return null;
  }
}

export function rememberPayment(p: PaymentChoice): void {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // private mode — the choice just isn't remembered
  }
}
