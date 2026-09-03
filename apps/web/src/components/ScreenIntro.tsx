'use client';
/**
 * First-run explainers for the back office.
 *
 * A tool somebody opens for the first time should say what it is for — once.
 * Each dashboard screen gets a three-line introduction: what this screen
 * does, what touching it changes, and the one thing worth knowing that the
 * UI cannot show. "Got it" dismisses it forever (per screen, per browser);
 * a returning operator never sees it again, which is exactly why it can
 * afford to exist at all.
 */
import { useEffect, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';

const INTROS: Record<string, { emoji: string; title: MsgKey; points: MsgKey[] }> = {
  '/dashboard': { emoji: '📅', title: 'in_today_t', points: ['in_today_1', 'in_today_2', 'in_today_3'] },
  '/dashboard/revenue': { emoji: '📈', title: 'in_rev_t', points: ['in_rev_1', 'in_rev_2', 'in_rev_3'] },
  '/dashboard/customers': { emoji: '👤', title: 'in_cus_t', points: ['in_cus_1', 'in_cus_2', 'in_cus_3'] },
  '/dashboard/messages': { emoji: '💬', title: 'in_msg_t', points: ['in_msg_1', 'in_msg_2', 'in_msg_3'] },
  '/dashboard/services': { emoji: '✂️', title: 'in_svc_t', points: ['in_svc_1', 'in_svc_2', 'in_svc_3'] },
  '/dashboard/team': { emoji: '👥', title: 'in_team_t', points: ['in_team_1', 'in_team_2', 'in_team_3'] },
  '/dashboard/hr': { emoji: '🧾', title: 'in_hr_t', points: ['in_hr_1', 'in_hr_2', 'in_hr_3'] },
  '/dashboard/shop': { emoji: '⚙️', title: 'in_shop_t', points: ['in_shop_1', 'in_shop_2', 'in_shop_3'] },
};

export function ScreenIntro({ screen }: { screen: string }) {
  const { t } = useI18n();
  const intro = INTROS[screen];
  // Hidden until storage says otherwise — a returning operator must never see
  // a flash of an explainer they dismissed weeks ago.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!intro) return;
    try {
      setShow(window.localStorage.getItem(`stylenow.intro.${screen}`) !== '1');
    } catch {
      setShow(true);
    }
  }, [screen, intro]);

  if (!intro || !show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(`stylenow.intro.${screen}`, '1');
    } catch {
      // private mode — it will greet them again next visit, which is fine
    }
  };

  return (
    <div className="intro-card" role="note">
      <div className="intro-head">
        <span className="intro-emoji" aria-hidden>{intro.emoji}</span>
        <strong>{t(intro.title)}</strong>
        <button className="btn btn-primary sm" onClick={dismiss}>
          {t('in_gotit')}
        </button>
      </div>
      <ul>
        {intro.points.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
    </div>
  );
}
