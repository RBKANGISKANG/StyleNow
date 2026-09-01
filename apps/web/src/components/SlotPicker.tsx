'use client';
/**
 * Picking a time, two ways.
 *
 * The grid is fast on a laptop: forty chips in view, eyes jump straight to
 * "15:00". On a phone the same grid is a wall of thumb-sized lottery tickets.
 * So there is a second reading of the same slots — a list grouped the way
 * people actually think about their day: morning, afternoon, evening — where
 * every row has the width to say its price, its Prime or Saver tag, and the
 * shop's own reason for the price, which the chip could only whisper as a
 * hover title no phone can see.
 *
 * Phones start on the list, laptops on the grid; the choice is remembered,
 * because which one suits you is a fact about you, not about the viewport
 * you happen to hold today.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money, timeOf } from '@/lib/format';
import { slotTone, slotDelta, slotReason } from '@/lib/prime';
import { GridIcon, ListIcon } from '@/components/ViewIcons';

export interface PickableSlot {
  start: number;
  end: number;
  priceCents: number;
  basePriceCents: number;
  appliedNames?: string[];
}

const VIEW_KEY = 'stylenow.slots.view';

export function useSlotView(): ['grid' | 'list', (v: 'grid' | 'list') => void] {
  // Server render and first client render must agree; the real preference
  // (or the phone default) arrives in the effect.
  const [view, setView] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === 'grid' || saved === 'list') {
        setView(saved);
        return;
      }
    } catch {
      // private mode — fall through to the viewport default
    }
    if (window.innerWidth <= 680) setView('list');
  }, []);

  const choose = (v: 'grid' | 'list') => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // ignore
    }
  };
  return [view, choose];
}

export function SlotViewToggle({
  view,
  onChange,
}: {
  view: 'grid' | 'list';
  onChange: (v: 'grid' | 'list') => void;
}) {
  const { t } = useI18n();
  return (
    <div className="seg view-seg slot-view-seg">
      <button
        className={view === 'grid' ? 'on' : ''}
        onClick={() => onChange('grid')}
        aria-label={t('sv_grid')}
        title={t('sv_grid')}
        type="button"
      >
        <GridIcon />
      </button>
      <button
        className={view === 'list' ? 'on' : ''}
        onClick={() => onChange('list')}
        aria-label={t('sv_list')}
        title={t('sv_list')}
        type="button"
      >
        <ListIcon />
      </button>
    </div>
  );
}

function berlinHour(epoch: number): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }).format(epoch),
  );
}

/** The same slots as the grid, grouped the way a day is actually planned. */
export function SlotList({
  slots,
  selectedStart,
  onPick,
}: {
  slots: PickableSlot[];
  selectedStart: number | null;
  onPick: (s: PickableSlot) => void;
}) {
  const { t, lang } = useI18n();

  const parts: Array<{ key: 'part_morning' | 'part_afternoon' | 'part_evening'; icon: string; rows: PickableSlot[] }> = [
    { key: 'part_morning', icon: '🌅', rows: slots.filter((s) => berlinHour(s.start) < 12) },
    { key: 'part_afternoon', icon: '☀️', rows: slots.filter((s) => berlinHour(s.start) >= 12 && berlinHour(s.start) < 17) },
    { key: 'part_evening', icon: '🌆', rows: slots.filter((s) => berlinHour(s.start) >= 17) },
  ];

  return (
    <div className="slot-list">
      {parts.map((p) =>
        p.rows.length === 0 ? null : (
          <section key={p.key}>
            <h4 className="slot-part-head">
              <span aria-hidden>{p.icon}</span> {t(p.key)}
              <em>{p.rows.length}</em>
            </h4>
            {p.rows.map((s) => {
              const tone = slotTone(s);
              const delta = slotDelta(s);
              const reason = slotReason(s);
              return (
                <button
                  key={s.start}
                  type="button"
                  className={`slot-row ${tone}${selectedStart === s.start ? ' sel' : ''}`}
                  onClick={() => onPick(s)}
                >
                  <span className="sr-time">{timeOf(s.start, lang)}</span>
                  <span className="sr-mid">
                    {tone === 'prime' && <span className="slot-tag prime">{t('prime')}</span>}
                    {tone === 'saver' && <span className="slot-tag saver">{t('saver')}</span>}
                    {reason && <span className="sr-reason">{reason}</span>}
                  </span>
                  <span className="sr-price">
                    <strong className={tone === 'saver' ? 'deal' : tone === 'prime' ? 'surge' : ''}>
                      {money(s.priceCents, lang)}
                    </strong>
                    {tone !== 'base' && (
                      <span className="sr-base">
                        {money(s.basePriceCents, lang)} {delta > 0 ? '+' : '−'}
                        {money(Math.abs(delta), lang)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </section>
        ),
      )}
    </div>
  );
}
