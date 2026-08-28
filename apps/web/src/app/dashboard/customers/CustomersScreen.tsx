'use client';
/**
 * Customers tab — who actually comes to this shop.
 *
 * A salon's most valuable asset is knowing its regulars: what they book, when
 * they were last in, what they told you about their hair. That lived nowhere
 * before; bookings were anonymous rows on a calendar.
 *
 * People are grouped by phone number when they gave one, because the same
 * person books from a laptop, then a phone, then gets booked at the counter.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePaged, Pager } from '@/components/Pager';
import { useI18n } from '@/lib/i18n';
import { money, timeOf } from '@/lib/format';
import {
  apiShopCustomers,
  apiSetCustomerNote,
  apiShopReviewsForOwner,
  apiReplyToReview,
  type CustomerRow,
  type ShopReview,
} from '@/lib/api';
import { useToast } from '../toast';
import { OperatorShell } from '../shell';
import type { ShopRef } from '@/lib/owned-shops';

type Sort = 'recent' | 'spend' | 'visits' | 'upcoming';

export function CustomersScreen({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard/customers">
      {({ shopId }) => <CustomersTab shopId={shopId} />}
    </OperatorShell>
  );
}

function CustomersTab({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [open, setOpen] = useState<string | null>(null);
  const PER_PAGE = 25;
  const { setToast, toastEl } = useToast();

  const load = useCallback(() => {
    if (!shopId) return;
    void apiShopCustomers(shopId).then(setRows);
  }, [shopId]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            r.phone.replace(/\s/g, '').includes(needle.replace(/\s/g, '')) ||
            r.favouriteService?.name[lang].toLowerCase().includes(needle),
        )
      : rows;
    const by = [...filtered];
    if (sort === 'spend') by.sort((a, b) => b.spentCents - a.spentCents);
    else if (sort === 'visits') by.sort((a, b) => b.visits - a.visits);
    else if (sort === 'upcoming') by.sort((a, b) => (a.nextVisit ?? Infinity) - (b.nextVisit ?? Infinity));
    return by;
  }, [rows, q, sort, lang]);


  // Search and sort narrow first, paging second — the other order would page
  // through rows that no longer match.
  const paged = usePaged(shown, PER_PAGE, `${q}|${sort}`);
  const totals = useMemo(() => {
    if (!rows) return null;
    const returning = rows.filter((r) => r.visits > 1).length;
    return {
      people: rows.length,
      returning,
      returnPct: rows.length ? Math.round((returning / rows.length) * 100) : 0,
      booked: rows.filter((r) => r.nextVisit !== null).length,
    };
  }, [rows]);

  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  return (
    <>
      <div className="today-bar">
        <input
          className="input"
          style={{ flex: 1, minWidth: 180, maxWidth: 320 }}
          placeholder={t('cus_search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="seg">
          {(['recent', 'upcoming', 'spend', 'visits'] as const).map((s) => (
            <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
              {s === 'recent'
                ? t('cus_recent')
                : s === 'upcoming'
                  ? t('cus_upcoming')
                  : s === 'spend'
                    ? t('cus_spend')
                    : t('cus_visits')}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="spinner" />
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="big">👤</div>
          <p>{t('cus_none')}</p>
        </div>
      ) : (
        <>
          {totals && (
            <div className="stat-row">
              <div className="stat-tile">
                <div className="lbl">{t('cus_total')}</div>
                <div className="val">{totals.people}</div>
              </div>
              <div className="stat-tile">
                <div className="lbl">{t('cus_returning')}</div>
                <div className="val">{totals.returning}</div>
                <div className="bar">
                  <div style={{ width: `${totals.returnPct}%` }} />
                </div>
              </div>
              <div className="stat-tile">
                <div className="lbl">{t('cus_rate')}</div>
                <div className="val">{totals.returnPct} %</div>
              </div>
              <div className="stat-tile">
                <div className="lbl">{t('cus_has_next')}</div>
                <div className="val">{totals.booked}</div>
              </div>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="empty">
              <p>{t('no_results')}</p>
            </div>
          ) : (
            <div className="dtable-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{t('cus_col_who')}</th>
                    <th>{t('cus_col_contact')}</th>
                    <th className="num">{t('cus_visits_k')}</th>
                    <th className="num">{t('cus_spent')}</th>
                    <th>{t('cus_last')}</th>
                    <th>{t('cus_next')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paged.page.map((c) => (
                    <Fragment key={c.key}>
                      <tr className={open === c.key ? 'open' : undefined}>
                        <td data-label={t('cus_col_who')}>
                          <div className="dt-person">
                            <span className="avatar" style={{ background: 'var(--violet)', margin: 0, width: 34, height: 34, fontSize: '0.85rem' }}>
                              {c.name[0]?.toUpperCase() ?? '?'}
                            </span>
                            <span>
                              <strong>{c.name}</strong>
                              {c.visits >= 5 && <span className="cus-tag regular">★ {t('cus_regular')}</span>}
                              {c.noShows > 0 && <span className="cus-tag risk">⚠ {c.noShows} {t('cus_noshow')}</span>}
                              {c.favouriteService && (
                                <span className="dt-sub">
                                  {c.favouriteService.emoji} {c.favouriteService.name[lang]}
                                  {c.averageRating !== null && ` · ★ ${c.averageRating}`}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td data-label={t('cus_col_contact')}>
                          {c.phone ? (
                            <a href={`tel:${c.phone.replace(/\s/g, '')}`} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {c.phone}
                            </a>
                          ) : (
                            <span className="dt-muted">{t('cus_no_phone')}</span>
                          )}
                        </td>
                        <td data-label={t('cus_visits_k')} className="num"><strong>{c.visits}</strong></td>
                        <td data-label={t('cus_spent')} className="num">{money(c.spentCents, lang)}</td>
                        <td data-label={t('cus_last')}>{c.lastVisit ? day(c.lastVisit) : <span className="dt-muted">—</span>}</td>
                        <td data-label={t('cus_next')}>
                          {c.nextVisit ? (
                            <strong style={{ color: 'var(--teal)' }}>{day(c.nextVisit)} · {timeOf(c.nextVisit, lang)}</strong>
                          ) : (
                            <span className="dt-muted">—</span>
                          )}
                        </td>
                        <td className="dt-actions">
                          {/* Straight into this person's thread — the note you
                              were about to scribble is usually a message. */}
                          <Link
                            className="btn btn-ghost sm"
                            href={`/dashboard/messages?customer=${encodeURIComponent(c.key)}`}
                            title={t('cus_message')}
                          >
                            💬
                          </Link>
                          <button className="btn btn-soft sm" onClick={() => setOpen(open === c.key ? null : c.key)}>
                            {open === c.key ? t('cus_close') : t('cus_open')}
                          </button>
                        </td>
                      </tr>

                      {open === c.key && (
                        <tr className="dt-detail">
                          <td colSpan={7}>
                            {c.customerNotes.length > 0 && (
                              <div className="cus-notes">
                                <strong>💬 {t('cus_said')}</strong>
                                {c.customerNotes.slice(0, 3).map((n, i) => (
                                  <p key={i}>“{n}”</p>
                                ))}
                              </div>
                            )}
                            <label className="cus-note-edit">
                              <span>🔒 {t('cus_private_note')}</span>
                              <input
                                className="input"
                                defaultValue={c.shopNote}
                                key={`${c.key}-${c.shopNote}`}
                                placeholder={t('cus_private_ph')}
                                maxLength={280}
                                onBlur={(e) => {
                                  if (e.target.value.trim() === c.shopNote) return;
                                  void apiSetCustomerNote(shopId, c.key, e.target.value).then(() => {
                                    setToast('💾 ' + t('team_saved'));
                                    load();
                                  });
                                }}
                              />
                            </label>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <Pager paged={paged} perPage={PER_PAGE} />
            </div>
          )}
          <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)' }}>💡 {t('cus_hint')}</p>
        </>
      )}

      <ReviewsPanel shopId={shopId} onChanged={setToast} />
      {toastEl}
    </>
  );
}

