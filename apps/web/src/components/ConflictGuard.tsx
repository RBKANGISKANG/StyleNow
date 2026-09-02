'use client';
/**
 * The safety net under personnel decisions.
 *
 * Approving a vacation, closing the shop for a week, archiving a stylist —
 * each removes working hours, but the appointments already sold inside those
 * hours don't vanish with them. Without this, they'd sit orphaned on the
 * calendar until the customer stood in front of a locked door.
 *
 * This box appears wherever such a decision is made and lists exactly the
 * bookings it strands. Each row resolves in one tap: hand the visit to a
 * colleague who is verifiably free at that exact time (the engine re-checks
 * the seat, and the customer's bell announces the new stylist), or cancel it
 * with a full refund — the shop broke the promise, so the shop eats the fee.
 * It renders nothing at all when the decision strands nobody, which is most
 * of the time.
 */
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money, timeOf, dateOf } from '@/lib/format';
import {
  apiBookingConflicts,
  apiRescheduleBooking,
  apiSetStatus,
  type BookingConflict,
} from '@/lib/api';
import { useConfirm } from './ConfirmDialog';

export function ConflictGuard({
  shopId,
  staffId,
  from,
  to,
  onChanged,
}: {
  shopId: string;
  /** the stylist in question, or null for a shop-wide closure */
  staffId: string | null;
  /** inclusive ISO date range; omit for "everything upcoming" */
  from?: string;
  to?: string;
  onChanged?: (msg: string) => void;
}) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<BookingConflict[] | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  const load = useCallback(() => {
    void apiBookingConflicts(shopId, staffId, from, to).then(setRows);
  }, [shopId, staffId, from, to]);

  useEffect(load, [load]);

  if (!rows || rows.length === 0) return null;

  const reassign = async (c: BookingConflict) => {
    const target = picked[c.bookingId] ?? c.candidates[0]?.id;
    if (!target) return;
    setBusy(c.bookingId);
    const r = await apiRescheduleBooking(shopId, c.bookingId, c.startsAt, target);
    setBusy(null);
    if (r.ok) {
      onChanged?.('✅ ' + t('cg_reassigned', { name: c.candidates.find((x) => x.id === target)?.name ?? '' }));
      load();
    } else {
      // the colleague got booked in the meantime — re-check the list
      onChanged?.('⚠️ ' + t('cg_gone'));
      load();
    }
  };

  return (
    <div className="cg-box">
      {dialog}
      <strong className="cg-title">
        ⚠️ {t('cg_title', { n: String(rows.length) })}
      </strong>
      <p className="cg-sub">{t('cg_sub')}</p>
      {rows.map((c) => (
        <div key={c.bookingId} className="cg-row">
          <div className="cg-what">
            <span className="cg-when">
              {dateOf(c.startsAt, lang)} · {timeOf(c.startsAt, lang)}
            </span>
            <span className="cg-who">
              {c.guestName || t('walk_in')} · {c.serviceNames.map((s) => s[lang]).join(', ')}
              {!staffId && ` · ${c.staffName}`} · {money(c.totalCents, lang)}
            </span>
          </div>
          <div className="cg-actions">
            {c.candidates.length > 0 ? (
              <>
                <select
                  className="input sm"
                  value={picked[c.bookingId] ?? c.candidates[0].id}
                  onChange={(e) => setPicked((p) => ({ ...p, [c.bookingId]: e.target.value }))}
                >
                  {c.candidates.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary sm"
                  disabled={busy === c.bookingId}
                  onClick={() => void reassign(c)}
                >
                  {t('cg_reassign')}
                </button>
              </>
            ) : (
              staffId && <span className="cg-nobody">{t('cg_nobody')}</span>
            )}
            <button
              className="btn btn-ghost sm"
              style={{ color: 'var(--danger)' }}
              disabled={busy === c.bookingId}
              onClick={() =>
                ask({
                  title: t('cg_cancel_title'),
                  body: t('cg_cancel_body'),
                  consequences: [
                    `${c.guestName || t('walk_in')} · ${dateOf(c.startsAt, lang)} ${timeOf(c.startsAt, lang)} · ${money(c.totalCents, lang)}`,
                  ],
                  confirmLabel: t('cg_cancel_confirm'),
                  run: () =>
                    apiSetStatus(shopId, c.bookingId, 'cancelled_by_shop').then(() => {
                      onChanged?.('↩️ ' + t('cg_cancelled'));
                      load();
                    }),
                })
              }
            >
              {t('cg_cancel')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
