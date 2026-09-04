'use client';
/**
 * Invite a friend. The code is the device's own (deterministic, registered on
 * first view); a friend gets a fixed amount off their first booking, and the
 * moment that booking confirms, a small gift card lands here as the thank-you.
 * No account needed on either side — the code is the identity.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { apiMyReferralCode } from '@/lib/api';

export function ReferralPanel() {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void apiMyReferralCode().then(setCode);
  }, []);

  if (!code) return null;
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3>🤝 {t('ref_title')}</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '6px 0 10px', lineHeight: 1.55 }}>
        {t('ref_body')}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="gc-row-code" style={{ fontSize: '1.05rem' }}>{code}</span>
        <button
          className="btn btn-soft sm"
          onClick={() => {
            try {
              void navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // clipboard unavailable — the code is on screen to copy by hand
            }
          }}
        >
          {copied ? '✅' : '📋'} {t('ref_copy')}
        </button>
      </div>
      <p style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', marginTop: 8 }}>{t('ref_fine')}</p>
    </div>
  );
}
