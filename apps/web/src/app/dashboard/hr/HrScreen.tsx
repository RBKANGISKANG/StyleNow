'use client';
/**
 * HR tab — the same team, two shapes.
 *
 *  Calendar: who is covering which day, and where the gaps are. This is what
 *            you look at to plan a fortnight or approve a holiday.
 *  List:     one person at a time — contract, hours, utilisation, revenue.
 *            This is what you look at before a review or a payroll run.
 *
 * Neither answers the other's question, so the toggle is a real one and the
 * choice is remembered.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { apiLocations } from '@/lib/api';
import type { ShopRef } from '@/lib/owned-shops';
import { HrPanel } from '@/components/HrPanel';
import { RosterCalendarView } from '@/components/RosterCalendar';
import { useToast } from '../toast';
import { OperatorShell } from '../shell';
import { todayIso, addDays } from '@/core/time';

const VIEW_KEY = 'stylenow.hr.view';
type Span = 'w2' | 'month' | 'next30';

export function HrScreen({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard/hr">
      {({ shopId }) => <HrTab shopId={shopId} />}
    </OperatorShell>
  );
}

function HrTab({ shopId }: { shopId: string }) {
  const { t } = useI18n();
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [span, setSpan] = useState<Span>('w2');
  const [locations, setLocations] = useState<Array<{ id: string; label: string }>>([]);
  const { setToast, toastEl } = useToast();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === 'calendar' || saved === 'list') setView(saved);
    } catch {
      // private mode — calendar it is
    }
  }, []);

  const chooseView = (next: 'calendar' | 'list') => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!shopId) return;
    void apiLocations(shopId).then(setLocations);
  }, [shopId]);

  const range = useMemo(() => {
    const today = todayIso();
    if (span === 'next30') return { from: today, to: addDays(today, 29) };
    if (span === 'month') {
      const first = `${today.slice(0, 8)}01`;
      return { from: first, to: addDays(first, 30) };
    }
    // two weeks from the Monday of this week — the planning unit of a salon
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    const monday = addDays(today, 1 - dow);
    return { from: monday, to: addDays(monday, 13) };
  }, [span]);

  const onChanged = useCallback((msg: string) => setToast(msg), [setToast]);

  return (
    <>
      <div className="today-bar">
        <div className="seg">
          <button className={view === 'calendar' ? 'on' : ''} onClick={() => chooseView('calendar')}>
            🗓 {t('view_calendar')}
          </button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => chooseView('list')}>
            ☰ {t('view_list')}
          </button>
        </div>
        {view === 'calendar' && (
          <>
            <div className="seg">
              {(['w2', 'month', 'next30'] as const).map((s) => (
                <button key={s} className={span === s ? 'on' : ''} onClick={() => setSpan(s)}>
                  {s === 'w2' ? t('rc_2weeks') : s === 'month' ? t('hr_this_month') : t('hr_next_month')}
                </button>
              ))}
            </div>
            <span style={{ fontSize: '0.76rem', color: 'var(--ink-soft)' }}>
              {range.from} → {range.to}
            </span>
          </>
        )}
      </div>

      {view === 'calendar' ? (
        <RosterCalendarView shopId={shopId} from={range.from} to={range.to} onChanged={onChanged} />
      ) : (
        <HrPanel shopId={shopId} locations={locations} onChanged={onChanged} />
      )}
      {toastEl}
    </>
  );
}
