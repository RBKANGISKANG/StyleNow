'use client';
/**
 * Share a shop.
 *
 * The cheapest growth a salon has is a customer telling a friend, and until
 * now the only way to do that was to copy the address bar. On a phone this
 * opens the native share sheet — WhatsApp, Signal, Messages, wherever people
 * actually recommend a hairdresser. On a desktop, where there is no share
 * sheet, it copies the link instead and says so.
 */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

export function ShareShop({ name, slug }: { name: string; slug: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = typeof window === 'undefined' ? '' : window.location.href;
    const text = t('share_text', { shop: name });

    // navigator.share needs a user gesture and a secure context; if either is
    // missing it throws, and falling back to the clipboard is the right answer.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: name, text, url });
        return;
      } catch (e) {
        // AbortError means they closed the sheet on purpose — don't then
        // silently copy a link they didn't ask for.
        if ((e as Error)?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // clipboard blocked (http, or permissions) — nothing useful left to do
    }
  };

  return (
    <button className="btn btn-soft sm" onClick={() => void share()}>
      {copied ? `✅ ${t('share_copied')}` : `↗ ${t('share_cta')}`}
    </button>
  );
}
