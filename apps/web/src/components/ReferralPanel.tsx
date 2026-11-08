'use client';
/**
 * Rise in level with visits and friends. No money: 1 point per completed
 * visit anywhere on StyleNow, 3 per friend whose first visit is completed, and
 * the points lift you from Member to Silver, Gold, Platinum
 * and Diamond — with perks that cost the salons nothing (waitlist priority,
 * a cheaper Prime extra paid from StyleNow's own share).
 */
import { useEffect, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { apiMyReferralStatus, type CustomerLevel } from '@/lib/api';
import { CUSTOMER_LEVELS } from '@/core/store';

export function ReferralPanel() {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [level, setLevel] = useState<CustomerLevel | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void apiMyReferralStatus()
      .then((r) => {
        setCode(r.code);
        setLevel(r.level);
      })
      .catch(() => {});
  }, []);

  if (!code || !level) return null;
  const link = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/?ref=${code}`;
  const pct = level.next ? Math.round((level.points / level.next.minPoints) * 100) : 100;
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3>🤝 {t('ref_title')}</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
        <span style={{ fontSize: '1.6rem' }} aria-hidden>{level.emoji || '✨'}</span>
        <div style={{ flex: 1 }}>
          <b>{t(`lvl_${level.id}` as MsgKey)}</b>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', marginTop: 4 }}>
            <div style={{ width: `${pct}%`, height: 6, borderRadius: 3, background: 'var(--primary)' }} />
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
            {level.next
              ? t('lvl_progress', { n: level.points, need: level.next.minPoints - level.points, next: t(`lvl_${level.next.id}` as MsgKey), visits: level.visits, friends: level.referrals })
              : t('lvl_top', { n: level.points })}
          </span>
        </div>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '6px 0 10px', lineHeight: 1.55 }}>{t('ref_body')}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="gc-row-code" style={{ fontSize: '1.05rem' }}>{code}</span>
        <button
          className="btn btn-soft sm"
          onClick={() => {
            try {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // clipboard unavailable — the code is on screen
            }
          }}
        >
          {copied ? '✅' : '🔗'} {t('ref_copy')}
        </button>
        <a className="btn btn-soft sm" href={`https://wa.me/?text=${encodeURIComponent(t('ref_share_text', { link }))}`} target="_blank" rel="noreferrer">
          💬 WhatsApp
        </a>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', fontSize: '0.78rem', lineHeight: 1.7 }}>
        {CUSTOMER_LEVELS.filter((l) => l.id !== 'member').map((l) => (
          <li key={l.id} style={{ opacity: level.rank >= l.rank ? 1 : 0.6 }}>
            {l.emoji} <b>{t(`lvl_${l.id}` as MsgKey)}</b> · {t('lvl_needs', { n: l.minPoints })} — {t(`lvl_${l.id}_perk` as MsgKey)}
          </li>
        ))}
      </ul>
      <p style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', marginTop: 8 }}>{t('ref_fine')}</p>
    </div>
  );
}
