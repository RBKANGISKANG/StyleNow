'use client';
/**
 * Naming the customer on a new appointment.
 *
 * Typing a regular's name from scratch every time is both slow and lossy: one
 * "Marie Hoffmann" and one "marie hoffman" are two people to the customer book,
 * which quietly breaks visit counts, spend and the private note. So the field
 * filters the people this shop already knows and lets you pick one — that
 * reuses their record instead of forking it, and fills the phone number in.
 *
 * It stays a plain text field for anyone new. Somebody walking in off the
 * street must not need a database row before they can be booked.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { money } from '@/lib/format';
import { apiShopCustomers } from '@/lib/api';
import type { CustomerRow } from '@/core/store';

export function CustomerPicker({
  shopId,
  name,
  onPick,
}: {
  shopId: string;
  name: string;
  onPick: (v: { name: string; phone?: string }) => void;
}) {
  const { t, lang } = useI18n();
  const [people, setPeople] = useState<CustomerRow[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<CustomerRow | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void apiShopCustomers(shopId).then((rows) => {
      if (alive) setPeople(rows);
    });
    return () => {
      alive = false;
    };
  }, [shopId]);

  // A click anywhere else is a decision not to pick anybody.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const needle = name.trim().toLowerCase();
  const matches = needle.length === 0
    ? people.slice(0, 6)
    : people
        .filter((p) => `${p.name} ${p.phone ?? ''}`.toLowerCase().includes(needle))
        // An exact match first — that is almost always the one meant.
        .sort((a, b) => Number(b.name.toLowerCase() === needle) - Number(a.name.toLowerCase() === needle))
        .slice(0, 6);

  const choose = (p: CustomerRow) => {
    setPicked(p);
    setOpen(false);
    onPick({ name: p.name, phone: p.phone ?? undefined });
  };

  return (
    <div className="cpick" ref={box}>
      <div className="cpick-field">
        <Icon name="search" size={16} strokeWidth={2} />
        <input
          className="input"
          placeholder={`${t('dash_cust_name')} *`}
          value={name}
          maxLength={60}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setPicked(null);
            onPick({ name: e.target.value });
            setOpen(true);
          }}
        />
      </div>

      {open && matches.length > 0 && (
        <ul className="cpick-list">
          {needle.length === 0 && <li className="cpick-hint">{t('cp_recent')}</li>}
          {matches.map((p) => (
            <li key={p.key}>
              <button type="button" onClick={() => choose(p)}>
                <span className="cpick-name">{p.name}</span>
                <span className="cpick-meta">
                  {p.phone ?? t('cus_no_phone')} · {t('cp_visits', { n: String(p.visits) })}
                  {p.spentCents > 0 && ` · ${money(p.spentCents, lang)}`}
                </span>
                {p.noShows > 0 && <span className="cpick-flag">{p.noShows} {t('cus_noshow')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* What the shop already knows about them, before the booking is made
          rather than after — a bleach allergy or two no-shows changes what you
          do next. */}
      {picked && (
        <div className="cpick-known">
          <Icon name="check" size={14} strokeWidth={2.6} />
          <span>
            {picked.visits === 0 ? t('cp_known_new') : t('cp_known', { n: String(picked.visits) })}
            {picked.noShows > 0 && ` · ${picked.noShows} ${t('cus_noshow')}`}
          </span>
          {picked.shopNote && <em>{picked.shopNote}</em>}
        </div>
      )}
    </div>
  );
}
