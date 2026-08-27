'use client';
/**
 * One appointment, everything about it, and everything you can do to it.
 *
 * Before this, an appointment on the shop side was a coloured block with a
 * tooltip: to see the customer's phone number you went to the list view, to
 * move it you got a panel below the fold, to mark it done you went somewhere
 * else again. Clicking the thing you are looking at should tell you about the
 * thing you are looking at.
 */
import { useEffect, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { money, timeOf } from '@/lib/format';
import {
  apiAvailability,
  apiRescheduleBooking,
  apiSetStatus,
  apiSetCustomerNote,
} from '@/lib/api';
import { Modal } from './Modal';
import { useConfirm } from './ConfirmDialog';
import { isoDateOf } from '@/core/time';

export interface DialogBooking {
  id: string;
  reference: string;
  guestName: string;
  guestPhone: string;
  guestNote: string;
  customerKey: string;
  serviceIds: string[];
  serviceNames: string[];
  staffId: string;
  staffName: string;
  startsAt: number;
  status: string;
  totalCents: number;
}

export function AppointmentDialog({
  shopId,
  booking,
  staff,
  onClose,
  onChanged,
}: {
  shopId: string;
  booking: DialogBooking | null;
  staff: Array<{ id: string; name: string }>;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const { t, lang } = useI18n();
  const [moving, setMoving] = useState(false);
  const [moveStaff, setMoveStaff] = useState<string | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [slots, setSlots] = useState<Array<{ start: number; priceCents: number }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const { ask, dialog } = useConfirm();

  // Reset every time a different appointment is opened.
  useEffect(() => {
    if (!booking) return;
    setMoving(false);
    setConflict(false);
    setMoveStaff(booking.staffId);
    setMoveDate(isoDateOf(booking.startsAt));
    setSlots(null);
  }, [booking]);

  useEffect(() => {
    if (!booking || !moving || !moveDate) return;
    setSlots(null);
    void apiAvailability(shopId, booking.serviceIds, moveDate, moveStaff).then((s) =>
      setSlots(s.map((x) => ({ start: x.start, priceCents: x.priceCents }))),
    );
  }, [shopId, booking, moving, moveDate, moveStaff]);

  if (!booking) return null;
  const live = ['confirmed', 'pending_payment'].includes(booking.status);

  const setStatus = async (status: 'completed' | 'no_show') => {
    setBusy(true);
    await apiSetStatus(shopId, booking.id, status);
    setBusy(false);
    onChanged(status === 'completed' ? '✅ ' + t('st_completed') : '🚫 ' + t('st_no_show'));
    onClose();
  };

  return (
    <>
      {dialog}
      <Modal
        open
        wide={moving}
        onClose={onClose}
        title={`${booking.guestName}`}
        subtitle={
          <>
            {isoDateOf(booking.startsAt)} · {timeOf(booking.startsAt, lang)} · {booking.staffName} ·{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{booking.reference}</span>
          </>
        }
        footer={
          moving ? (
            <button className="btn btn-soft" onClick={() => setMoving(false)}>
              ← {t('back')}
            </button>
          ) : (
            <>
              {live && (
                <>
                  <button className="btn btn-soft" disabled={busy} onClick={() => void setStatus('completed')}>
                    ✓ {t('mark_completed')}
                  </button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void setStatus('no_show')}>
                    {t('mark_no_show')}
                  </button>
                  <button className="btn btn-soft" onClick={() => setMoving(true)}>
                    ↔ {t('dash_move')}
                  </button>
                  <button
                    className="btn cd-danger"
                    onClick={() =>
                      ask({
                        title: t('del_booking_title', { name: booking.guestName }),
                        body: t('del_booking_body'),
                        consequences: [
                          `${booking.serviceNames.join(', ')} · ${timeOf(booking.startsAt, lang)} · ${money(booking.totalCents, lang)}`,
                          t('del_booking_c1'),
                        ],
                        confirmLabel: t('del_booking_confirm'),
                        run: async () => {
                          await apiSetStatus(shopId, booking.id, 'cancelled_by_shop');
                          onChanged('🗑 ' + t('dash_cancelled'));
                          onClose();
                        },
                      })
                    }
                  >
                    ✕ {t('dash_cancel_bk')}
                  </button>
                </>
              )}
              {!live && (
                <span style={{ fontSize: '0.82rem', color: 'var(--ink-soft)' }}>{t('ap_closed_note')}</span>
              )}
            </>
          )
        }
      >
        {moving ? (
          <>
            {conflict && <div className="alert" style={{ marginBottom: 10 }}>{t('slot_taken_body')}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <label className="chip">
                {t('dash_pick_date')}
                <input
                  type="date"
                  value={moveDate}
                  onChange={(e) => setMoveDate(e.target.value)}
                  style={{ border: 'none', background: 'transparent', outline: 'none', fontWeight: 600 }}
                />
              </label>
              <label className="chip">
                👤
                <select value={moveStaff ?? ''} onChange={(e) => setMoveStaff(e.target.value || null)}>
                  <option value="">{t('any_staff')}</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {slots === null ? (
              <div className="spinner" />
            ) : slots.length === 0 ? (
              <div className="empty" style={{ padding: '20px 14px' }}>{t('no_slots')}</div>
            ) : (
              <div className="slot-grid">
                {slots.map((s) => (
                  <button
                    key={s.start}
                    className="slot-chip"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const r = await apiRescheduleBooking(shopId, booking.id, s.start, moveStaff);
                      setBusy(false);
                      if (!r.ok) {
                        setConflict(true);
                        void apiAvailability(shopId, booking.serviceIds, moveDate, moveStaff).then((x) =>
                          setSlots(x.map((y) => ({ start: y.start, priceCents: y.priceCents }))),
                        );
                        return;
                      }
                      onChanged('✅ ' + t('dash_moved'));
                      onClose();
                    }}
                  >
                    <div className="t">{timeOf(s.start, lang)}</div>
                    <div className="p">{money(s.priceCents, lang)}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="ap-body">
            <div className="ap-rows">
              <div>
                <span className="k">{t('services')}</span>
                <span className="v">{booking.serviceNames.join(', ')}</span>
              </div>
              <div>
                <span className="k">{t('total')}</span>
                <span className="v">{money(booking.totalCents, lang)}</span>
              </div>
              <div>
                <span className="k">{t('ap_status')}</span>
                <span className="v">
                  <span className={`st-badge st-${booking.status}`}>{t(`st_${booking.status}` as MsgKey)}</span>
                </span>
              </div>
              <div>
                <span className="k">{t('hr_contact')}</span>
                <span className="v">
                  {booking.guestPhone ? (
                    <a href={`tel:${booking.guestPhone.replace(/\s/g, '')}`} style={{ fontWeight: 700, color: 'var(--teal)' }}>
                      📞 {booking.guestPhone}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--ink-soft)' }}>{t('cus_no_phone')}</span>
                  )}
                </span>
              </div>
            </div>

            {booking.guestNote && (
              <div className="ap-note">
                <strong>💬 {t('cus_said')}</strong>
                <p>“{booking.guestNote}”</p>
              </div>
            )}

            <label className="md-jot" style={{ marginTop: 12 }}>
              <span>🔒 {t('cus_private_note')}</span>
              <input
                className="input"
                placeholder={t('cus_private_ph')}
                maxLength={280}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v) return;
                  void apiSetCustomerNote(shopId, booking.customerKey, v).then(() => {
                    e.target.value = '';
                    onChanged('💾 ' + t('team_saved'));
                  });
                }}
              />
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}