/**
 * Reviews, and the shop's answer to them.
 *
 * A review was a one-way message: the customer said their piece and the shop
 * had no reply. That is the one piece of customer service every other booking
 * platform has, and the answer is public — future customers read how a shop
 * handles a bad day at least as closely as they read the rating.
 *
 * Unanswered reviews sort first, because they are the work.
 */
function ReviewsPanel({ shopId, onChanged }: { shopId: string; onChanged: (msg: string) => void }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<ShopReview[] | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(() => {
    if (!shopId) return;
    void apiShopReviewsForOwner(shopId).then(setRows);
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  if (rows === null || rows.length === 0) return null;
  const unanswered = rows.filter((r) => !r.reply).length;

  return (
    <section className="section">
      <h2>
        ⭐ {t('rv_title')}
        {unanswered > 0 && <span className="cus-tag risk" style={{ marginLeft: 8 }}>{t('rv_unanswered', { n: String(unanswered) })}</span>}
      </h2>
      <div className="panel">
        {rows.map((r) => (
          <div key={r.bookingId} className="rv-item">
            <div className="rv-top">
              <span className="rv-stars" aria-label={`${r.rating}/5`}>
                {'★'.repeat(r.rating)}
                <span className="dim">{'★'.repeat(5 - r.rating)}</span>
              </span>
              <strong>{r.author}</strong>
              <span className="rv-meta">
                {r.serviceNames.map((n) => n[lang]).join(', ')}
                {r.staffName && ` · ${r.staffName}`} · {r.date}
              </span>
            </div>
            {r.text && <p className="rv-text">“{r.text}”</p>}

            {r.reply ? (
              <div className="rv-reply">
                <strong>↩ {t('rv_your_reply')}</strong>
                <p>{r.reply.text}</p>
                <button
                  className="btn btn-ghost sm"
                  onClick={() => {
                    setOpenFor(r.bookingId);
                    setDraft(r.reply?.text ?? '');
                  }}
                >
                  {t('rv_edit')}
                </button>
              </div>
            ) : openFor !== r.bookingId ? (
              <button className="btn btn-soft sm" onClick={() => { setOpenFor(r.bookingId); setDraft(''); }}>
                ↩ {t('rv_reply')}
              </button>
            ) : null}

            {openFor === r.bookingId && (
              <div className="rv-form">
                <textarea
                  className="input"
                  style={{ minHeight: 62, resize: 'vertical' }}
                  placeholder={t('rv_reply_ph')}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={500}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost sm" onClick={() => setOpenFor(null)}>
                    ✕
                  </button>
                  <button
                    className="btn btn-primary sm"
                    disabled={!draft.trim()}
                    onClick={() => {
                      void apiReplyToReview(shopId, r.bookingId, draft).then(() => {
                        setOpenFor(null);
                        load();
                        onChanged('✅ ' + t('rv_replied'));
                      });
                    }}
                  >
                    {t('rv_publish')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <p style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', marginTop: 10 }}>💡 {t('rv_hint')}</p>
      </div>
    </section>
  );
}
